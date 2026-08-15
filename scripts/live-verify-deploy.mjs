// Verify the three fixes against the LIVE deployed page, by BEHAVIOUR.
//
// Grepping the deployed HTML for a string only proves bytes shipped. This pulls the functions out of
// what the Worker actually SERVES and runs them, which is the only thing that answers "does it work
// in the browser". It also happens to be the one check that catches the served-template escape trap:
// source `\d` arrives as `d` — valid, silent, wrong — so a function that parses fine locally can
// behave differently once served.
//
// Every assertion carries a NEGATIVE CONTROL: the pre-fix behaviour is asserted ABSENT. Without
// that, a harness that silently extracted nothing would report a clean pass.
//
// Run: node scripts/live-verify-deploy.mjs [url]
const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

const res = await fetch(URL_, { cache: 'no-store' });
const html = await res.text();
console.log('\n' + Y + '=== the live page ===' + X);
ok('served 200', res.status === 200);
ok('is the app, not an error page', html.indexOf('<!DOCTYPE html>') === 0 && html.length > 500000);
// NOT a build stamp. BUST<n> is a hardcoded literal in worker.js and is identical across deploys —
// it was measured unchanged before and after a confirmed deploy. Printed for reference only; it must
// never be read as proof that a push landed. FRESHNESS IS PROVEN BY BEHAVIOUR BELOW: each fix is
// exercised against the served bytes, and each carries a negative control asserting the pre-fix
// behaviour is gone. That is what distinguishes a live deploy from a cached old one.
const bust = (html.match(/BUST(\d+)/) || [])[1] || '(none)';
console.log('  ' + Y + 'page ' + (html.length/1048576).toFixed(2) + ' MB, static marker ' + bust + ' (not a build id)' + X);

