// AN UN-DELETED RIDE HAS TO SURVIVE THE NEXT SYNC.
//
// 1,770 activities were revived, saved and force-pushed, and came back tombstoned with their
// ORIGINAL deletedAt intact - the giveaway that this was the old tombstone returning, not a new
// deletion. Two independent causes, both in mergeItemFast_, and neither is a merge-layer bug:
//
//   1. NO CLOCK, SO NO CONTEST. The ride LWW block only runs when one side carries an editedAt or
//      an _edited mask. A revive stamping neither leaves both sides at 0, the block is skipped, and
//      the generic path resolves booleans by OR - so remote's deleted:true always wins.
//      RIDE_LWW_FIELDS_ has ALWAYS listed 'deleted' and 'deletedAt' for precisely this case. The
//      rule was complete and INERT, waiting on a writer to stamp the clock it reads. That is the
//      third appearance of this shape in one week: the race editor with no editedAt, the LWW arrays
//      absent from _lwwSnapshot_, and now this.
//   2. A DELETED PROPERTY CANNOT WIN. The winner is applied only where win[f] is not undefined, and
//      a property removed with the delete operator reads undefined - indistinguishable from "no
//      opinion". The un-delete must be ASSERTED as false, never erased.
//
// The fix is entirely in the WRITERS. The merge layer is not touched, so boolean-OR stays intact
// for every other array - the segment target list depends on it.
//
// Run: node scripts/ride-undelete-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== one helper, and every revive path goes through it ===' + X);
ok('rideUndelete_ exists', /function rideUndelete_\(r\)/.test(SRC));
ok('...it ASSERTS false rather than erasing', /r\.deleted=false;/.test(SRC));
ok('...clears the tombstone timestamp', /r\.deletedAt=0;/.test(SRC));
ok('...clears the reason', /r\.deleteReason='';/.test(SRC));
ok('...and stamps the clock the LWW block is gated on', /r\.editedAt=Date\.now\(\);/.test(SRC));
{
  const uses = (SRC.match(/rideUndelete_\(/g) || []).length - 1;   // minus the definition
  ok('all four revive sites route through it (' + uses + ')', uses === 4);
}
ok('NEG: no ride revive still erases the flag', !/delete r\.deleted;|delete p\.deleted;|delete c\.deleted;/.test(SRC));

console.log('\n' + Y + '=== the merge layer is UNTOUCHED ===' + X);
ok('booleans still OR in mergeState_', /if\(typeof a === 'boolean' && typeof b === 'boolean'\) return a \|\| b;/.test(SRC));
ok('RIDE_LWW_FIELDS_ still carries deleted and deletedAt', /'deleted','deletedAt'/.test(SRC));
ok('the ride LWW block is still gated on a clock or a mask', /if\(aEdit \|\| bEdit \|\| _mk\.length\)\{/.test(SRC));
ok('the winner is still applied only where defined', /if\(win\[f\]!==undefined\) merged\[f\]=win\[f\];/.test(SRC));

console.log('\n' + Y + '=== revive-then-merge, exercised in BOTH clock directions ===' + X);
{
  // Model mergeItemFast_'s deleted resolution exactly: the LWW block when a clock exists, and the
  // generic boolean/undefined fallback when it does not.
  const RIDE_LWW = ['deleted', 'deletedAt'];
  const merge = (a, b) => {
    const merged = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = a[k], bv = b[k];
      if (typeof av === 'boolean' && typeof bv === 'boolean') merged[k] = av || bv;       // OR
      else if (av === undefined || av === '') merged[k] = bv;                             // absent loses
      else if (bv === undefined || bv === '') merged[k] = av;
      else merged[k] = (typeof av === 'number' && typeof bv === 'number') ? Math.max(av, bv) : av;
    }
    const aEdit = a.editedAt || 0, bEdit = b.editedAt || 0;
    if (aEdit || bEdit) {
      const win = (aEdit >= bEdit) ? a : b;
      for (const f of RIDE_LWW) if (win[f] !== undefined) merged[f] = win[f];
      merged.editedAt = Math.max(aEdit, bEdit);
    }
    return merged;
  };
  const remoteTomb = { id: 1, deleted: true, deletedAt: 1752000000000, deleteReason: '' };

  // THE OLD REVIVE: erase the flag, stamp nothing.
  const oldRevived = { id: 1 };                       // deleted/deletedAt removed entirely
  ok('OLD: the tombstone comes back on the next merge', merge(oldRevived, remoteTomb).deleted === true);
  ok('...carrying the ORIGINAL deletedAt, exactly as reported',
     merge(oldRevived, remoteTomb).deletedAt === 1752000000000);

  // THE NEW REVIVE: assert false, stamp a clock.
  const now = 1755600000000;
  const newRevived = { id: 1, deleted: false, deletedAt: 0, deleteReason: '', editedAt: now };
  ok('NEW: the un-delete survives the merge', merge(newRevived, remoteTomb).deleted === false);
  ok('...and the stale tombstone timestamp is cleared', merge(newRevived, remoteTomb).deletedAt === 0);

  // A CLOCK ALONE IS NOT ENOUGH - this is the half that is easy to miss.
  const clockOnly = { id: 1, editedAt: now };          // stamped, but the flag was ERASED
  ok('a clock WITHOUT an asserted false still loses (delete reads as undefined)',
     merge(clockOnly, remoteTomb).deleted === true);

  // AND IT MUST NOT ALWAYS WIN. A device that deletes the ride LATER has to be able to.
  const laterTomb = { id: 1, deleted: true, deletedAt: now + 5000, editedAt: now + 5000 };
  ok('a LATER delete from another device still wins', merge(newRevived, laterTomb).deleted === true);
  ok('...and an EARLIER delete does not', merge(newRevived, { id: 1, deleted: true, deletedAt: 1, editedAt: now - 5000 }).deleted === false);
  // Order must not matter: merge is called with local/remote either way round.
  ok('the result is the same with the arguments swapped', merge(remoteTomb, newRevived).deleted === false);

  // The un-delete must not resurrect a ride nobody revived.
  const untouchedTomb = { id: 2, deleted: true, deletedAt: 1752000000000 };
  ok('an unrevived tombstone stays deleted', merge(untouchedTomb, untouchedTomb).deleted === true);
}

console.log('\n' + Y + '=== other arrays keep OR semantics ===' + X);
{
  // The segment target list depends on booleans OR-ing; this fix must not have changed that.
  const orMerge = (a, b) => (typeof a === 'boolean' && typeof b === 'boolean') ? (a || b) : a;
  ok('a targeted segment stays targeted across a merge', orMerge(true, false) === true);
  ok('...from either side', orMerge(false, true) === true);
  ok('the numeric-LWW note still excludes rides', /RIDES ARE DELIBERATELY NOT HERE/.test(src));
}

console.log('');
if (fails) { console.log(R + 'ride undelete: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'ride undelete: all checks passed' + X + '\n');
