// The layout override, and why a silent one reads as a rendering bug.
//
// isDesktop() consults localStorage FIRST and returns before the width check ever runs:
//
//     if(o==='mobile') return false;      // width never consulted
//
// localStorage survives Ctrl+Shift+R and survives closing the tab, so a maximised 1600px window
// renders a 480px phone column and every instinct for fixing it fails. Measured: with the override
// set, isDesktop() false / html.aiq-mobile / widest visible element 480px at innerWidth 1600.
//
// The override stays. What is pinned here is that it can no longer be silent.
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

let store = {};
const win = { innerWidth: 1600, AIQ_DESKTOP_MIN: 1024 };
const M = new Function('localStorage', 'window', asServed(
  exFn('isDesktop') + exFn('_layoutOverrideMismatch_') + NL +
  'return { isDesktop, _layoutOverrideMismatch_ };'
))({ getItem: (k) => (k in store ? store[k] : null) }, win);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== the override beats the width, which is the whole trap ===' + X);
{
  store = {}; win.innerWidth = 1600;
  eq('no override at 1600px is desktop', M.isDesktop(), true);
  store = { aiq_layout: 'mobile' };
  eq('...and the override overrules it entirely', M.isDesktop(), false);
  store = { aiq_layout: 'desktop' }; win.innerWidth = 380;
  eq('it overrules the other way too', M.isDesktop(), true);
  store = {}; win.innerWidth = 380;
  eq('cleared, a phone is a phone again', M.isDesktop(), false);
}

console.log('\n' + Y + '=== a CONTRADICTING override is reported ===' + X);
{
  store = { aiq_layout: 'mobile' }; win.innerWidth = 1600;
  const m = M._layoutOverrideMismatch_();
  ok('the stranding case is detected', !!m);
  eq('...naming what is forced', m.forced, 'mobile');
  eq('...and what the window says', m.autoWouldBe, 'desktop');
  eq('...with the width, so it is checkable', m.width, 1600);

  store = { aiq_layout: 'desktop' }; win.innerWidth = 380;
  const m2 = M._layoutOverrideMismatch_();
  ok('the reverse stranding is detected too', !!m2 && m2.forced === 'desktop' && m2.autoWouldBe === 'mobile');
}

console.log('\n' + Y + '=== an override that AGREES stays quiet ===' + X);
{
  store = { aiq_layout: 'desktop' }; win.innerWidth = 1600;
  eq('desktop forced on a wide window says nothing', M._layoutOverrideMismatch_(), null);
  store = { aiq_layout: 'mobile' }; win.innerWidth = 380;
  eq('mobile forced on a phone says nothing', M._layoutOverrideMismatch_(), null);
  store = {}; win.innerWidth = 1600;
  eq('no override says nothing', M._layoutOverrideMismatch_(), null);
  store = { aiq_layout: 'auto' };
  eq('an unrecognised value is not an override', M._layoutOverrideMismatch_(), null);
  // Exactly at the boundary the two agree, so nothing should fire.
  store = { aiq_layout: 'desktop' }; win.innerWidth = 1024;
  eq('at the breakpoint itself, no complaint', M._layoutOverrideMismatch_(), null);
}

console.log('\n' + Y + '=== the bar offers the way out ===' + X);
{
  const bar = exFn('_renderLayoutOverrideBar_');
  ok('it clears the override rather than forcing the opposite', /setLayoutOverride_\('auto'\)/.test(bar));
  ok('...so the window decides from then on', !/setLayoutOverride_\('desktop'\)|setLayoutOverride_\('mobile'\)/.test(bar));
  ok('it states the forced mode', /locked to '\+m\.forced/.test(bar));
  ok('...and the actual window width', /m\.width\+'px wide/.test(bar));
  ok('it can be dismissed', /x\.onclick=function\(\)\{ bar\.remove\(\); \}/.test(bar));
  ok('it replaces itself rather than stacking', /if\(old\) old\.remove\(\)/.test(bar));
  ok('the action button is house-shaped, not a pill', /border-radius:9px/.test(bar));
  const apply = exFn('applyLayout_');
  ok('it is re-evaluated on every layout pass', /_renderLayoutOverrideBar_\(\)/.test(apply));
  ok('...which includes resize', /addEventListener\('resize', function\(\)\{ clearTimeout\(_layoutRz\)/.test(src));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'layout override: all checks passed' + X));
process.exit(fails ? 1 : 0);