function matchBrace(s, from){ let i = s.indexOf('{', from), d = 0;
  for (; i < s.length; i++){ const c = s[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
function exFn(name){
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is not in the served page');
  return html.slice(i, matchBrace(html, i) + 1) + '\n';
}
// Extraction itself is a failure mode. Prove each function came back whole before trusting a pass.
function sane(name, src){ return src.indexOf('function ' + name) === 0 && src.trim().endsWith('}') && src.length > 60; }

console.log('\n' + Y + '=== 1. wind arrow — points where the wind is GOING ===' + X);
{
  const s = exFn('windArrowSVG');
  ok('extracted whole from the served page', sane('windArrowSVG', s));
  const f = new Function(s + 'return windArrowSVG;')();
  const rot = (d) => parseFloat((f(d, '#000').match(/rotate\(([-\d.]+) 12 12\)/) || [])[1]);
  eq('FROM N rotates to 180 (points S)', rot(0), 180);
  eq('FROM W rotates to 90 (points E)', rot(270), 90);
  ok('never emits >= 360', [181, 270, 359].every((d) => rot(d) < 360));
  // NEGATIVE CONTROL: the un-flipped meteorological reading must NOT be what ships.
  ok('NEG: does not rotate by the raw bearing', rot(0) !== 0 && rot(90) !== 90);
  // NEGATIVE CONTROL: the map pins' old inline triangle must be gone from the served page.
  ok('NEG: the raw-bearing pin markup is gone', html.indexOf('M12 2l6 18-6-4-6 4z') < 0);
}

console.log('\n' + Y + '=== 2. elevation — an absent profile is described, not denied ===' + X);
{
  const s = exFn('elevProfile');
  ok('extracted whole from the served page', sane('elevProfile', s));
  const f = new Function('_rdScrubReset_', '_rdScrub', s + 'return elevProfile;')(() => {}, {});
  const out = f(null, '18.2', 5465, null, null, null, 1739);
  ok('reports the gain that does exist', out.indexOf('+1739 ft total gain') > -1);
  ok('names the missing thing', out.indexOf('no per-point altitude stream stored for this ride') > -1);
  // NEGATIVE CONTROL: the flat denial that contradicted the 1739 ft must be gone.
  ok('NEG: does not say "No elevation data"', out.indexOf('No elevation data') < 0);
  // And with no gain either, it must not print a bare "+ ft".
  const bare = f(null, '18.2', 5465, null, null, null, null);
  ok('NEG: no orphan "ft total gain" when there is no gain', bare.indexOf('ft total gain') < 0);
  ok('still explains itself with no gain', bare.indexOf('no per-point altitude stream') > -1);
}

console.log('\n' + Y + '=== 3. prescription — the Aug 14 ride is graded on its own day ===' + X);
{
  for (const n of ['_sessionRxFor_', '_rxIntentBucket_', '_rxTrainableIntent_']) ok(n + ' is served whole', sane(n, exFn(n)));
  const FTP = 190;
  const DEFS = {
    z2:        { type:'ride', name:'Z2 Endurance', zone:'Z2', pctFtp:[60,80], hr:[120,135], hrCap:140, durationMin:90 },
    threshold: { type:'ride', name:'Threshold',    zone:'Z4', pctFtp:[85,95], durationMin:60 }
  };
  const stub = {
    normDate: (d) => String(d).slice(0, 10),
    planSessionsForDate_: () => [{ intent:'threshold', name:'Threshold', status:'completed', source:'gen' }],
    blockPlanFor_: () => ({ sessions:[{ intent:'z2', struct:'', rx:null }], weekInPhase:2 }),
    _planSessionFromDef_: (i) => { const d = DEFS[i] || {}; return { targets:{
      powerLo: Math.round(FTP*d.pctFtp[0]/100), powerHi: Math.round(FTP*d.pctFtp[1]/100),
      hrLo: d.hr && d.hr[0], hrHi: d.hr && d.hr[1], hrCap: d.hrCap, durationMin: d.durationMin, zone: d.zone } }; },
    rideSport_: (r) => (r && r.sportType) || 'Ride',
    ftpOn_: () => FTP,
    _blockSessionOf_: (r, ftp) => { const pw = r && (r.np || r.avgPwr); if (!pw || !(ftp > 0)) return null;
      const q = pw / ftp; return q >= 1.06 ? 'vo2' : q >= 0.80 ? 'threshold' : 'z2'; },
    st: { ftp: FTP }
  };
  const names = Object.keys(stub);
  const rxFor = new Function('SESSION_DEFS', ...names,
    exFn('_rxTrainableIntent_') + exFn('_rxIntentBucket_') + exFn('_sessionRxFor_') + 'return _sessionRxFor_;')
    (DEFS, ...names.map((n) => stub[n]));

  const RIDE = { date:'2026-08-14', name:'Zwift - Z2 Endurance', sportType:'VirtualRide', avgPwr:138, np:138 };
  const rx = rxFor('2026-08-14', RIDE);
  eq('resolves to the Z2 prescription', rx && rx.intent, 'z2');
  eq('...decided by the measurement', rx && rx.via, 'block-measured');
  eq('...graded against 114-152W', [rx.lo, rx.hi], [114, 152]);
  ok('...which contains the 138W ridden', 138 >= rx.lo && 138 <= rx.hi);
  // NEGATIVE CONTROL: the band from the bug report must not be what this ride is judged against.
  ok('NEG: NOT the 162-181W Z4 band', !(rx.lo === 162 && rx.hi === 181));
  // NEGATIVE CONTROL: the harness must still be able to PRODUCE the old answer, or it proves nothing.
  const mirror = rxFor('2026-08-14', { date:'2026-08-14', avgPwr:172, np:172 });
  eq('CTRL: a threshold-ridden day still resolves threshold', [mirror.intent, mirror.via], ['threshold','plan-measured']);
  eq('CTRL: ...and IS graded on 162-181W', [mirror.lo, mirror.hi], [162, 181]);
}

console.log('');
if (fails) { console.log(R + 'live verify: ' + fails + ' check(s) failed against ' + URL_ + X + '\n'); process.exit(1); }
console.log(G + 'live verify: all checks passed against ' + URL_ + X + '\n');
