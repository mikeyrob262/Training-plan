// THE OVERVIEW PACKS ITS OWN COLUMNS, AND THE DNA PAGE IS NOT DRAGGED ALONG.
//
// _balCols_ walks cards in AUTHORED order and puts each in whichever column is currently shorter -
// first-fit, which never considers size. On the Overview that produced:
//
//   goals 323 -> A, dna 416 -> B, perf 177 -> A, running 96 -> B, coach 320 -> A, signals 96 -> B
//
// leaving 850 against 638: Goals, Performance and AI Coach stacked in one column while the other ran
// 200px short. No amount of trimming a card fixes an assignment that never looked at heights.
//
// The fix is an Overview-LOCAL copy, because _balCols_ is shared with the DNA page and repacking
// there would move a page nobody asked about. Two claims are pinned here and the second matters as
// much as the first:
//
//   the Overview copy assigns longest-first and then improves, and still appends in authored order
//   so reading order within a column is unchanged;
//
//   _balCols_ is BYTE-IDENTICAL to the shared version it was copied from, and dna-bal still routes
//   to it.
//
// Run: node scripts/ovw-balance-test.mjs
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => {
  const c = JSON.stringify(got) === JSON.stringify(want);
  if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
};
function body(s, n) {
  const i = s.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = s.indexOf('{', i); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return s.slice(i, j + 1).replace(/\r\n/g, '\n'); }
  }
  return null;
}

console.log('');
console.log(Y + '=== the shared balancer is untouched, and still serves the DNA page ===' + X);
{
  const BASELINE = 'HEAD';
  let base = null;
  try { base = execFileSync('git', ['show', BASELINE + ':worker.js'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 }).toString('utf8'); } catch (e) {}
  if (!base) console.log('  ' + Y + 'SKIP' + X + '  baseline not reachable');
  else ok('_balCols_ is byte-identical to the committed version', body(base, '_balCols_') === body(src, '_balCols_'));
  const all = body(src, '_balAll_');
  ok('dna-bal still routes to the SHARED balancer', /\['dna-bal', _balCols_\]/.test(all));
  ok('...and ov-bal routes to the Overview copy', /'ov-bal',\s*\(typeof _ovwBalCols_/.test(all));
  ok('the Overview copy exists and is its own function', !!body(src, '_ovwBalCols_'));
  ok('NEG: it is not just calling the shared one', (body(src, '_ovwBalCols_') || '').indexOf('_balCols_(') < 0);
}

console.log('');
console.log(Y + '=== the packing itself ===' + X);
{
  const b = body(src, '_ovwBalCols_');
  ok('assignment is longest-first, not authored order', /sort\(function\(a,b\)\{ return hs\[b\]-hs\[a\]; \}\)/.test(b));
  ok('...followed by an improvement pass', /heights\[t\]-cost, heights\[k2\]\+cost/.test(b));
  ok('...that also tries a swap', /heights\[t\]-ci\+cj, heights\[o\]-cj\+ci/.test(b));
  ok('both only accept a STRICT improvement, so neither can oscillate',
     (b.match(/< heights\[t\]-0\.5/g) || []).length === 2);
  ok('and it is bounded', /pass<40/.test(b));
  ok('cards are APPENDED in authored order, so reading order is unchanged',
     /cards\.forEach\(function\(c,ix\)\{ cols\[owner\[ix\]\]\.appendChild\(c\); \}\)/.test(b));
  ok('heights are measured at COLUMN width, not in the full-width host',
     /cards\.forEach\(function\(c\)\{ cols\[0\]\.appendChild\(c\); \}\)/.test(b));
  ok('below the threshold it is one column in authored order', /flex-direction:column/.test(b));
}

console.log('');
console.log(Y + '=== the algorithm, on the real card set ===' + X);
{
  // The six Overview cards as measured live at 1512x900. Re-implemented here exactly as the function
  // does it, so the claimed improvement is arithmetic rather than a screenshot.
  const GAP = 10;
  const cards = [
    { n: 'goals', h: 323 }, { n: 'dna', h: 416 }, { n: 'perf', h: 177 },
    { n: 'running', h: 96 }, { n: 'coach', h: 320 }, { n: 'signals', h: 96 }
  ];
  const hs = cards.map(c => c.h);

  // What the SHARED balancer does: authored order, into whichever column is shorter.
  let ha = 0, hb = 0;
  cards.forEach((c, i) => { if (ha <= hb) ha += hs[i] + GAP; else hb += hs[i] + GAP; });
  const firstFit = Math.max(ha, hb);

  // What the Overview copy does.
  const heights = [0, 0], owner = [];
  cards.map((c, i) => i).sort((a, b) => hs[b] - hs[a]).forEach(ix => {
    const lo = heights[1] < heights[0] ? 1 : 0;
    owner[ix] = lo; heights[lo] += hs[ix] + GAP;
  });
  const tallest = () => (heights[1] > heights[0] ? 1 : 0);
  for (let pass = 0; pass < 40; pass++) {
    const t = tallest(); let moved = false;
    for (let i = 0; i < cards.length && !moved; i++) {
      if (owner[i] !== t) continue;
      const cost = hs[i] + GAP, k = 1 - t;
      if (Math.max(heights[t] - cost, heights[k] + cost) < heights[t] - 0.5) {
        heights[t] -= cost; heights[k] += cost; owner[i] = k; moved = true;
      }
    }
    if (moved) continue;
    for (let i = 0; i < cards.length && !moved; i++) {
      if (owner[i] !== t) continue;
      for (let j = 0; j < cards.length && !moved; j++) {
        if (owner[j] === t) continue;
        const o = owner[j], ci = hs[i] + GAP, cj = hs[j] + GAP;
        if (Math.max(heights[t] - ci + cj, heights[o] - cj + ci) < heights[t] - 0.5) {
          heights[t] += cj - ci; heights[o] += ci - cj; owner[i] = o; owner[j] = t; moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const packed = Math.max(heights[0], heights[1]);

  console.log('  first-fit (shared): ' + firstFit + '   longest-first + improve (Overview): ' + packed);
  eq('the shared balancer would leave 850', firstFit, 850);
  ok('the Overview copy is strictly better (' + packed + ')', packed < firstFit);
  ok('...and the gap between columns closes to under 60px',
     Math.abs(heights[0] - heights[1]) < 60);
  // NEGATIVE CONTROL: every card must still be placed exactly once.
  eq('every card is placed, none twice', owner.filter(o => o === 0 || o === 1).length, cards.length);
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'overview balance: all checks passed' + X));
process.exit(fails ? 1 : 0);
