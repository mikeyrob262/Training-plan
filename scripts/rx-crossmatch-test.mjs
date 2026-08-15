// A ride must be graded against ITS OWN day's prescription, not a neighbouring day's.
//
// The live failure: "Zwift - Z2 Endurance", Aug 14 2026, 138W avg / 132bpm / 1:31:05. Dr. Smurkel
// reported "Significantly below target: threshold band was not held ... fell well short of the
// 162-181W Z4 prescription". 162-181W is SESSION_DEFS.threshold (pctFtp 85-95) priced at FTP 190.
// The athlete was never asked to hold it.
//
// HOW IT CROSS-MATCHED. The Thu/Fri amendment gives Friday the Z2 from SCHED_THU_FRI_SWAP_FROM, so
// blockPlanFor_ was right. The STORED st.plan row still carried the pre-amendment Threshold, and
// migratePlanIntentsToBlock_ could not repair it — that pass is FUTURE-ONLY and _planReplaceable_
// excludes a completed row. _sessionRxFor_ then handed the stale row the win on the COMPLETED rule,
// so the day was misgraded precisely BECAUSE it had been ridden.
//
// The rule that broke it is not wrong in general: a completed plan row usually IS the record of what
// the session was, and that rule exists to fix Aug 3. What was wrong is treating completion as
// evidence about IDENTITY — completion is stamped when work lands on the DATE, the same way the
// calendar's plan chip is date co-location rather than a match.
//
// So the tie-break is the activity: on a genuine contradiction, whichever candidate agrees with what
// the ride measurably WAS wins. This file pins that, and pins that it stays narrow.
//
// Run: node scripts/rx-crossmatch-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

// The bands the failure quoted. Pinned against source so a def edit cannot silently invalidate this
// whole file — if threshold stops being 85-95 the numbers below stop meaning what they say.
console.log('\n' + Y + '=== the bands this test reasons about are still the real ones ===' + X);
ok('z2 is pctFtp 60-80',        /z2:\s*\{[^}]*pctFtp:\[60,80\]/.test(src));
ok('threshold is pctFtp 85-95', /threshold:\{[^}]*pctFtp:\[85,95\]/.test(src));
ok('threshold is the Z4 band',  /threshold:\{[^}]*zone:'Z4'/.test(src));
const FTP = 190;
eq('...so threshold at FTP 190 is the 162-181W band Smurkel quoted',
   [Math.round(FTP * 0.85), Math.round(FTP * 0.95)], [162, 181]);

const DEFS = {
  z2:        { type: 'ride', name: 'Z2 Endurance', zone: 'Z2', pctFtp: [60, 80], hr: [120, 135], hrCap: 140, durationMin: 90 },
  threshold: { type: 'ride', name: 'Threshold',    zone: 'Z4', pctFtp: [85, 95], durationMin: 60 },
  vo2:       { type: 'ride', name: 'VO2 Max',      zone: 'Z5', pctFtp: [110, 120], durationMin: 60 },
  easyRun:   { type: 'run',  name: 'Easy Run',     hr: [120, 140], hrCap: 140, durationMin: 40 },
  strengthA: { type: 'strength', name: 'Strength A' }
};

