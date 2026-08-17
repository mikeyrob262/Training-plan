// THE SUNDAY RUN BUILDS TOWARD OCT 18, AND IT CANNOT RE-GRADE A SUNDAY ALREADY RUN.
//
// The Sunday run was already stepping by PHASE (20-25 min in P1, 25-27 in P2, 27-29 in P4), so it was
// never static. What it lacked was a week-to-week build in MILES aimed at a date. This adds one.
//
// THE MECHANISM CHOICE IS THE POINT. _BLOCK_PROG keys on week-IN-PHASE and therefore RESETS at every
// phase boundary - correct for a repeating microcycle, wrong for a build toward a fixed day. The file
// already draws that line on the Ven-Top rehearsal: a microcycle repeats, a rehearsal accumulates. A
// race build accumulates, so this is keyed by DATE and not by week index at all.
//
// THE RACE IS A 10k, confirmed against the block itself: P5 is label:'10k week', the race session is
// S('tenk'), and P4's Wednesday already carries 10k-pace work. Peak is the race distance.
//
// Run: node scripts/run-build-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
function matchBrace(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

const tblSrc = src.slice(src.indexOf('var _RUN_BUILD={'), src.indexOf('};', src.indexOf('var _RUN_BUILD={')));
const RUNGS = [...tblSrc.matchAll(/'(\d{4}-\d{2}-\d{2})':\{mi:([\d.]+), durationMin:(\d+)\}/g)]
  .map((m) => ({ date: m[1], mi: +m[2], min: +m[3] }));

console.log('\n' + Y + '=== every rung is a Sunday in a week-driven phase ===' + X);
eq('nine rungs, one per remaining Sunday', RUNGS.length, 9);
ok('all fall on a Sunday', RUNGS.every((r) => new Date(r.date + 'T00:00:00').getDay() === 0));
// P5 (2026-10-13..18) is entirely date-driven and holds the race-week taper. A rung there would
// overwrite the taper, so none may exist - and the wiring gates on via==='week' as a second guard.
ok('none lands in P5, the date-driven taper week', RUNGS.every((r) => !(r.date >= '2026-10-13' && r.date <= '2026-10-18')));
ok('none lands on or after race day', RUNGS.every((r) => r.date < '2026-10-18'));
ok('the last rung steps DOWN into the taper', RUNGS[RUNGS.length - 1].mi < Math.max(...RUNGS.map((r) => r.mi)));

console.log('\n' + Y + '=== the build is a build, not a staircase with a cliff in it ===' + X);
{
  // Measured against the highest rung SO FAR, never the previous week: the week after a deliberate
  // cut-back is a return to the build, not a 50% jump, and comparing to the previous week says the
  // opposite. Getting this comparison wrong is how a sane ramp reads as reckless.
  let peak = 0, cutbacks = 0, steps = [];
  RUNGS.forEach((r) => { if (r.mi < peak) cutbacks++; else if (peak) steps.push((r.mi - peak) / peak * 100); if (r.mi > peak) peak = r.mi; });
  eq('two deliberate cut-backs', cutbacks, 2);
  ok('no step over 20% above the prior peak', steps.every((s) => s <= 20));
  ok('...and only the opening step exceeds 15%', steps.filter((s) => s > 15).length <= 1);
  eq('peak is the race distance, not beyond it', peak, 6.2);
  ok('peak is within 5% of a 10k (6.21 mi)', Math.abs(peak - 6.21) / 6.21 < 0.05);
  ok('the ramp starts modestly off a thin run base', RUNGS[0].mi <= 3.5);
}
console.log('\n' + Y + '=== duration tracks distance, and no load is invented ===' + X);
ok('every rung carries a duration', RUNGS.every((r) => r.min > 0));
ok('duration rises with distance', RUNGS.every((r) => Math.abs(r.min / r.mi - 10.5) < 1.2));
// easyRun has no pctFtp, so _planSessionFromDef_ cannot derive a tssTarget for it. That is what makes
// moving durationMin safe: there is no TSS ladder to drift out of step with the struct.
ok('easyRun still has no power band', !/easyRun:\s*\{[^}]*pctFtp/.test(src));
ok('...so TSS is only derived when a band AND a duration exist', /if\(def\.pctFtp && def\.durationMin\)\{/.test(src));

console.log('\n' + Y + '=== a Sunday already run is never re-graded ===' + X);
{
  const stub = {
    _blockDay_: (k) => new Date(k + 'T00:00:00'),
    _tbDK_: (d) => d.toISOString().slice(0, 10),
    _climbRehearsalFor_: () => null
  };
  const names = Object.keys(stub);
  const f = new Function('_RUN_BUILD', '_RUN_STACK_MIN_MI', ...names, exFn('_runBuildFor_') + 'return _runBuildFor_;')
    (Object.fromEntries(RUNGS.map((r) => [r.date, { mi: r.mi, durationMin: r.min }])), 5.0, ...names.map((n) => stub[n]));
  eq('a past Sunday has no rung and is left alone', f('2026-08-09'), null);
  eq('...as is any date not in the table', f('2026-09-01'), null);
  eq('no date, no rung', f(''), null);
  ok('a listed Sunday returns its rung', f('2026-09-20') && f('2026-09-20').mi === 5.0);
}

console.log('\n' + Y + '=== the Saturday collision is NAMED, not silently resolved ===' + X);
{
  // Owner's call: ramp both and flag the collision, decide on the day. So the flag must fire on the
  // weeks where a long run genuinely sits behind a big climbing Saturday - and stay quiet otherwise.
  const CR = JSON.parse('{' + (src.match(/_CLIMB_REHEARSAL=\{([^}]*)\}/) || [])[1].replace(/(\d+):/g, '"$1":') + '}');
  const START = (src.match(/_BLOCK_START\s*=\s*'([\d-]+)'/) || [])[1];
  const absWeek = (k) => { const d = new Date(k + 'T00:00:00'), s0 = new Date(START + 'T00:00:00');
    return d < s0 ? 0 : Math.floor((d - s0) / 86400000 / 7) + 1; };
  const stub = {
    _blockDay_: (k) => new Date(k + 'T00:00:00'),
    _tbDK_: (d) => d.toISOString().slice(0, 10),
    _climbRehearsalFor_: (k) => CR[absWeek(k)] || null
  };
  const names = Object.keys(stub);
  const f = new Function('_RUN_BUILD', '_RUN_STACK_MIN_MI', ...names, exFn('_runBuildFor_') + 'return _runBuildFor_;')
    (Object.fromEntries(RUNGS.map((r) => [r.date, { mi: r.mi, durationMin: r.min }])), 5.0, ...names.map((n) => stub[n]));
  const flagged = RUNGS.filter((r) => { const v = f(r.date); return v && v.stack; }).map((r) => r.date);
  eq('flagged exactly the three crunch weeks', flagged, ['2026-09-20', '2026-09-27', '2026-10-04']);
  eq('...carrying the real climbing minutes', f('2026-10-04').stack, 80);
  ok('a short run behind a big Saturday is NOT flagged', !f('2026-09-06').stack);
  ok('a long run with no Saturday climbing is NOT flagged', !f('2026-10-11').stack);
}

console.log('\n' + Y + '=== the wiring cannot leak onto another slot ===' + X);
{
  const bp = src.slice(src.indexOf('function blockPlanFor_('), src.indexOf('// Weeks the block has slipped'));
  ok('Sunday only', /mon===6/.test(bp));
  ok('easyRun only', /_int==='easyRun'/.test(bp));
  ok("week-driven days only, so P5's taper is untouchable", /via==='week'/.test(bp));
  ok('the struct is REPLACED, not appended to a minute range', /_st=_rb\.mi\.toFixed\(1\)\+' mi easy'/.test(bp));
  ok('the duration target moves with it', /rx\.targets\.durationMin=_rb\.durationMin/.test(bp));
  ok('the collision text reaches the struct', /stacked behind '\+_rb\.stack\+' min of Saturday climbing/.test(bp));
  ok('the distance is exposed on the session', /runMi:\(_rb\?_rb\.mi:null\)/.test(bp));
  // It must not disturb the rehearsal that shares this block.
  ok('the climb rehearsal is still applied', /_cl\+' min sustained climbing block'/.test(bp));
}

console.log('');
if (fails) { console.log(R + 'run build: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'run build: all checks passed' + X + '\n');
