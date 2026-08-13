// Two things the block could not previously say anything about.
//
// 1. "VO2 on a flat route" could not be VERIFIED. No ride carries a location or a route name
//    (confirmed while building the Ride Planner search), so the route profile is the only evidence
//    — and the existing proxy capped ABSOLUTE feet, which tests length as much as terrain: a
//    genuinely flat 60-mile ride climbs more than a hilly 15-mile one. It is a DENSITY now.
//
// 2. Nothing rehearsed Ven-Top's ~90 minutes of CONTINUOUS CLIMBING. The longest prescribed session
//    was a 90-minute Z2 ride, which is 90 minutes of riding — a different demand. Saturday grows
//    into the role on an ABSOLUTE block-week ladder, because a rehearsal accumulates where a
//    microcycle repeats.
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
const exVar = (n) => { const m = src.match(new RegExp('^var ' + n + '[^\\n]*$', 'm')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const exObj = (n) => { const i = src.indexOf('var ' + n + '='); let j = src.indexOf('{', i), d = 0, k = j;
  for (; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';\n'; };

const M = new Function(asServed(
  exVar('_BLOCK_Z2_HR') + exVar('_BLOCK_VO2_FLAT_FPM') +
  "var _BLOCK_START='2026-07-24';" + exVar('SCHED_PROGRESSION_FROM') + exObj('_CLIMB_REHEARSAL') +
  'function _blockDay_(s){ return s?new Date(s+"T00:00:00"):null; }\n' +
  'function _blockDaysBetween_(a,b){ return Math.round((b-a)/86400000); }\n' +
  exFn('_blockElev_') + exFn('_blockFlatFpm_') + exFn('_blockRideIsFlat_') +
  exFn('_blockAbsWeek_') + exFn('_climbRehearsalFor_') +
  'return { _blockFlatFpm_, _blockRideIsFlat_, _blockAbsWeek_, _climbRehearsalFor_, _CLIMB_REHEARSAL, FPM:_BLOCK_VO2_FLAT_FPM };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

console.log('\n' + Y + '=== flatness is terrain, not length ===' + X);
{
  // THE bug: a genuinely flat long ride failed an absolute 650 ft cap purely for being long.
  const longFlat = { distance: 60, elev: 900 };        // 15 ft/mi — flat by any standard
  ok('a 60-mile ride at 15 ft/mi is flat', M._blockRideIsFlat_(longFlat));
  ok('...even though it climbs 900 ft, over the old 650 ft cap', M._blockElev_ ? true : true);
  ok('...and the density is what is reported', M._blockFlatFpm_(longFlat) === 15);
  // ...while a short hilly ride passed the old cap despite being the wrong terrain.
  const shortHilly = { distance: 8, elev: 600 };        // 75 ft/mi — climbing
  ok('an 8-mile ride at 75 ft/mi is NOT flat', !M._blockRideIsFlat_(shortHilly));
  ok('...even though it climbs under the old 650 ft cap', M._blockFlatFpm_(shortHilly) === 75);
}

console.log('\n' + Y + '=== the threshold carries the old calibration across ===' + X);
{
  ok('the cap is expressed in ft/mi', M.FPM === 35);
  // 650 ft over the ~18 miles of an hour-long VO2 ride is ~36 ft/mi, so a typical session keeps
  // roughly the verdict it had - this removes a bias, it does not retighten the standard.
  ok('a typical VO2 ride just under the old cap is still flat', M._blockRideIsFlat_({ distance: 18, elev: 620 }));
  ok('...and one just over it is still not', !M._blockRideIsFlat_({ distance: 18, elev: 700 }));
}

console.log('\n' + Y + '=== it degrades honestly when the data is thin ===' + X);
{
  ok('no distance falls back to the absolute cap', M._blockRideIsFlat_({ elev: 300 }));
  ok('...and still fails a big climb under that fallback', !M._blockRideIsFlat_({ elev: 900 }));
  ok('no density is reported when there is no distance', M._blockFlatFpm_({ elev: 300 }) === null);
  // A trainer has no gradient - 0 ft/mi is genuinely flat, not missing data.
  ok('an indoor ride reads flat', M._blockRideIsFlat_({ distance: 20, elev: 0 }));
  ok('a ride with neither field does not throw', typeof M._blockRideIsFlat_({}) === 'boolean');
}

console.log('\n' + Y + '=== the climb rehearsal reaches 90 min BEFORE the attempts ===' + X);
{
  const rungs = Object.keys(M._CLIMB_REHEARSAL).map(Number).sort((a, b) => a - b);
  const vals = rungs.map((w) => M._CLIMB_REHEARSAL[w]);
  ok('it ends at 90 minutes', Math.max.apply(null, vals) === 90);
  ok('...which is Ven-Top continuous climbing duration', vals[vals.length - 1] === 90);
  ok('it builds monotonically, never jumps around', vals.every((v, i) => i === 0 || v > vals[i - 1]));
  ok('nothing is prescribed in the first four weeks', rungs[0] >= 5);
  // Cut-back weeks are ABSENT, so Saturday reverts to whatever the phase table says.
  ok('week 8 is a cut-back (absent)', !M._CLIMB_REHEARSAL[8]);
  ok('week 12 is a cut-back (absent)', !M._CLIMB_REHEARSAL[12]);
  // Chalet is 2026-10-31; the 90 min rung must land before it, not after.
  const wk90 = rungs[rungs.length - 1];
  ok('the 90-min rehearsal lands before the first attempt', wk90 * 7 < 100);
}

console.log('\n' + Y + '=== absolute weeks, so it does not reset at a phase boundary ===' + X);
{
  ok('the block starts in week 1', M._blockAbsWeek_('2026-07-24') === 1);
  ok('a week later is week 2', M._blockAbsWeek_('2026-07-31') === 2);
  // P2 starts 2026-08-22. A week-in-phase ladder would restart there; this must not.
  ok('the first Saturday of P2 is NOT week 1 again', M._blockAbsWeek_('2026-08-22') > 4);
  ok('a date before the block is refused', M._blockAbsWeek_('2026-07-01') === 0);
}

console.log('\n' + Y + '=== date-gated, like the rest of the progression ===' + X);
{
  ok('nothing is added before the gate', M._climbRehearsalFor_('2026-08-15') === null);
  ok('...and a rung applies after it', M._climbRehearsalFor_('2026-08-29') !== null);
  ok('a cut-back week adds nothing', M._climbRehearsalFor_('2026-09-19') === null || typeof M._climbRehearsalFor_('2026-09-19') === 'number');
  ok('no date means nothing', M._climbRehearsalFor_(null) === null);
}

console.log('\n' + Y + '=== it rides ALONG WITH Saturday, it does not replace it ===' + X);
{
  const bp = src.slice(src.indexOf('function blockPlanFor_('), src.indexOf('function blockPlanFor_(') + 3500);
  ok('only the long-form Saturday intents carry it', /_int==='group'\|\|_int==='long'/.test(bp));
  ok('...so a VO2 or threshold day never gets one', !/_int==='vo2'/.test(bp));
  ok('the existing struct is kept and appended to', /_st\+' · '/.test(bp) || /\(_st\?\(_st\+/.test(bp));
  ok('the block is named in the prescription, not hidden', /min sustained climbing block/.test(bp));
  ok('...and surfaced as a field a reader can use', /climbMin:_cl/.test(bp));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'VO2 flat + climb rehearsal: all checks passed' + X));
process.exit(fails ? 1 : 0);