// The real resolver, with only its external collaborators stubbed. _blockSessionOf_ is the REAL one's
// contract — structure, then intensity, then the whole-ride ratio — modelled here by the ratio,
// which is the path this ride actually takes (no intervals to find in a continuous Z2).
function build({ planRows, blockRows }) {
  const stub = {
    normDate: (d) => String(d).slice(0, 10),
    planSessionsForDate_: () => planRows,
    blockPlanFor_: () => ({ sessions: blockRows, weekInPhase: 2 }),
    _planSessionFromDef_: (intent) => {
      const d = DEFS[intent] || {};
      if (!d.pctFtp) return { targets: { hrLo: d.hr && d.hr[0], hrHi: d.hr && d.hr[1], hrCap: d.hrCap, durationMin: d.durationMin } };
      return { targets: { powerLo: Math.round(FTP * d.pctFtp[0] / 100), powerHi: Math.round(FTP * d.pctFtp[1] / 100),
                          hrLo: d.hr && d.hr[0], hrHi: d.hr && d.hr[1], hrCap: d.hrCap, durationMin: d.durationMin, zone: d.zone } };
    },
    rideSport_: (r) => (r && r.sportType) || 'Ride',
    ftpOn_: () => FTP,
    _blockSessionOf_: (r, ftp) => {
      const pw = r && (r.np || r.avgPwr);
      if (!pw || !(ftp > 0)) return null;
      const ratio = pw / ftp;
      return ratio >= 1.06 ? 'vo2' : ratio >= 0.80 ? 'threshold' : 'z2';
    },
    st: { ftp: FTP }
  };
  const names = Object.keys(stub);
  const body = asServed(exFn('_rxTrainableIntent_') + exFn('_rxIntentBucket_') + exFn('_sessionRxFor_')
    + 'return _sessionRxFor_;');
  return new Function('SESSION_DEFS', ...names, body)(DEFS, ...names.map((n) => stub[n]));
}

// The live ride, verbatim from the report.
const RIDE = { date: '2026-08-14', name: 'Zwift - Z2 Endurance', sportType: 'VirtualRide',
               avgPwr: 138, np: 138, avgHR: 132, duration: '1:31:05' };
// The stale stored row: pre-amendment Threshold, and COMPLETED — which is what handed it the win.
const STALE_PLAN = [{ intent: 'threshold', name: 'Threshold', status: 'completed', source: 'gen' }];
// The block, post-amendment: Friday is the Z2.
const BLOCK_Z2 = [{ intent: 'z2', struct: '', rx: null }];

console.log('\n' + Y + '=== the reported failure ===' + X);
{
  const rx = build({ planRows: STALE_PLAN, blockRows: BLOCK_Z2 })('2026-08-14', RIDE);
  eq('the Z2 ride resolves to the Z2 prescription', rx && rx.intent, 'z2');
  eq('...decided by the measurement, not by precedence', rx && rx.via, 'block-measured');
  ok('...and NOT the 162-181W Z4 band', !(rx.lo === 162 && rx.hi === 181));
  eq('the band it is graded against', [rx.lo, rx.hi], [114, 152]);
  eq('...which contains the 138W actually ridden', RIDE.avgPwr >= rx.lo && RIDE.avgPwr <= rx.hi, true);
}

console.log('\n' + Y + '=== it adjudicates, it does not just prefer the block ===' + X);
// The mirror image: if the STORED row is the one that matches what was ridden, the stored row wins.
// A fix that simply demoted st.plan would pass the case above and fail this one.
{
  const rx = build({
    planRows: [{ intent: 'threshold', name: 'Threshold', status: 'completed', source: 'gen' }],
    blockRows: [{ intent: 'z2', struct: '', rx: null }]
  })('2026-08-14', { date: '2026-08-14', avgPwr: 172, np: 172 });   // 0.905 of FTP — threshold
  eq('a threshold-ridden day keeps the threshold prescription', rx && rx.intent, 'threshold');
  eq('...via the same measured route', rx && rx.via, 'plan-measured');
}

