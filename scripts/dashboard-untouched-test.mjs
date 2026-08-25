// WORK SCOPED TO ONE PAGE MUST NOT EDIT ANOTHER PAGE'S CODE.
//
// A Run Training request produced edits to three functions the DASHBOARD renders, in the name of
// consistency and de-duplication. The intent was that the Dashboard would look identical. It did
// not: measured against the commit before that work,
//
//   _ptCardHTML_  left column  width:186px fixed   -> flex:1 1 186px, 170-230px
//                 middle       flex:1              -> flex:2 1 300px; min-width:240px
//                 right        width:344px fixed   -> flex:1 1 300px; min-width:250px
//                 row          no wrapping         -> flex-wrap:wrap
//                 up/down      #22c55e / #ef4444   -> var(--c-green) / var(--c-red)
//   _ptChart_     colour literals became parameters
//   _balCols_     gained a full-width opt-out - and _balCols_ is Overview and DNA, not just Run
//
// In dark mode --c-green is #4ade80, so every up-arrow and the headline percentage changed shade.
// The column widths changed at every viewport. None of that was asked for.
//
// This file is the standing guard. It pins the BODY of every function the Dashboard renders that
// this session touched, against its state in BASELINE below. If a future change to another page
// needs one of these, that is a conversation to have first - not a diff to discover afterwards.
//
// TO CHANGE ONE OF THESE DELIBERATELY: update BASELINE to the new commit in the same change that
// edits the function, so the pin moves with an explicit decision rather than being silenced.
//
// Run: node scripts/dashboard-untouched-test.mjs
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '9a64e43';   // the commit before the Legacy / Run Training session

// Every one of these is rendered by the Dashboard (or, for _balCols_, by Overview and DNA).
const PINNED = ['_ptCardHTML_', '_ptChart_', '_balCols_'];

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

function body(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1).replace(/\r\n/g, '\n'); }
  }
  return null;
}

let base;
try {
  base = execFileSync('git', ['show', BASELINE + ':worker.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
} catch (e) {
  console.log('  ' + Y + 'SKIP' + X + '  baseline ' + BASELINE + ' is not reachable from this checkout');
  process.exit(0);
}
const cur = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

console.log('\n' + Y + '=== Dashboard-rendered code is exactly as it was at ' + BASELINE + ' ===' + X);
for (const n of PINNED) {
  const a = body(base, n), b = body(cur, n);
  ok(n + ' still exists', !!b);
  if (!a) { ok(n + ' was in the baseline', false); continue; }
  const same = a === b;
  ok(n + ' is byte-identical to the baseline', same);
  if (!same && b) {
    // Name the first difference, so a failure says WHAT moved rather than only that something did.
    const la = a.split('\n'), lb = b.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.log('    ' + R + 'first difference at line ' + (i + 1) + ' of the function:' + X);
        console.log('      baseline: ' + JSON.stringify((la[i] || '(absent)').trim().slice(0, 110)));
        console.log('      current : ' + JSON.stringify((lb[i] || '(absent)').trim().slice(0, 110)));
        break;
      }
    }
  }
}

// NEGATIVE CONTROL. If body() silently returned null or the two sides were compared as the same
// string by accident, every check above would pass on a file that had been rewritten. So prove the
// comparison can actually FAIL: a function this session legitimately DID change must show as
// different from its baseline.
console.log('\n' + Y + '=== the comparison can detect a change ===' + X);
{
  const a = body(base, 'renderRunInto_'), b = body(cur, 'renderRunInto_');
  ok('renderRunInto_ is readable on both sides', !!a && !!b);
  ok('NEG: and it reports as CHANGED, because this session rebuilt the Run page', a !== b);
}

// The shared helpers that caused it must stay gone.
console.log('\n' + Y + '=== the shared shell is not back ===' + X);
['_ptTrajShell_', '_ptDriverRows_', '_ptPanelHead_'].forEach(n =>
  ok('NEG: ' + n + ' does not exist', cur.indexOf('function ' + n + '(') < 0));
ok('NEG: the run card does not call the Dashboard chart',
   (body(cur, '_rtCardHTML_') || '').indexOf('_ptChart_') < 0);
ok('the run card has its own chart instead', !!body(cur, '_rtChart_'));

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'dashboard untouched: all checks passed' + X));
process.exit(fails ? 1 : 0);
