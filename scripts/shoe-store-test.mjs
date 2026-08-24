// The Gear page's "Accessories" card was a hardcoded array — 'Lake CX301 Cycling Shoes',
// 'Garmin Edge 840', 'Garmin HR Strap' — with no data binding and no edit control, while st.shoes
// sat beside it holding the real pairs. Surfacing st.shoes there meant first giving it the two
// things it never had, because without them an editor would have made things worse rather than
// better:
//
//   1. IDENTITY. mergeArrays_ buckets by 'id' when any item carries one, and otherwise dedupes on
//      JSON.stringify. Shoes carried no id, and 'miles' is RECOMPUTED from matched rides — so the
//      same pair with different mileage on two devices stringified differently and the union kept
//      BOTH. The id is derived from the NAME, not generated, so two devices that each add the same
//      shoe converge on one row.
//
//   2. A REMOVAL NEEDS A TOMBSTONE. mergeState_ resolves arrays by union, so a splice is undone by
//      the next sync. A deleted shoe stays in the array as {deleted:true} and the boolean OR-merges.
//
// Every deletion assertion below is paired with a MERGE: the tombstone is asserted to survive a
// round trip against a remote copy that still holds the shoe live, because "it disappeared from the
// list" and "it stays deleted" are different claims and only the second one matters.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'),
  (_, c) => (c === BS ? BS : c));

function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => {
  const i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  return src.slice(i, matchBrace(i) + 1) + '\n';
};

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

const NAMES = ['_shoeKeyOf_', '_shoeIdFor_', 'ensureShoes_', 'shoesLive_', 'shoeById_',
  'shoeAdd_', 'shoeUpdate_', 'shoeDelete_'];
// The real merge, so the tombstone claims are tested against the code that actually runs.
const MERGE = ['isPlainObj_', 'contentFingerprint_', 'arrayToIndexObject_', 'itemsMatch_',
  'mergeItemFast_', 'mergeArrays_', 'mergeState_', '_isSession_', 'mergeSession_',
  '_itemLwwNumbers_'];

function build(shoes) {
  const st = { shoes: shoes || [] };
  const M = new Function('st', asServed(
    NAMES.concat(MERGE).map(exFn).join('') +
    'return {' + NAMES.concat(MERGE).join(',') + '};'
  ))(st);
  return { st, M };
}

