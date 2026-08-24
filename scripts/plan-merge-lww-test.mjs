// PLAN SESSION MERGE — per-field last-write-wins on editedAt.
//
// mergeSession_ resolved ONLY the fields named in the _edited mask and left everything else to
// mergeState_'s generic union, so a field nobody hand-edited had NO CLOCK ordering it. That is why
// migrateSessionTypes_ never converged: it repairs a run stored as type 'ride', deletes
// _edited.type (correctly — the mask records that a field was WRITTEN, not chosen) and stamps
// editedAt, and the merge had nothing to make the stamped value win.
//
// This is shared merge machinery, so the tests below pin the NEW behaviour AND the behaviour that
// must not move: the mask still outranks plain recency, structured objects still merge
// field-by-field, and 'deleted' keeps its own subtler recency rule.
//
// mergeState_ and mergeSession_ are extracted from source and run for real. arrayToIndexObject_
// and mergeArrays_ are supplied as honest minimal stand-ins — sessions reach them only through
// exercises[], and the session contract under test is about scalar identity fields.
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
  'function mergeArrays_(a,b){ return (a||[]).concat((b||[]).filter(function(x){ return (a||[]).indexOf(x)<0; })); }\n' +
  'function _planTrace_(){}\n' +
  exFn('isPlainObj_') + exFn('mergeState_') + exVar('PLAN_LWW_FIELDS_') +
  // _isSession_ reads PLAN_SESSION_TYPES rather than carrying its own copy of the type list —
  // the two literals drifted once and cost every run and attempt in the plan.
  exVar('PLAN_SESSION_TYPES') + exFn('_isSession_') + exFn('mergeSession_') +
  'return { mergeSession_, mergeState_, _isSession_, PLAN_LWW_FIELDS_ };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
const S = M.mergeSession_;
const OLD = 1000, NEW = 2000;

console.log('\n' + Y + '=== the repair survives a sync — the whole point ===' + X);
{
  // Exactly the live shape: local repaired to 'run' and stamped; remote stale 'ride', older stamp,
  // and NO mask on type (the migration deletes it on purpose).
  const local = { id: 'p1', intent: 'easyRun', type: 'run', editedAt: NEW };
  const remote = { id: 'p1', intent: 'easyRun', type: 'ride', editedAt: OLD };
  eq('a stamped correction beats a stale remote', S(local, remote).type, 'run');
  eq('...and in the other direction too', S(remote, local).type, 'run');
  // The reverse must also hold, or this is position-dependence wearing a clock's clothes.
  const staleLocal = { id: 'p1', intent: 'easyRun', type: 'ride', editedAt: OLD };
  const freshRemote = { id: 'p1', intent: 'easyRun', type: 'run', editedAt: NEW };
  eq('a stamped REMOTE beats a stale local', S(staleLocal, freshRemote).type, 'run');
  eq('...and in the other direction too', S(freshRemote, staleLocal).type, 'run');
  eq('editedAt carries the newer stamp forward', S(local, remote).editedAt, NEW);
}

console.log('\n' + Y + '=== intent and name ride along (the next migration would hit the same wall) ===' + X);
{
  const a = { id: 'p1', intent: 'easyRun', name: 'Easy Run', type: 'run', editedAt: NEW };
  const b = { id: 'p1', intent: 'z2', name: 'Z2 Endurance', type: 'ride', editedAt: OLD };
  const m = S(a, b);
  eq('intent resolves by recency', m.intent, 'easyRun');
  eq('name resolves by recency', m.name, 'Easy Run');
  eq('the allowlist is exactly the identity fields', M.PLAN_LWW_FIELDS_, ['type', 'intent', 'name']);
}

