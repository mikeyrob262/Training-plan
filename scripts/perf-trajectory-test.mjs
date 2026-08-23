// A DRIVERS PANEL MUST SHOW CAUSES, NOT OUTCOMES.
//
// The first cut of Performance Trajectory printed "Fitness is climbing fast, +29%" directly above
// four red down-arrows and offered nothing to reconcile them. Three faults, and the window mismatch
// everyone noticed first was the shallowest:
//
//   CATEGORY  - the panel was titled "what is driving it" under a CTL headline and showed 20-minute
//               power, W/kg and efficiency. Those are OUTCOMES of fitness, not inputs to CTL. CTL is
//               accumulated training load; what drives it is volume, intensity, frequency. Labelling
//               outcomes as causes asserts a causal link that does not exist, so the halves were free
//               to disagree with nothing able to explain why. Fixing the window alone would have
//               shipped something that LOOKED coherent and was still wrong underneath.
//   PEAK-PEAK - it compared the single best effort in one window against the single best in another.
//               One ride decides each side; it flips sign on a good day. Not a trend.
//   WINDOW    - the headline was two-point (CTL then vs now), the panel two adjacent aggregate
//               windows, and neither was labelled.
//
// Run: node scripts/perf-trajectory-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

console.log('\n' + Y + '=== causes are causes: training RATE, which is what CTL integrates ===' + X);
ok('the factor builder returns causes and outcomes separately', /function _ptFactors_\(days\)\{/.test(src)
   && /res=\{ causes:\[\], outcomes:\[\],[^}]*haveBoth:false \}/.test(src));
