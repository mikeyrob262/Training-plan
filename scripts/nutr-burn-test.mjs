// nutrActualBurn_ picks a calorie figure from the fields a ride ACTUALLY carries. It shipped
// reading r.kj / r.work, and neither exists on a single ride in the library - measured live:
// calories on 693 rides, workKj on 397, kj/work on ZERO. So the kJ tier was dead code and every
// ride without a calories value fell through to the TSS estimate even when it held a real
// measurement. Today's VO2 ride read 480 (48 TSS x 10) instead of its real 335 kJ.
//
// The lesson these assertions encode: pin the FIELD NAMES, not just the arithmetic. A tier that
// reads a field nothing writes is invisible - it degrades silently to the tier below it.
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

let st = { rides: [] };
const M = new Function('st', asServed(exFn('nutrActualBurn_') + ';return { nutrActualBurn_ };'))(st);
const setRides = (rs) => { st.rides.length = 0; rs.forEach((r) => st.rides.push(r)); };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const D = '2026-08-11';

console.log('\n' + Y + '=== the real field names, as the library actually stores them ===' + X);
{
  // This is the exact shape of the ride that was misread: workKj set, NO calories field at all.
  setRides([{ date: D, name: 'Zwift - VO2 Work', workKj: 335.2, tss: 48 }]);
  const b = M.nutrActualBurn_(D);
  eq('a workKj ride reports its real energy, not a TSS estimate', b.cal, 335);
  eq('...and says which source it used', b.src, { kj: 1 });
  ok('...not the TSS fallback, which would have said 480', b.cal !== 480);
}
{
  setRides([{ date: D, calories: 601, workKj: 900, tss: 90 }]);
  eq('recorded calories still win over kJ', M.nutrActualBurn_(D).cal, 601);
  eq('...reported as the calories source', M.nutrActualBurn_(D).src, { calories: 1 });
}
{
  setRides([{ date: D, tss: 48 }]);
  eq('TSS is the LAST resort, not the first', M.nutrActualBurn_(D).cal, 480);
  eq('...and is labelled as such', M.nutrActualBurn_(D).src, { tss: 1 });
}

console.log('\n' + Y + '=== a tier must not read a field nothing writes ===' + X);
{
  // Strip comment lines first: the note above the fix mentions r.kj, and an ordering check that
  // reads comments is testing the prose, not the code.
  const NL = String.fromCharCode(10);
  const body = exFn('nutrActualBurn_').split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);
  ok('the kJ tier reads workKj', /parseFloat\(r\.workKj\)/.test(body));
  ok('...before the legacy aliases', body.indexOf('r.workKj') < body.indexOf('r.kj'));
  ok('the calories tier reads r.calories', /parseFloat\(r\.calories\)/.test(body));
  ok('the TSS tier reads tss', /r\.tss|constRideTSS_/.test(body));
}

console.log('\n' + Y + '=== nothing measured is not a burn of zero ===' + X);
{
  setRides([]);
  eq('no activities at all returns null', M.nutrActualBurn_(D), null);
  setRides([{ date: D, name: 'walk with no data' }]);
  eq('an activity with no energy field returns null, not 0', M.nutrActualBurn_(D), null);
  setRides([{ date: D, calories: 300 }, { date: D, name: 'no data' }]);
  const b = M.nutrActualBurn_(D);
  eq('a mixed day counts what it can', b.cal, 300);
  eq('...and reports what it could not', b.unmeasured, 1);
  eq('...out of how many activities', b.acts, 2);
}
{
  setRides([{ date: '2026-08-10', calories: 500 }]);
  eq('a different date does not leak in', M.nutrActualBurn_(D), null);
  setRides([{ date: '2026-08-11T18:05:28', calories: 500 }]);
  eq('a date carrying a time still matches', M.nutrActualBurn_(D).cal, 500);
  setRides([{ date: D, calories: 500, deleted: true }]);
  eq('a deleted activity is not counted', M.nutrActualBurn_(D), null);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'nutr burn: all checks passed' + X));
process.exit(fails ? 1 : 0);
