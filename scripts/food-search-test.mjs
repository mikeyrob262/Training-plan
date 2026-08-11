// The two searches that were reported wrong, pinned as fixtures.
//
//   "Beef Tenderloin"                 returned ONLY the local "Pork Tenderloin (3 oz)"
//   "Cheesecake Factory Bread Rolls"  returned an unrelated item from that chain
//
// Neither was a retrieval problem - the proxy returns "Beef, tenderloin steak, raw" as its FIRST
// result. Both were caused by a local-first short circuit: if ANY local row matched, the USDA call
// never happened, and local rows were never scored at all. This asserts the scorer and the pool.
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

const M = new Function(asServed(
  exVar('_NL_GENERIC_BONUS') + exFn('_nlNorm_') + exFn('_nlIsGenericTier_') +
  exFn('_nlSearchScore_') + exFn('_nlRankPool_') +
  ';return { _nlSearchScore_, _nlRankPool_ };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log('  ' + (cond ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label); };
const eq = (label, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); if (!good) fails++; console.log('  ' + (good ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label + (good ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const L = (n) => ({ n, dataType: 'Local', generic: false });
const U = (n, dt) => ({ n, dataType: dt || 'SR Legacy', generic: true });

console.log('\n' + Y + '=== "beef tenderloin": the real beef must beat the local pork ===' + X);
{
  const local = [L('Pork Tenderloin (3 oz)')];
  const usda = [U('Beef, tenderloin steak, raw', 'Foundation'), U('Pork, loin, tenderloin, boneless, raw', 'Foundation'),
                U('Ostrich, tenderloin, raw')];
  const out = M._nlRankPool_(local, usda, 'beef tenderloin');
  eq('the beef ingredient ranks first', out[0].n, 'Beef, tenderloin steak, raw');
  ok('the local pork is still offered, just lower', out.some((f) => f.n === 'Pork Tenderloin (3 oz)'));
  ok('...and below the beef', out.findIndex((f) => /^Beef/.test(f.n)) < out.findIndex((f) => /Pork Tenderloin \(/.test(f.n)));
  // coverage is what separates them: 2 of 2 query words vs 1 of 2
  ok('beef scores strictly higher than pork', M._nlSearchScore_(usda[0], 'beef tenderloin') > M._nlSearchScore_(local[0], 'beef tenderloin'));
}

console.log('\n' + Y + '=== "cheesecake factory bread rolls": rolls must not be hidden ===' + X);
{
  const local = [L('Cheesecake Factory Avocado Eggrolls'), L('Cheesecake Factory Cheesecake')];
  const usda = [U('Rolls, dinner, wheat'), U('Bread, roll, Mexican, bollilo'), U('Cake, cheesecake, commercially prepared')];
  const out = M._nlRankPool_(local, usda, 'cheesecake factory bread rolls');
  ok('a bread roll appears at all', out.some((f) => /Rolls|roll/.test(f.n)));
  ok('the chain items are still offered', out.some((f) => /Cheesecake Factory/.test(f.n)));
  ok('nothing scoring zero is shown', out.every((f) => M._nlSearchScore_(f, 'cheesecake factory bread rolls') > 0));
}

console.log('\n' + Y + '=== the guards that must not regress ===' + X);
{
  // An exact product name still wins over a vaguely-matching generic.
  const out = M._nlRankPool_([L("McDonald's Quarter Pounder")], [U('Beef, ground, raw')], 'quarter pounder');
  eq('an exact-ish product name beats a generic', out[0].n, "McDonald's Quarter Pounder");
  // Generic breaks a tie of equal relevance.
  const tie = M._nlRankPool_([], [U('Cheese, cheddar'), { n: 'Cheese, cheddar', dataType: 'Branded', generic: false }], 'cheese cheddar');
  eq('the generic tier wins an otherwise equal match', tie[0].dataType, 'SR Legacy');
  // Noise is excluded rather than ranked low.
  const noise = M._nlRankPool_([L('Banana')], [], 'beef tenderloin');
  eq('a candidate matching no query word is dropped', noise.length, 0);
  // De-dup prefers the local copy (it carries the athlete's own serving).
  const dup = M._nlRankPool_([L('Cheese, cheddar')], [U('Cheese, cheddar')], 'cheese cheddar');
  eq('the same food from both sources appears once', dup.length, 1);
  eq('...and it is the local copy', dup[0].dataType, 'Local');
}

console.log('\n' + Y + '=== USDA is always asked ===' + X);
{
  const flow = src.slice(src.indexOf('function renderFoodRows') - 9000, src.indexOf('function renderFoodRows'));
  ok('no local-first short circuit remains', !/if\(local\.length \|\| !q\)\{/.test(src));
  ok('the fetch is not gated on local being empty', /if\(!q\)\{ renderFoodRows/.test(src));
  ok('USDA results are pooled with local, not swapped in', /_nlRankPool_\(local, results, q\)/.test(src));
  ok('a failed search keeps local rather than blanking', /if\(local\.length\)\{ renderFoodRows\(foodList, _nlRankPool_\(local, \[\], q\)/.test(src));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'food search: all checks passed' + X));
process.exit(fails ? 1 : 0);
