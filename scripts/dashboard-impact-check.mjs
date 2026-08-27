// DID TODAY'S WORK REACH THE DASHBOARD?
//
// Asked directly after the Overview pass touched card and column layout. The answer must be
// established, not assumed: the same question was asked after the Run Training work and the honest
// answer that time was yes.
//
// Method, in order:
//   1  extract every top-level function body from the baseline commit and from HEAD
//   2  list the ones that DIFFER, plus any that were added or removed
//   3  compute what the Dashboard entry points actually reach, transitively
//   4  intersect
//
// Reachability is computed over the whole call graph rather than one level, because the question is
// "can a change get there at all", and for that a false positive is cheap and a false negative is
// the entire failure.
//
// Run: node scripts/dashboard-impact-check.mjs [baselineCommit]
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'a1a2e1b';
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';

const head = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
let base;
try {
  base = execFileSync('git', ['show', BASE + ':worker.js'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n');
} catch (e) {
  console.log(R + 'FAILED' + X + '  cannot read baseline ' + BASE + ': ' + e.message);
  process.exit(1);
}

function bodies(src) {
  const out = new Map();
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', re.lastIndex);
    if (open < 0) continue;
    let d = 0, end = -1;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) { end = j; break; } }
    }
    if (end < 0) continue;
    if (!out.has(m[1])) out.set(m[1], src.slice(m.index, end + 1));
  }
  return out;
}

const H = bodies(head), B = bodies(base);

// ---- 1 & 2: what changed ----
const changed = [], added = [], removed = [];
for (const [n, body] of H) {
  if (!B.has(n)) added.push(n);
  else if (B.get(n) !== body) changed.push(n);
}
for (const n of B.keys()) if (!H.has(n)) removed.push(n);

// Top-level `var` declarations can carry layout too (thresholds, colour maps, order lists).
function topVars(src) {
  const out = new Map();
  const re = /^var\s+([A-Za-z_$][\w$]*)\s*=([^\n]*)$/gm;
  let m;
  while ((m = re.exec(src))) if (!out.has(m[1])) out.set(m[1], m[2].trim());
  return out;
}
const HV = topVars(head), BV = topVars(base);
const varsChanged = [];
for (const [n, v] of HV) if (BV.has(n) && BV.get(n) !== v) varsChanged.push(n);

// ---- 3: what the Dashboard reaches ----
const names = [...H.keys()];
const calls = new Map();
for (const [n, body] of H) {
  const inner = body.slice(body.indexOf('{'));
  const s = new Set();
  for (const c of names) if (c !== n && c.length > 3 && inner.includes(c + '(')) s.add(c);
  calls.set(n, s);
}
const SEEDS = ['dsShowDashboard', 'showHomeDash', 'renderHomeTSSAndPR', 'renderAchievementStrip'].filter(n => H.has(n));
const reach = new Set(SEEDS);
const stack = [...SEEDS];
while (stack.length) {
  const n = stack.pop();
  for (const c of calls.get(n) || []) if (!reach.has(c)) { reach.add(c); stack.push(c); }
}

// A changed top-level var reaches the Dashboard if any reachable function mentions it.
const varReaches = n => [...reach].some(f => {
  const b = H.get(f); return b && b.slice(b.indexOf('{')).includes(n);
});

console.log('');
console.log(Y + '=== what changed since ' + BASE + ' ===' + X);
console.log('  ' + changed.length + ' functions changed, ' + added.length + ' added, ' + removed.length + ' removed, '
  + varsChanged.length + ' top-level vars changed');
console.log('');
console.log(Y + '=== what the Dashboard reaches ===' + X);
console.log('  seeds: ' + SEEDS.join(', '));
console.log('  ' + reach.size + ' functions reachable transitively');

const hitFns = changed.filter(n => reach.has(n));
const hitAdded = added.filter(n => reach.has(n));
const hitVars = varsChanged.filter(varReaches);

console.log('');
console.log(Y + '=== the intersection ===' + X);
if (!hitFns.length && !hitAdded.length && !hitVars.length) {
  console.log('  ' + G + 'NONE' + X + '  no function or variable changed today is reachable from the Dashboard');
} else {
  hitFns.forEach(n => console.log('  ' + R + 'REACHES' + X + '  ' + n + '()  changed AND reachable'));
  hitAdded.forEach(n => console.log('  ' + R + 'REACHES' + X + '  ' + n + '()  added AND reachable'));
  hitVars.forEach(n => console.log('  ' + R + 'REACHES' + X + '  var ' + n + '  changed AND mentioned by a reachable function'));
}

// The specific functions named in the report, checked by name whatever the graph says.
console.log('');
console.log(Y + '=== the two named in the report ===' + X);
['_ovwCard_', '_ovwBalCols_', '_balCols_', '_balAll_'].forEach(n => {
  const inH = H.has(n), inB = B.has(n);
  const same = inH && inB && H.get(n) === B.get(n);
  const state = !inB ? 'NEW today' : (same ? 'byte-identical to ' + BASE : 'CHANGED today');
  console.log('  ' + (same || !inB ? G : Y) + state + X + '  ' + n
    + '   reachable from Dashboard: ' + (reach.has(n) ? R + 'YES' + X : G + 'no' + X));
});

console.log('');
const verdict = (!hitFns.length && !hitAdded.length && !hitVars.length);
console.log(verdict
  ? (G + 'VERDICT: nothing changed today can reach the Dashboard.' + X)
  : (R + 'VERDICT: today\'s work IS reachable from the Dashboard - see above.' + X));
process.exit(0);
