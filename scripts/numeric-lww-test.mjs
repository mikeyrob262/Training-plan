// THE Math.max MERGE BUG, at the root rather than one field at a time.
//
// mergeState_ resolves two numbers with Math.max, so any stored number can be RAISED and never
// LOWERED. With no clock that is correct — two devices, nothing to order them by, keep the fuller
// value. It is wrong the moment one side is stamped, because a correction is usually a downward
// write. Confirmed in the field: a race distance corrected 13.1 -> 6.2 would not persist, and was
// worked around by tombstoning the race and recreating it.
//
// The fix is item-level LWW on editedAt for NUMBERS, applied after the generic union. It needs BOTH
// halves to work: the merge rule, and a writer that stamps. Both are pinned here.
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
  'function arrayToIndexObject_(a){ var o={}; (a||[]).forEach(function(v,i){ o[i]=v; }); return o; }\n' +
  'function mergeArrays_(a,b){ return (a||[]).concat(b||[]); }\n' +
  exFn('isPlainObj_') + exFn('mergeState_') + exVar('_ITEM_LWW_SKIP_') + exFn('_itemLwwNumbers_') +
  'return { mergeState_, _itemLwwNumbers_ };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
// The real pairing: generic union, then the item rule — exactly how mergeArrays_ calls it.
const merge = (a, b) => M._itemLwwNumbers_(M.mergeState_(a, b), a, b);
const OLD = 1000, NEW = 2000;

console.log('\n' + Y + '=== the reported bug: a corrected race distance ===' + X);
{
  const corrected = { id: 'r1', name: 'Race', distance: 6.2, editedAt: NEW };
  const stale = { id: 'r1', name: 'Race', distance: 13.1, editedAt: OLD };
  eq('a stamped downward correction persists', merge(corrected, stale).distance, 6.2);
  eq('...regardless of argument order', merge(stale, corrected).distance, 6.2);
  // Before the fix this was Math.max and returned 13.1 both ways.
  ok('the generic union alone would still have reverted it', M.mergeState_(corrected, stale).distance === 13.1);
}

console.log('\n' + Y + '=== upward corrections work too — this is recency, not "smaller wins" ===' + X);
{
  eq('a stamped increase also persists',
     merge({ id: 'r1', distance: 26.2, editedAt: NEW }, { id: 'r1', distance: 6.2, editedAt: OLD }).distance, 26.2);
  eq('an OLDER correction does NOT win',
     merge({ id: 'r1', distance: 6.2, editedAt: OLD }, { id: 'r1', distance: 13.1, editedAt: NEW }).distance, 13.1);
  eq('every numeric field on the item follows the same clock',
     merge({ id: 'r1', distance: 6.2, elev: 100, tss: 40, editedAt: NEW },
           { id: 'r1', distance: 13.1, elev: 900, tss: 400, editedAt: OLD }),
     { id: 'r1', distance: 6.2, elev: 100, tss: 40, editedAt: NEW });
}

console.log('\n' + Y + '=== with NO clock, max still decides (unchanged, and deliberate) ===' + X);
{
  eq('neither side stamped: the fuller value is kept',
     merge({ id: 'r1', distance: 6.2 }, { id: 'r1', distance: 13.1 }).distance, 13.1);
  eq('a TIE orders nothing, so max still decides',
     merge({ id: 'r1', distance: 6.2, editedAt: OLD }, { id: 'r1', distance: 13.1, editedAt: OLD }).distance, 13.1);
  ok('...which is why a correction MUST stamp editedAt to travel', true);
}

console.log('\n' + Y + '=== numbers only — other semantics are left alone ===' + X);
{
  // Booleans OR by design. The segment target list is built on targetAt/untargetAt timestamps
  // precisely BECAUSE of that, so flipping booleans here would change membership silently.
  eq('a boolean is not flipped by recency',
     merge({ id: 's1', starred: false, editedAt: NEW }, { id: 's1', starred: true, editedAt: OLD }).starred, true);
  // Strings keep their existing resolution (local side wins) - not this fix's business.
  eq('a string is untouched by the numeric rule',
     merge({ id: 's1', name: 'New', editedAt: NEW }, { id: 's1', name: 'Old', editedAt: OLD }).name, 'New');
  // Nested structure must keep merging field-by-field.
  const nested = merge({ id: 's1', t: { a: 1 }, editedAt: NEW }, { id: 's1', t: { b: 2 }, editedAt: OLD });
  eq('a nested object still merges structurally', nested.t, { a: 1, b: 2 });
  ok('...and is not replaced wholesale', nested.t.b === 2);
  // The clock and the tombstone are not payload.
  eq('editedAt keeps the newer stamp', merge({ id: 'r1', editedAt: NEW }, { id: 'r1', editedAt: OLD }).editedAt, NEW);
  eq('deletedAt is not overridden by the rule',
     merge({ id: 'r1', deletedAt: 5, editedAt: NEW }, { id: 'r1', deletedAt: 9, editedAt: OLD }).deletedAt, 9);
  ok('...because deleted state has its own semantics per store', true);
  // Non-objects must pass straight through.
  ok('a non-object pair is returned untouched', M._itemLwwNumbers_(5, 5, 7) === 5);
}

console.log('\n' + Y + '=== both halves are wired: the rule AND a writer that stamps ===' + X);
{
  const arr = src.slice(src.indexOf('function mergeArrays_('), src.indexOf('function mergeArrays_(') + 3000);
  ok('the cluster path applies the numeric rule', /_itemLwwNumbers_\(mergeState_\(/.test(arr));
  ok('...and sessions still take their own field-aware merge', /mergeSession_\(clusters\[ci\]\.rep, item\)/.test(arr));
  // Inert without a stamp: the race editor rebuilt the object from the form with no editedAt.
  const save = src.slice(src.indexOf("id:(existing&&existing.id)?existing.id:'race-'"), src.indexOf("id:(existing&&existing.id)?existing.id:'race-'") + 1200);
  ok('the race editor stamps editedAt on save', /editedAt:Date\.now\(\)/.test(save));
  ok('...and says why, so it is not dropped as noise later', /Math\.max still decides|no clock/.test(save));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'numeric LWW: all checks passed' + X));
process.exit(fails ? 1 : 0);
