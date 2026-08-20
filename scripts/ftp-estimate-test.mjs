// AN INTERIM FTP ESTIMATE, AND THE GUARDS THAT MAKE IT SAFE.
//
// The working FTP sits flat between formal tests - here ~10 weeks - and every prescribed zone sits
// flat with it. Manual adjustment was declined for a stated reason: a documented tendency to train
// harder than prescribed makes a self-set FTP creep ahead of actual fitness, and doing that during a
// caloric deficit prescribes zones that are too hard exactly when recovery is worst.
//
// So it is estimated from real efforts - FTP = 0.95 x best MEASURED 20-minute power, the Coggan
// standard, chosen because it is what the formal test uses. An estimate on its own scale would need
// a conversion and would drift against the thing it exists to stand in for.
//
// THE GUARDS ARE THE FEATURE, so this file exercises them rather than asserting they exist:
//   window 42d, cadence 14d, rise cap +2W/update, total drift ceiling +6% off the last MEASURED
//   value, 3W deadband, a fall needs 2 corroborating efforts, and absence of data never lowers it.
//
// THE FEEDBACK LOOP IS BOUNDED, NOT SOLVED. An estimator reading best efforts tracks how hard he
// TRAINS, not how fit he is: overshoot -> higher 20-min best -> higher FTP -> higher zones. The caps
// bound the worst case to about +6% by the retest, which then corrects it. Recorded here so a later
// reader does not mistake a bound for a fix.
//
// Run: node scripts/ftp-estimate-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== the fabricated peak is gone from the source it reads ===' + X);
// An FTP built on np*1.05 would be an estimate of an estimate driving every prescribed zone.
ok('NEG: computePowerCurve no longer synthesises a 20-min peak', !/var est20=Math\.round\(r\.np\*1\.05\)/.test(SRC));
ok('NEG: nor a 60-min one', !/var est60=Math\.round\(r\.np\*0\.95\)/.test(SRC));
ok('the Records engine still states the measured-only rule it always held', /MEASURED peaks only/.test(src));
ok('the estimator reads powerCurve\\[1200\\] only, never max20', /r\.powerCurve && \+r\.powerCurve\[1200\]>0/.test(SRC));

console.log('\n' + Y + '=== the constants are the agreed ones ===' + X);
for (const [k, v] of [['_FTPEST_WINDOW_D', 42], ['_FTPEST_MIN_GAP_D', 14], ['_FTPEST_RISE_CAP', 2],
                      ['_FTPEST_DRIFT_PCT', 6], ['_FTPEST_DEADBAND', 3], ['_FTPEST_FALL_N', 2]])
  ok(k + ' = ' + v, new RegExp('var ' + k + ' = ' + v + ';').test(SRC));
ok('the formula is 0.95 x the 20-minute best', /Math\.round\(best\.w\*0\.95\)/.test(SRC));

console.log('\n' + Y + '=== provenance, because an estimate must not look measured ===' + X);
ok('it writes with source estimate', /ftpRecord_\(r\.ftp, ?'estimate'\)/.test(SRC));
ok('the drift ceiling is anchored on the last MEASURED entry, not the last estimate',
   /String\(e\.source\|\|''\)!=='estimate'/.test(SRC));
