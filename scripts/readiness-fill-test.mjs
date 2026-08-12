// The readiness ring. It is drawn as a fraction and read as a percentage, so the only property
// worth pinning is that it behaves like one: continuous, monotonic in TSB, and anchored to the
// SAME four numbers _RDY_BANDS always used. Before this it was a per-band constant, so every TSB
// from -10 to +10 rendered as exactly 75 - a twenty-point range shown as one exact figure.
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
const NL = String.fromCharCode(10);
const bandsSrc = src.slice(src.indexOf('var _RDY_BANDS=['), src.indexOf('];', src.indexOf('var _RDY_BANDS=[')) + 2);

const M = new Function(asServed(
  bandsSrc + NL + 'var _RDY_FLOOR_TSB=-40;' + NL + exFn('_rdyFill_') +
  ';return { _rdyFill_, _RDY_BANDS };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
const f = M._rdyFill_;

console.log('\n' + Y + '=== the four anchors are exactly what they always were ===' + X);
{
  eq('TSB +10 fills the ring', f(10), 1.00);
  eq('TSB -10 is 0.75', f(-10), 0.75);
  eq('TSB -25 is 0.50', f(-25), 0.50);
  eq('TSB -40 is 0.25', f(-40), 0.25);
  ok('the anchors come from _RDY_BANDS, not a second table',
     M._RDY_BANDS.map((b) => b.fill).join() === '1,0.75,0.5,0.25');
}

console.log('\n' + Y + '=== a twenty-point range is no longer one number ===' + X);
{
  // The reported defect, exactly. Every one of these used to be 75.
  const band = [-10, -5, 0, 5, 9].map((t) => Math.round(f(t) * 100));
  eq('the Balanced band now resolves', band, [75, 81, 88, 94, 99]);
  ok('...into five distinct readings', new Set(band).size === 5);
  ok('a week of fatigue moves the ring', Math.round(f(4) * 100) !== Math.round(f(-6) * 100));
}

console.log('\n' + Y + '=== continuous and monotonic, with no step at a band edge ===' + X);
{
  let worstJump = 0, prev = null, monotonic = true;
  for (let t = -60; t <= 30; t += 0.5) {
    const v = f(t);
    if (prev !== null) {
      if (v < prev - 1e-9) monotonic = false;
      worstJump = Math.max(worstJump, v - prev);
    }
    prev = v;
  }
  ok('readiness never falls as form improves', monotonic);
  ok('no discontinuity at any band boundary (worst 0.5-point step ' + worstJump.toFixed(4) + ')', worstJump < 0.02);
  ok('crossing -10 does not jump', Math.abs(f(-9.99) - f(-10.01)) < 0.01);
  ok('crossing -25 does not jump', Math.abs(f(-24.99) - f(-25.01)) < 0.01);
  ok('crossing +10 does not jump', Math.abs(f(9.99) - f(10.01)) < 0.01);
}

console.log('\n' + Y + '=== the ends are honest ===' + X);
{
  eq('very fresh is capped, not extrapolated past full', f(60), 1.00);
  ok('...and cannot exceed the ring', f(200) <= 1.00);
  eq('deep fatigue floors at 0.25', f(-60), 0.25);
  ok('...it is never rendered as 0% ready', f(-999) > 0);
  eq('a missing TSB is nothing, not a full ring', f(null), 0);
  eq('junk is nothing too', f('nonsense'), 0);
}

console.log('\n' + Y + '=== the verdict still comes from the band, not the fill ===' + X);
{
  const g = exFn('getReadiness_');
  ok('label/colour/coaching still read off the band', /label:b\.label/.test(g) && /col:b\.col/.test(g) && /sub:b\.sub/.test(g));
  ok('...and only the fill is interpolated', /fill:_rdyFill_\(tsb\)/.test(g));
  ok('the old constant is no longer served', !/fill:b\.fill/.test(g));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'readiness ring: all checks passed' + X));
process.exit(fails ? 1 : 0);