console.log('\n' + Y + '=== an explicit edit still outranks plain recency ===' + X);
{
  // The athlete deliberately set type on the OLDER side. Mask runs after the allowlist, so it wins.
  const older = { id: 'p1', type: 'strength', editedAt: OLD, _edited: { type: 1 } };
  const newer = { id: 'p1', type: 'ride', editedAt: NEW };
  eq('a masked field beats a newer unmasked one', S(older, newer).type, 'strength');
  eq('...regardless of argument order', S(newer, older).type, 'strength');
  ok('...and the mask propagates', !!S(older, newer)._edited.type);
  // Both sides masked -> later edit wins, unchanged from before.
  const bothA = { id: 'p1', type: 'run', editedAt: NEW, _edited: { type: 1 } };
  const bothB = { id: 'p1', type: 'ride', editedAt: OLD, _edited: { type: 1 } };
  eq('both masked: the later edit wins', S(bothA, bothB).type, 'run');
}

console.log('\n' + Y + '=== behaviour that must NOT move ===' + X);
{
  // With neither side stamped there is no clock, so the generic union still decides. Documented.
  const u1 = { id: 'p1', type: 'run' }, u2 = { id: 'p1', type: 'ride' };
  eq('unstamped both sides falls through to the generic union', S(u1, u2).type, 'run');
  ok('...and does not invent an editedAt', S(u1, u2).editedAt === undefined);

  // Structured payload must keep merging field-by-field - replacing it wholesale from the later
  // side would throw away a real edit made on the other device.
  const p1 = { id: 'p1', type: 'run', editedAt: NEW, targets: { hrCap: 140 } };
  const p2 = { id: 'p1', type: 'run', editedAt: OLD, targets: { durationMin: 74 } };
  const mt = S(p1, p2).targets;
  eq('targets still merge structurally, not wholesale', [mt.hrCap, mt.durationMin], [140, 74]);
  ok('targets is not in the allowlist', M.PLAN_LWW_FIELDS_.indexOf('targets') < 0);
  ok('...nor completed', M.PLAN_LWW_FIELDS_.indexOf('completed') < 0);
  ok('...nor exercises', M.PLAN_LWW_FIELDS_.indexOf('exercises') < 0);

  // 'deleted' keeps its OWN rule, which is subtler than the allowlist: on a TIE a tracked delete
  // sticks and an untracked collapse-tombstone must not kill a fresh save.
  ok('deleted is NOT in the allowlist', M.PLAN_LWW_FIELDS_.indexOf('deleted') < 0);
  eq('a newer live save beats an older tombstone',
     S({ id: 'p1', type: 'run', deleted: false, editedAt: NEW }, { id: 'p1', type: 'run', deleted: true, editedAt: OLD }).deleted, false);
  eq('a newer delete beats an older live copy',
     S({ id: 'p1', type: 'run', deleted: true, editedAt: NEW }, { id: 'p1', type: 'run', deleted: false, editedAt: OLD }).deleted, true);
  eq('on a tie an untracked tombstone does NOT kill a live save',
     S({ id: 'p1', type: 'run', deleted: false, editedAt: OLD }, { id: 'p1', type: 'run', deleted: true, editedAt: OLD }).deleted, false);
  eq('...but a TRACKED delete still sticks on a tie',
     S({ id: 'p1', type: 'run', deleted: false, editedAt: OLD }, { id: 'p1', type: 'run', deleted: true, editedAt: OLD, _edited: { deleted: 1 } }).deleted, true);

  ok('null on either side is still passed through', S(null, { id: 'p1' }).id === 'p1' && S({ id: 'p1' }, null).id === 'p1');
}

console.log('\n' + Y + '=== every plan session type gets session-aware merging ===' + X);
{
  // The gate listed three of the seven types the plan stores, so run/rest/optional/attempt got no
  // mask, no deleted-recency and no allowlist. And once the type repair converges, BOTH sides read
  // 'run' - an incomplete list would drop run sessions out of session merging the moment it worked.
  ['ride', 'run', 'strength', 'mobility', 'rest', 'optional', 'attempt'].forEach((t) => {
    ok('"' + t + '" is recognised as a session', M._isSession_({ id: 'p1', type: t }));
  });
  ok('an object with no id is not a session', !M._isSession_({ type: 'run' }));
  ok('an unrelated typed object is not a session', !M._isSession_({ id: 'x', type: 'document' }));
  ok('...nor a nutrition-shaped row', !M._isSession_({ id: 'x', type: 'text' }));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'plan merge LWW: all checks passed' + X));
process.exit(fails ? 1 : 0);