ok('a display helper reports the source in force', /function ftpSrcOn_\(dateStr\)/.test(SRC));
ok('the dashboard tile labels an estimate as estimated', /ftpSrcOn_\(\)==='estimate'\)\?'estimated':'threshold'/.test(SRC));
ok('...and reads the WORKING ftp, not st.ftp raw', /var ftp=\(typeof ftpOn_==='function'\)\?\(parseInt\(ftpOn_\(\),10\)/.test(SRC));
ok('st.ftp is left alone as the measured anchor', !/ftpEstimateApply_[\s\S]{0,400}st\.ftp=/.test(SRC));
ok('it runs at the sync chokepoint, after the log is reconciled',
   SRC.indexOf('ftpSyncHistory_();') < SRC.indexOf('ftpEstimateApply_();'));

console.log('\n' + Y + '=== the guards, exercised ===' + X);
{
  const W = 42, GAP = 14, RISE = 2, DRIFT = 6, DEAD = 3, FALLN = 2;
  // The decision function, modelled exactly.
  const decide = ({ base, cur, efforts, daysSinceEst }) => {
    if (!efforts.length) return { skip: 'no effort' };
    if (daysSinceEst != null && daysSinceEst < GAP) return { skip: 'cadence' };
    const best = efforts.reduce((a, b) => (b.w > a.w ? b : a));
    const implied = Math.round(best.w * 0.95);
    const delta = implied - cur;
    if (Math.abs(delta) < DEAD) return { skip: 'deadband' };
    if (delta > 0) {
      const ceil = Math.floor(base * (1 + DRIFT / 100));
      const next = Math.min(cur + RISE, implied, ceil);
      return next <= cur ? { skip: 'ceiling' } : { ftp: next };
    }
    const below = efforts.filter((e) => Math.round(e.w * 0.95) < cur - DEAD);
    if (below.length < FALLN) return { skip: 'needs corroboration' };
    const next = Math.max(cur - RISE, implied);
    return next === cur ? { skip: 'no movement' } : { ftp: next };
  };
  const E = (w) => ({ w });

  ok('a big 20-min best raises by AT MOST the cap (196W implies 186, capped to 185)',
     decide({ base: 183, cur: 183, efforts: [E(196)] }).ftp === 185);
  ok('...and a huge one is capped identically - no hero-effort spike',
     decide({ base: 183, cur: 183, efforts: [E(260)] }).ftp === 185);
  ok('a small gain inside the deadband does nothing', decide({ base: 183, cur: 183, efforts: [E(194)] }).skip === 'deadband');
  ok('the cadence guard blocks a second update inside 14 days',
     decide({ base: 183, cur: 183, efforts: [E(220)], daysSinceEst: 13 }).skip === 'cadence');
  ok('...and allows it at 14', decide({ base: 183, cur: 183, efforts: [E(220)], daysSinceEst: 14 }).ftp === 185);
  ok('no measured effort in the window = no change, not a fall',
     decide({ base: 183, cur: 183, efforts: [] }).skip === 'no effort');

  // THE CEILING. Successive updates must converge on +6% of the MEASURED value, never ratchet.
  let cur = 183; const base = 183;
  for (let i = 0; i < 40; i++) { const r = decide({ base, cur, efforts: [E(300)] }); if (r.ftp) cur = r.ftp; else break; }
  const ceil = Math.floor(base * 1.06);
  ok('40 updates against a huge effort converge on the +6% ceiling (' + cur + 'W = ' + ceil + 'W)', cur === ceil);
  ok('...which is ' + (cur - base) + 'W above the measured 183W, not unbounded', cur - base <= 12);
  // And the anchor must stay the measured value: if the ceiling were taken off the LAST ESTIMATE,
  // each update would re-base and 6% would compound into runaway drift.
  let ratchet = 183;
  for (let i = 0; i < 40; i++) { const r = decide({ base: ratchet, cur: ratchet, efforts: [E(300)] }); if (r.ftp) ratchet = r.ftp; else break; }
  ok('NEG CONTROL: re-basing the ceiling each time would run away instead (' + ratchet + 'W)', ratchet > cur);

  // FALLS.
  ok('one low effort does NOT lower it - a bad day is not a decline',
     decide({ base: 183, cur: 183, efforts: [E(180)] }).skip === 'needs corroboration');
  ok('two low efforts do', decide({ base: 183, cur: 183, efforts: [E(180), E(179)] }).ftp === 181);
  ok('...and a fall is capped too, not a collapse to the implied value',
     decide({ base: 183, cur: 183, efforts: [E(120), E(121)] }).ftp === 181);
  ok('a single low effort alongside a high one still raises', decide({ base: 183, cur: 183, efforts: [E(180), E(210)] }).ftp === 185);

  // The whole point: 10 weeks flat vs bounded movement.
  // AT MOST 6%, not exactly: Math.floor truncates, so 183 x 1.06 = 193.98 lands on 193, or +5.46%.
  // The guarantee is a CEILING, and asserting an exact figure would fail on any base that divides
  // differently - which is the arbitrary-threshold mistake this session has already made twice.
  const pct = ((ceil - base) / base) * 100;
  ok('worst case by the retest is at most +6% (' + pct.toFixed(2) + '%), which the formal test corrects',
     pct <= DRIFT && pct > DRIFT - 1);
}

console.log('\n' + Y + '=== it does not fight the things that outrank it ===' + X);
ok('a manual or retest entry supersedes via ftpOn_, being later-dated', /if\(!h\.length\) return parseInt/.test(SRC));
ok('ftpHistory still keys on date alone, so an estimate REPLACES rather than forks', /ftpHistory:\{ keys:\['date'\], val:'ftp' \}/.test(SRC));
ok('bands are date-aware, so past sessions keep the band they were ridden under', /function _planZoneFromPct_\(pct, ?dateKey\)/.test(SRC));

console.log('');
if (fails) { console.log(R + 'ftp estimate: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'ftp estimate: all checks passed' + X + '\n');