ok('weekly TSS is a cause', /add\(res\.causes,'Weekly TSS'/.test(src));
ok('rides per week is a cause', /add\(res\.causes,'Rides \/ week'/.test(src));
ok('hours per week is a cause', /add\(res\.causes,'Hours \/ week'/.test(src));
ok('...all divided by the window length, so they are RATES not totals', /var weeks=span\/7;/.test(src));
ok('TSS uses the shared ride-TSS accessor, not a raw field', /constRideTSS_\(r\)\|\|0/.test(src));
ok('NEG: no outcome metric is filed under causes',
   !/add\(res\.causes,'Best 20-min power'/.test(src) && !/add\(res\.causes,'W\/kg/.test(src));

console.log('\n' + Y + '=== outcomes live in their own panel, honestly titled ===' + X);
ok('best 20-min power is an outcome', /add\(res\.outcomes,'Best 20-min power'/.test(src));
ok('W/kg is an outcome', /add\(res\.outcomes,'W\/kg at 20 min'/.test(src));
ok('the card renders a separate heading for them', /head2\('Is it translating'\)/.test(src));
ok('...distinct from the causes heading', /head2\('What is driving it'\)/.test(src));
ok('NEG: the old single undifferentiated panel is gone', !/_ptDrivers_/.test(src));

console.log('\n' + Y + '=== outcomes are stable, not peak-vs-peak ===' + X);
{
  ok('the top-3 mean helper exists', /var top3=function\(set,secs\)\{/.test(src));
  ok('...and refuses to answer on fewer than three efforts', /if\(v\.length<3\) return null;/.test(src));
  ok('...averaging the top three', /return \(v\[0\]\+v\[1\]\+v\[2\]\)\/3;/.test(src));
  ok('NEG: the max-based comparison is gone', !/var bestPc=function/.test(src));
  // Exercise it: one exceptional ride must not decide a year.
  const top3 = (v) => { if (v.length < 3) return null; const s = v.slice().sort((a, b) => b - a); return (s[0]+s[1]+s[2])/3; };
  const max = (v) => Math.max.apply(null, v);
  const cur = [300, 295, 290, 285], prv = [420, 300, 295, 290];   // prior window holds one freak ride
  // HONEST ABOUT WHAT THIS BUYS. A top-3 mean does not remove the outlier - it is still one of the
  // three - it HALVES its leverage. That is the claim worth pinning: the same freak ride swings the
  // verdict by 29 points under max and 13 under top-3, so a single day can no longer decide a year
  // on its own. Claiming it reads "roughly flat" would have been a nicer number and a false one.
  ok('max lets one ride say the year collapsed 29%', Math.round((max(cur) - max(prv)) / max(prv) * 100) === -29);
  eq('top-3 mean halves that ride leverage', Math.round((top3(cur) - top3(prv)) / top3(prv) * 100), -13);
  // And where the outlier falls outside the top three, it stops counting entirely.
  const prv2 = [420, 300, 295, 290], cur2 = [318, 315, 312, 310];
  eq('an outlier outranked by three real efforts is fully diluted',
     Math.round((top3(cur2) - top3(prv2)) / top3(prv2) * 100), -7);
  eq('NEG: fewer than three efforts yields null, not a one-ride verdict', top3([310, 300]), null);
}

console.log('\n' + Y + '=== every panel states its own timeframe ===' + X);
ok('one shared period string builds every panel label', /var periodTxt=\(_ptRange==='ALL'\)/.test(src));
ok('...and the heading helper always prints it', /head2=function\(t\)\{[\s\S]{0,400}periodTxt/.test(src));
ok('the headline keeps its own POINT-comparison wording', /var vsTxt=\(_ptRange==='ALL'\)/.test(src));
ok('the two strings are different, because the two comparisons are',
   /vs the previous '\+w\.days\+' days/.test(src) && /'vs '\+\(w\.days\)\+' days ago'/.test(src));

console.log('\n' + Y + '=== a divergence is stated, not left to look like a bug ===' + X);
{
  ok('the divergence check exists', /function _ptDiverge_\(d, f\)\{/.test(src));
  ok('...and is rendered ahead of the trend summary', /_ptDiverge_\(d,fact\)\)\?\(/.test(src));
  ok('load up with output flat is named', /Training load is up while output is not/.test(src));
  ok('...and the taper case too', /riding less but performing better/.test(src));
  // Exercise the gate: it must fire only on a real, signed disagreement.
  const mean = (a) => a.reduce((s, x) => s + x.pct, 0) / a.length;
  const diverge = (c, o) => { const cm = mean(c), om = mean(o);
    if (Math.abs(cm) < 3 && Math.abs(om) < 3) return null;
    if (cm >= 3 && om <= -3) return 'load-up';
    if (cm <= -3 && om >= 3) return 'taper';
    return null; };
  eq('load climbing while output falls -> stated', diverge([{pct:20},{pct:14}], [{pct:-8},{pct:-11}]), 'load-up');
  eq('riding less but performing better -> stated', diverge([{pct:-18}], [{pct:9}]), 'taper');
  eq('NEG: both rising is not a divergence', diverge([{pct:12}], [{pct:7}]), null);
  eq('NEG: both falling is not a divergence', diverge([{pct:-12}], [{pct:-7}]), null);
  eq('NEG: noise around zero says nothing', diverge([{pct:1}], [{pct:-2}]), null);
}

console.log('\n' + Y + '=== an omission is stated, not left as a gap ===' + X);
{
  // Omitting a metric that cannot be computed for both windows is correct - an absent measurement and
  // no change are different facts - but a SILENT omission is indistinguishable from a bug. At 30D
  // there are too few 20-minute efforts on both sides, so "Is it translating" showed one line and no
  // reason. The panel now names what dropped out.
  ok('omissions are collected, not just skipped', /causesMiss:\[\], outcomesMiss:\[\]/.test(src));
  ok('the add helper records the label it could not compute', /if\(p==null\)\{ if\(miss\) miss\.push\(label\); return; \}/.test(src));
  ok('...and the W/kg guard reports itself too', /if\(!\(wt>0 && c20!=null && p20!=null\)\) res\.outcomesMiss\.push/.test(src));
  ok('the note names the metrics and the reason', /more history than this range holds/.test(src));
  ok('a panel emptied entirely still explains itself', /Try a longer range/.test(src));
  ok('NEG: no panel drops a metric with no note', !/rows\(fact\.outcomes\)\)$/m.test(src));
  // The English, exercised - a list that reads wrong is its own small dishonesty.
  const andList = (a) => a.length <= 1 ? (a[0] || '')
    : a.length === 2 ? a[0] + ' and ' + a[1]
    : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  eq('one missing metric', andList(['W/kg at 20 min']), 'W/kg at 20 min');
  eq('two read naturally', andList(['Best 20-min power', 'W/kg at 20 min']), 'Best 20-min power and W/kg at 20 min');
  eq('three use a serial comma-free list', andList(['A', 'B', 'C']), 'A, B and C');
  eq('none yields nothing to print', andList([]), '');
  const verb = (n) => (n > 1 ? ' need' : ' needs');
  eq('singular agreement', verb(1), ' needs');
  eq('plural agreement', verb(2), ' need');
}

console.log('\n' + Y + '=== it still refuses to invent ===' + X);
ok('a factor needs BOTH windows or it is omitted', /if\(!cur\.length \|\| !prv\.length\) return res;/.test(src));
ok('a percentage against a zero base is refused', /if\(a==null\|\|b==null\|\|!\(b>0\)\) return null;/.test(src));
ok('the empty state says which comparison failed', /Not enough matched history in this range/.test(src));
// Comments stripped: the code now EXPLAINS that "HR Efficiency" was the reference's name for a
// metric that does not exist, and a naive scan reads the explanation as the offence.
{
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  ok('NEG: the two metrics that do not exist are still absent',
     !/Climbing Performance/.test(code) && !/HR Efficiency/.test(code));
}

console.log('');
if (fails) { console.log(R + 'performance trajectory: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'performance trajectory: all checks passed' + X + '\n');