console.log('\n' + Y + '=== it stays narrow — the cases the resolver was built around ===' + X);
{
  // Aug 3 shape: the candidates AGREE, so there is nothing to adjudicate and the completed rule runs.
  const rx = build({ planRows: [{ intent: 'z2', status: 'completed', source: 'gen' }], blockRows: [{ intent: 'z2' }] })
    ('2026-08-03', { date: '2026-08-03', avgPwr: 130, np: 130 });
  eq('agreeing candidates are untouched', [rx.intent, rx.via], ['z2', 'plan']);
}
{
  // 2026-07-31 shape: an UNCOMPLETED plan row must not override a real block prescription. This is
  // the regression a blanket plan-first caused, and it must survive the new branch.
  const rx = build({ planRows: [{ intent: 'z2', source: 'gen' }], blockRows: [{ intent: 'threshold' }] })
    ('2026-07-31', null);
  eq('uncompleted plan residue still loses to the block', [rx.intent, rx.via], ['threshold', 'block']);
}
{
  // No ride: pre-ride advice resolves the day with nothing to adjudicate against.
  const rx = build({ planRows: STALE_PLAN, blockRows: BLOCK_Z2 })('2026-08-14', null);
  eq('with no activity it falls through to precedence', rx && rx.via, 'plan');
}
{
  // Unreadable ride: no power at all, so _blockSessionOf_ returns null and it declines to choose.
  const rx = build({ planRows: STALE_PLAN, blockRows: BLOCK_Z2 })('2026-08-14', { date: '2026-08-14' });
  eq('an unreadable ride does not get a guessed adjudication', rx && rx.via, 'plan');
}
{
  // Same bucket on both sides — nothing to tell apart, so precedence runs.
  const rx = build({ planRows: [{ intent: 'threshold', status: 'completed', source: 'gen' }], blockRows: [{ intent: 'vo2' }] })
    ('2026-08-14', { date: '2026-08-14', avgPwr: 138, np: 138 });
  ok('a ride matching NEITHER candidate is not force-fitted', rx.via === 'plan');
}

console.log('\n' + Y + '=== a run is never adjudicated on watts ===' + X);
{
  // Running power is not comparable to cycling FTP. The bucket function must refuse, so a run day
  // falls through untouched — and the resolver still drops the watt band, as it already did.
  const rx = build({ planRows: [{ intent: 'easyRun', status: 'completed', source: 'gen' }], blockRows: [{ intent: 'threshold' }] })
    ('2026-08-05', { date: '2026-08-05', sportType: 'Run', avgPwr: 138, np: 138 });
  eq('a run day keeps its own session', rx && rx.intent, 'easyRun');
  eq('...and carries no watt band', [rx.lo, rx.hi], [null, null]);
  eq('...but does carry the HR band it is judged on', [rx.hrLo, rx.hrHi], [120, 140]);
}

console.log('\n' + Y + '=== the bucket map is derived, not a hardcoded intent list ===' + X);
{
  const bucket = new Function('SESSION_DEFS', asServed(exFn('_rxIntentBucket_') + 'return _rxIntentBucket_;'))(DEFS);
  eq('z2 -> z2',               bucket('z2'), 'z2');
  eq('threshold -> threshold', bucket('threshold'), 'threshold');
  eq('vo2 -> vo2',             bucket('vo2'), 'vo2');
  eq('a run has no bucket',    bucket('easyRun'), null);
  eq('strength has no bucket', bucket('strengthA'), null);
  eq('an unknown intent has no bucket', bucket('nope'), null);
  // The boundaries are _blockSessionOf_'s, and must stay that way or the two drift apart.
  ok('the 1.06 vo2 boundary is shared', /if\(mid>=1\.06\) return 'vo2';/.test(src) && /if\(ratio>=1\.06\) return 'vo2';/.test(src));
  ok('the 0.80 threshold boundary is shared', /if\(mid>=0\.80\) return 'threshold';/.test(src) && /if\(ratio>=0\.80\) return 'threshold';/.test(src));
}

console.log('\n' + Y + '=== the adjudication cannot be reordered away ===' + X);
ok('it runs BEFORE the precedence ladder',
   src.indexOf("via='block-measured'") < src.indexOf("if(pln && (plnDone || !tpl)){ pick=pln; via='plan'; }"));
ok('the precedence ladder only runs when nothing was adjudicated', /if\(!pick\)\{\s*\n\s*if\(pln && \(plnDone \|\| !tpl\)\)/.test(src));
ok('it requires a genuine contradiction', /pln && tpl && pln\.intent!==tpl\.intent && ride/.test(src));

console.log('');
if (fails) { console.log(R + 'rx cross-match: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'rx cross-match: all checks passed' + X + '\n');
