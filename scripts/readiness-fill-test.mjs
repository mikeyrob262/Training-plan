// The readiness ring. It is drawn as a fraction and read as a percentage, so the only property
// worth pinning is that it behaves like one: continuous, monotonic in TSB, and anchored to the
// SAME four numbers _RDY_BANDS always used. Before this it was a per-band constant, so every TSB
// from -10 to +10 rendered as exactly 75 - a twenty-point range shown as one exact figure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fnBody, section } from './lib-src-window.mjs';

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

// THE FILL FIX HAD A SIDE EFFECT NOBODY LOOKED FOR. Three surfaces printed Math.round(fill*100).
// While fill was a per-band CONSTANT that was a genuine band step (100/75/50/25). The moment fill
// became continuous, the same expression started manufacturing a percentage again - and a 0-100
// composite reappeared on desktop and calendar beside mobile's banded TSB. At TSB +8: "98/100" and
// "98%". A fix in one place quietly reopened the bug it was fixing, in three others.
console.log('\n' + Y + '=== no surface prints the fill as a score ===' + X);
{
  const r = exFn('readinessFromTSB_');
  ok('readinessFromTSB_ no longer manufactures a score', !/score:\s*Math\.round\(r\.fill\s*\*\s*100\)/.test(r));
  ok('...it exposes fill for the ARC', /fill:r\.fill/.test(r));
  ok('...and the TSB for the NUMBER', /value:\(r\.tsb>0\?'\+':''\)\+Math\.round\(r\.tsb\)/.test(r));
  ok('...carrying the shared band label', /label:r\.label/.test(r));

  // Desktop hero ring + desktop Form Readiness card.
  const ds = fnBody(src, 'dsShowDashboard');
  ok('the desktop hero ring prints the TSB, not a score', /'\+\(rdy\?rdy\.value:'—'\)\+'/.test(ds));
  ok('...with the band label under it, not "/100"', !/>\/100</.test(ds));
  ok('...and its arc is driven by fill', /ringOff=ringC\*\(1-\(rdy\?rdy\.fill:0\)\)/.test(ds));
  // The arc was hardcoded green, so it stayed green through Loaded and Fatigued.
  ok('...and its colour comes from the band', /ringCol=\(rdy&&rdy\.loaded\)\?rdy\.color/.test(ds));
  // THE RECOVERY CARD LEFT THE DASHBOARD for Athlete Intelligence -> Current state, so the three
  // checks that pinned its two modes no longer have a surface to test. They are not simply deleted:
  // one of the guarantees they carried is still live and has moved with the card, and the other two
  // described the FORM-READINESS fallback branch, which is gone because the Readiness ring above
  // already answers that question and the card was a second answer to it.
  ok('NEG: the Dashboard no longer builds a Recovery card', !/var rd=lbl\(recTitle/.test(ds) && !/H\+=card\(rd\)/.test(ds));
  ok('...and its variables left with it', !/recBig|recScore|recSub|recLabel|haveRecovery/.test(ds));
  // THE GUARANTEE THAT SURVIVED, re-pointed at where it now lives. HRV+RHR against a baseline
  // genuinely IS a 0-100 composite of two measurements, so it reads as a percentage - unlike a
  // form-readiness BAND, which is one input scored into a range and must never be dressed as one.
  {
    const cs = fnBody(src, '_ovwCurrentStateHTML_');
    // Whitespace-tolerant: Current state was condensed into a single strip on 2026-08-26 and the
    // cell literals were re-indented. The GUARANTEE is the percent sign on the composite, not the
    // column the property happens to sit in.
    ok('the recovery composite keeps its percentage on its new surface',
       /k:'Recovery',\s*v:rec\.score,\s*unit:'%'/.test(cs));
    ok('...computed once, in the shared accessor', /_recoveryNow_\(\)/.test(cs));
    ok('...and an absent reading says absent rather than substituting a band',
       /No HRV or resting heart rate for today/.test(cs));
  }

  // Calendar ring - the one that printed it outright with a % sign.
  const cal = fnBody(src, 'showCalendarTab');
  ok('the calendar ring prints the TSB', /readyBig=\(_rdyC&&_rdyC\.loaded\)/.test(cal));
  ok('...and no longer renders a % sign', !/\+readiness\+'<tspan/.test(cal));
  ok('...its arc uses fill directly', /off=C\*\(1-readyFill\)/.test(cal));
  ok('...and it shows the shared band', /readyBand=\(_rdyC&&_rdyC\.loaded\)\?_rdyC\.label/.test(cal));

  // Mobile is the reference the other two were converged onto - it must not drift either.
  const home = src.slice(src.indexOf('var _rdyH='), src.indexOf('var _rdyH=') + 2000);
  ok('mobile home still prints the TSB from the shared read',
     /readinessNum=\(_rdyH&&_rdyH\.loaded\)\?\(\(_rdyH\.tsb>0\?'\+':''\)\+Math\.round\(_rdyH\.tsb\)\)/.test(home));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'readiness ring: all checks passed' + X));
process.exit(fails ? 1 : 0);
