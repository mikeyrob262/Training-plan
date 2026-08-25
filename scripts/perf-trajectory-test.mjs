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
ok('weekly TSS is a cause', /add\(res\.causes,res\.causesMiss,'Weekly TSS'/.test(src));
ok('rides per week is a cause', /add\(res\.causes,res\.causesMiss,'Rides \/ week'/.test(src));
ok('hours per week is a cause', /add\(res\.causes,res\.causesMiss,'Hours \/ week'/.test(src));
ok('...all divided by the window length, so they are RATES not totals', /var weeks=span\/7;/.test(src));
ok('TSS uses the shared ride-TSS accessor, not a raw field', /constRideTSS_\(r\)\|\|0/.test(src));
ok('NEG: no outcome metric is filed under causes',
   !/add\(res\.causes,'Best 20-min power'/.test(src) && !/add\(res\.causes,'W\/kg/.test(src));

console.log('\n' + Y + '=== _ptFactors_ RUN, not just read ===' + X);
{
  // THE TEST THAT WOULD HAVE CAUGHT THE REGRESSION, and every check above it would not have.
  //
  // add() gained a `miss` parameter in second position. The six call sites were meant to be rewired
  // in the same edit, but the script that did it asserted BETWEEN mutations and threw before its
  // write, so every replacement it had made in memory was discarded. The definition changed and the
  // callers did not. Each then passed the LABEL where `miss` was expected, so miss.push threw on the
  // first factor, the outer catch swallowed it, and the card rendered "not enough matched history"
  // over a library with 48 and 58 rides in the two windows.
  //
  // Nothing pattern-based caught it: the source assertions were still matching the OLD call shape,
  // so they passed against exactly the broken arrangement they were meant to pin. Executing the
  // function with known input is the only check that could not be fooled that way.
  const i = src.indexOf('function _ptFactors_(');
  let j = src.indexOf('{', i), d = 0, end = -1;
  for (; j < src.length; j++) { const c = src[j];
    if (c === '{') d++; else if (c === '}') { d--; if (!d) { end = j + 1; break; } } }
  const body = src.slice(i, end);

  const day = (n) => { const t = new Date(); t.setHours(0,0,0,0); t.setDate(t.getDate() - n);
    return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); };
  const ride = (ago, tss, secs, pc) => ({ date: day(ago), tss, movingSecs: secs, powerCurve: pc,
    distance: 20, avgHR: 140 });
  // Two windows of 30 days: the current one trains harder than the previous.
  const rides = [];
  for (let k = 1; k <= 8; k++)  rides.push(ride(k * 3,      100, 5400, { 1200: 260, 3600: 230 }));
  for (let k = 1; k <= 6; k++)  rides.push(ride(30 + k * 4,  70, 3600, { 1200: 250, 3600: 220 }));

  const fn = new Function('allRidesDeduped_', 'st', 'constRideTSS_', 'stWeightLb_',
    body + '; return _ptFactors_;')(() => rides, { rides }, (r) => r.tss, () => 160);
  const res = fn(30);

  ok('it reports having both windows', res.haveBoth === true);
  eq('all three causes are produced', res.causes.map((c) => c.label),
     ['Weekly TSS', 'Rides / week', 'Hours / week']);
  ok('NEG: causes are not silently empty', res.causes.length > 0);
  ok('the arithmetic is right - harder block reads as more weekly TSS',
     res.causes[0].pct > 0);
  ok('...and more rides per week', res.causes[1].pct > 0);
  ok('outcomes are produced too', res.outcomes.length > 0);
  ok('each row carries the figures behind its percentage', !!res.causes[0].detail);
  // The exact failure shape, asserted absent: windows present but every list empty.
  ok('NEG: not the regression shape (haveBoth with nothing in it)',
     !(res.haveBoth && !res.causes.length && !res.outcomes.length
       && !res.causesMiss.length && !res.outcomesMiss.length));
}

console.log('\n' + Y + '=== outcomes live in their own panel, honestly titled ===' + X);
ok('best 20-min power is an outcome', /add\(res\.outcomes,res\.outcomesMiss,'Best 20-min power'/.test(src));
ok('W/kg is an outcome', /add\(res\.outcomes,res\.outcomesMiss,'W\/kg at 20 min'/.test(src));
// The heading helper is now _ptPanelHead_(title, sub), shared with the Run page's trajectory card so
// the two cannot drift apart again. The requirement is unchanged - outcomes get their OWN heading,
// distinct from the causes one - so the assertion follows the helper rather than being dropped.
ok('the card renders a separate heading for them', /_ptPanelHead_\('Is it translating'/.test(src));
ok('...distinct from the causes heading', /_ptPanelHead_\('What is driving it'/.test(src));
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
ok('one shared period string builds every panel label', /var periodTxt=\(_ptRange==='ALL'\|\|_ptRange==='1Y'\)/.test(src));
// STRICTER THAN BEFORE: the old check only proved the helper's body mentioned periodTxt. The helper
// now takes the timeframe as an argument, so what matters is that EVERY call site passes it - a
// heading rendered without its timeframe is the exact defect this section exists to prevent.
{
  // The DEFINITION also reads _ptPanelHead_(t, sub) and carries no timeframe; counting it makes
  // every() fail on correct code. Third time this file-wide-match trap has bitten this session.
  const calls = src.match(/(?<!function )_ptPanelHead_\([^)]*\)/g) || [];
  ok('every panel heading is given a timeframe', calls.length >= 4 && calls.every(c => /periodTxt/.test(c)));
  ok('...and the helper renders whatever it is given', /function _ptPanelHead_\(t, sub\)\{[\s\S]{0,400}\+sub\+/.test(src));
}
ok('the headline keeps its own POINT-comparison wording', /var vsTxt=\(_ptRange==='ALL'\)/.test(src));
ok('the two strings are different, because the two comparisons are',
   /vs the previous '\+w\.days\+' days/.test(src) && /'vs '\+\(w\.days\)\+' days ago'/.test(src));

console.log('\n' + Y + '=== a divergence is stated, not left to look like a bug ===' + X);
{
  ok('the divergence check exists', /function _ptDiverge_\(d, f\)\{/.test(src));
  // IT RETURNS A KEY, NOT PROSE. Returning a finished sentence is what let the card print it beside
  // a separately written trend summary - a caution and a celebration in one breath, joined by
  // nothing and each unaware of the other. One writer has to own the whole thought.
  ok('...and returns a key rather than a sentence', /return 'load-up';/.test(src) && /return 'taper';/.test(src));
  ok('the insight composes it, with the factors in hand', /function _ptInsight_\(d, w, f\)\{/.test(src));
  ok('...and the card calls that single composer', /_ptInsight_\(d, w, fact\)/.test(src));
  ok('NEG: the card no longer prepends a second sentence', !/_ptDiverge_\(d,fact\)\)\?\(/.test(src));
  ok('the stem carries no terminal stop, so a clause can continue it',
     /var stem=\(d\.pct>0\?'Your fitness is '\+Math\.abs\(d\.pct\)\+'% higher than '\+unit$/m.test(src));
  ok('load-up reads as one thought', /but your best efforts have not moved with it/.test(src));
  {
    // Comments stripped: the load-up branch EXPLAINS that it drops "strongest block of the year",
    // and a naive scan reads the explanation as the offence. Third time this file has caught me
    // that way - a comment naming the thing it removed looks identical to the thing.
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    ok('...and suppresses the celebratory boilerplate',
       /if\(div==='load-up'\)\{[\s\S]{0,300}banking fitness/.test(code)
       && !/if\(div==='load-up'\)\{[\s\S]{0,300}strongest block/.test(code));
    ok('the taper case likewise', /yet your numbers are up - form holding on less work/.test(code));
    ok('the strongest-block line survives only on the non-diverging path',
       /var s=stem\+'\.';[\s\S]{0,400}strongest block of the year/.test(code));
  }
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

console.log('\n' + Y + '=== a percentage needs a base worth dividing by ===' + X);
{
  // ALL reported +2517%. Not a fitness fact - a division artifact. These records begin in 2015 at a
  // CTL of 2.4 and 3,555 of their 4,112 days sit below 15, so the ridge is flat and near zero for a
  // decade because that period holds almost no training. Dividing today by 2.4 measures the smallness
  // of the starting point. The old guard rejected only a base of zero, which 2.4 clears.
  ok('a floor is declared, not buried in an expression', /var _PT_BASE_FLOOR=15;/.test(src));
  ok('the delta flags a weak base rather than dividing anyway', /var weak=!\(a>=_PT_BASE_FLOOR\);/.test(src));
  ok('...and returns null for the percentage in that case', /pct: weak\?null:Math\.round\(\(b-a\)\/a\*100\)/.test(src));
  ok('NEG: the old zero-only guard is gone', !/if\(!\(a>0\) \|\| !isFinite\(a\)/.test(src));
  ok('the headline shows the absolute pair instead', /d\.weakBase\?\(d\.from\+' &rarr; '\+d\.to\)/.test(src));
  ok('the verdict stops claiming a rate', /Fitness is far above where these records begin/.test(src));
  ok('the insight explains the flat stretch', /too low a[\s\S]{0,40}starting point to turn into a percentage/.test(src));
  ok('...and names when real training starts', /Consistent training in these records begins around/.test(src));
  // NOT REBASED - ALL still means all. Asserted on the code rather than on the word: the first cut
  // of this check was !/rebase/i over the source, which matches "Firebase" and so could never fail.
  // The real guarantee is that the delta still reads the FIRST point of the window, never a scanned
  // "first meaningful day" - rebasing would make a range labelled ALL quietly start in 2025.
  ok('the delta still reads pts[0], not a chosen start', /var a=\+pts\[0\]\.ctl, b=\+pts\[pts\.length-1\]\.ctl;/.test(src));
  ok('...and _ptFirstReal_ is used only for the explanation, not to move the baseline',
     /_ptFirstReal_\(w\.all\|\|\[\]\)/.test(src) && !/pts=.*_ptFirstReal_/.test(src));

  // Run it. The reported case and the boundary either side of the floor.
  const i = src.indexOf('function _ptDelta_(');
  let j = src.indexOf('{', i), d0 = 0, end = -1;
  for (; j < src.length; j++) { const c = src[j];
    if (c === '{') d0++; else if (c === '}') { d0--; if (!d0) { end = j + 1; break; } } }
  const delta = new Function('_PT_BASE_FLOOR', src.slice(i, end) + '; return _ptDelta_;')(15);
  const pts = (a, b) => [{ ctl: a }, { ctl: b }];

  const all = delta(pts(2.4, 63));
  ok('the reported case is flagged weak', all.weakBase === true);
  eq('...and prints no percentage at all', all.pct, null);
  eq('...keeping both real numbers', [all.from, all.to], [2.4, 63]);
  const ok90 = delta(pts(35.5, 63));
  ok('a real 90-day base is not flagged', ok90.weakBase === false);
  eq('...and still reports its percentage', ok90.pct, 77);
  const edge = delta(pts(15, 63));
  ok('exactly at the floor counts as usable', edge.weakBase === false);
  const below = delta(pts(14.9, 63));
  ok('just below it does not', below.weakBase === true);
  const zero = delta(pts(0, 63));
  ok('a zero base is weak, not a crash', zero.weakBase === true && zero.pct === null);
  eq('direction survives even without a percentage', [all.dir, delta(pts(2, 1)).dir], [1, -1]);
}

console.log('\n' + Y + '=== the panel labels describe the comparison actually made ===' + X);
ok('ALL says "vs the previous year", which is what _ptFactors_ does with no day count',
   /\(_ptRange==='ALL'\|\|_ptRange==='1Y'\)\?'vs the previous year'/.test(src));
// Comments stripped: the code EXPLAINS the caption it replaced, and a raw scan reads the
// explanation as the caption.
ok('NEG: the caption no longer claims a first-half comparison',
   !/vs the first half of your history/.test(src.replace(/^\s*\/\/.*$/gm, '')));
ok('...and the fallback span it describes is still 365', /var span=\(days>0\?days:365\);/.test(src));

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