console.log('\n' + Y + '=== the placeholder is gone from the page, not merely unused ===' + X);
{
  // Comments naming the old array are fine and are what document the removal; a live data row is
  // what must not survive. Anything outside a // comment line counts as live.
  const live = src.split('\n').filter(l => /Lake CX301|Garmin Edge 840|Garmin HR Strap/.test(l))
    .filter(l => !/^\s*\/\//.test(l));
  ok('no hardcoded gear row is still rendered', live.length === 0);
  ok('dsShowGear now reads the real store', /shoesLive_/.test(src.slice(src.indexOf('function dsShowGear('), src.indexOf('function dsShowGear(') + 14000)));
}

console.log('\n' + Y + '=== identity is derived from the name, so two devices converge ===' + X);
{
  const { M } = build();
  ok('same name -> same id', M._shoeIdFor_('Asics Nimbus 25') === M._shoeIdFor_('Asics Nimbus 25'));
  ok('case and spacing do not fork it', M._shoeIdFor_('Asics Nimbus 25') === M._shoeIdFor_('  asics  nimbus 25 '));
  ok('punctuation does not fork it', M._shoeIdFor_('Asics Gel-Nimbus 25') === M._shoeIdFor_('Asics Gel Nimbus 25'));
  ok('a different shoe gets a different id  [negative control]',
    M._shoeIdFor_('Asics Nimbus 25') !== M._shoeIdFor_('Asics Nimbus 26'));
  ok('an empty name has no id, rather than a shared one', M._shoeIdFor_('   ') === null);
}

console.log('\n' + Y + '=== legacy rows are backfilled without disturbing the merge ===' + X);
{
  const { st, M } = build([{ name: 'Asics Nimbus 25', miles: 214.3, maxMiles: 400 }]);
  const before = M.contentFingerprint_(st.shoes[0]);
  M.ensureShoes_();
  ok('the id was backfilled', !!st.shoes[0].id);
  ok('it matches what the name derives', st.shoes[0].id === M._shoeIdFor_('Asics Nimbus 25'));
  ok('the content fingerprint is unchanged  [id is excluded from it]',
    M.contentFingerprint_(st.shoes[0]) === before);
}

console.log('\n' + Y + '=== the cross-device duplicate this fixes ===' + X);
{
  // The same pair, mileage recomputed differently on each device. Pre-fix these were two rows.
  const A = build(); A.M.shoeAdd_('Asics Nimbus 25', 400, 214.3);
  const B = build(); B.M.shoeAdd_('Asics Nimbus 25', 400, 218.1);
  const merged = A.M.mergeArrays_(A.st.shoes, B.st.shoes);
  ok('one shoe, not two', merged.length === 1);
  ok('and it is the right one', merged[0].name === 'Asics Nimbus 25');
}

console.log('\n' + Y + '=== add is idempotent and revives rather than duplicating ===' + X);
{
  const { st, M } = build();
  M.shoeAdd_('Asics Nimbus 25', 400, 100);
  M.shoeAdd_('asics nimbus 25', 500, 120);
  ok('re-adding the same shoe does not fork it', st.shoes.length === 1);
  ok('the newer figures land on it', st.shoes[0].miles === 120 && st.shoes[0].maxMiles === 500);
  M.shoeDelete_(st.shoes[0].id);
  ok('deleted', M.shoesLive_().length === 0);
  M.shoeAdd_('Asics Nimbus 25', 400, 130);
  ok('re-adding revives the same row', st.shoes.length === 1);
  ok('...and it is live again', M.shoesLive_().length === 1);
}

console.log('\n' + Y + '=== a deletion is a tombstone and SURVIVES a sync ===' + X);
{
  const local = build(); local.M.shoeAdd_('Asics Nimbus 25', 400, 214.3);
  const remote = build(); remote.M.shoeAdd_('Asics Nimbus 25', 400, 214.3);
  local.M.shoeDelete_(local.st.shoes[0].id);
  ok('gone from the local list', local.M.shoesLive_().length === 0);
  ok('the row is still in the array  [tombstone, not a splice]', local.st.shoes.length === 1);
  // The remote still holds it live. Union must not bring it back.
  const merged = local.M.mergeArrays_(local.st.shoes, remote.st.shoes);
  const after = build(merged);
  ok('the merge keeps one row', merged.length === 1);
  ok('and it stays deleted  [pre-fix: the splice was undone here]', after.M.shoesLive_().length === 0);
  // ...and in the other direction, because merge order must not decide it.
  const merged2 = local.M.mergeArrays_(remote.st.shoes, local.st.shoes);
  ok('order does not change the verdict', build(merged2).M.shoesLive_().length === 0);
}

console.log('\n' + Y + '=== a rename re-keys, it does not strand the row ===' + X);
{
  const { st, M } = build();
  const s = M.shoeAdd_('Asics Nimbus 24', 400, 310);
  const out = M.shoeUpdate_(s.id, { name: 'Asics Nimbus 25' });
  ok('the new row is keyed to the new name', out.id === M._shoeIdFor_('Asics Nimbus 25'));
  ok('mileage came across', out.miles === 310 && out.maxMiles === 400);
  ok('exactly one live shoe', M.shoesLive_().length === 1);
  ok('the old key is tombstoned, so it cannot come back from a remote',
    st.shoes.filter(x => x.id === s.id && x.deleted).length === 1);
}

console.log('\n' + Y + '=== an in-place edit keeps its identity ===' + X);
{
  const { st, M } = build();
  const s = M.shoeAdd_('Asics Nimbus 25', 400, 100);
  const out = M.shoeUpdate_(s.id, { maxMiles: 500, miles: 150 });
  ok('same row, same id', out.id === s.id && st.shoes.length === 1);
  ok('the numbers changed', out.maxMiles === 500 && out.miles === 150);
  ok('no tombstone was created  [negative control]', st.shoes.filter(x => x.deleted).length === 0);
}

console.log('\n' + Y + '=== readers see live shoes only ===' + X);
{
  const { M } = build();
  const a = M.shoeAdd_('Asics Nimbus 25', 400, 100);
  M.shoeAdd_('Hoka Clifton 9', 400, 40);
  M.shoeDelete_(a.id);
  const live = M.shoesLive_();
  ok('one live shoe', live.length === 1);
  ok('and it is the one not deleted', live[0].name === 'Hoka Clifton 9');
  ok('shoeById_ still resolves the tombstone for a revive', !!M.shoeById_(a.id));
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'shoe store: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
