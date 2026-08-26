// A SESSION THE BLOCK PRESCRIBES MUST BE SELECTABLE.
//
// Reported: Strength C is missing from the Calendar's Session dropdown. It was fully built - an entry
// in SESSION_DEFS with its own exercise group and note, a member of STRENGTH_POOL_, its own calendar
// colour, and a dedicated swap path in _strengthCSwap_. It was simply never added to
// SESSION_DEF_ORDER, which is the list the picker is built from. So a session the block prescribes
// and the calendar draws could not be chosen when it needed rescheduling.
//
// Strength D had the identical gap and was fixed at the same time.
//
// This is the same shape as PLAN_SESSION_TYPES holding 4 of the library's 7 types, where the missing
// three were swallowed by an empty catch and 39 runs were lost. A list that is a SUBSET of the
// library it indexes is a recurring failure here, and it is trivially checkable: the library is the
// authority, the list must cover it, and anything deliberately hidden must say so.
//
// Run: node scripts/session-picker-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

// Sessions defined but deliberately NOT offered in the picker. Each needs a reason, not just a name.
//
// These are all DATED EVENTS rather than session types. They belong to a specific day in the block -
// a retest, a named ride, the goal race - and are placed by the block, not chosen from a dropdown.
// Offering "Alpe" as a session type for an arbitrary Tuesday would let the athlete create a second
// one and put two milestones in a block that has exactly one of each.
const HIDDEN = {
  ftpTest:        'a dated retest milestone, placed by the block on its own date',
  chalet:         'a dated block milestone',
  alpe:           'a dated block milestone',
  ventop:         'a dated block milestone',
  tenk:           'the goal race - a dated milestone, not a repeatable session type',
  fuhgeddaboudit: 'a dated named event',
  optional:       'a marker applied to another session, never a session on its own'
};

// ---- the library ----
const defsAt = src.indexOf('var SESSION_DEFS={');
const defsEnd = src.indexOf('\n};', defsAt);
const defsBlock = src.slice(defsAt, defsEnd);
const defKeys = [];
defsBlock.split('\n').forEach(line => {
  if (/^\s*\/\//.test(line)) return;                       // a comment naming a key is not a key
  const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/);
  if (m) defKeys.push(m[1]);
});

// ---- the picker's order ----
const ordM = src.match(/var SESSION_DEF_ORDER=\[([^\]]*)\]/);
const order = ordM ? ordM[1].split(',').map(s => s.trim().replace(/^'/, '').replace(/'$/, '')).filter(Boolean) : [];

console.log('');
console.log(Y + '=== every defined session is selectable ===' + X);
ok('the library was found', defKeys.length > 0);
ok('the picker order was found', order.length > 0);
console.log('  ' + defKeys.length + ' defined, ' + order.length + ' in the picker');

const missing = defKeys.filter(k => order.indexOf(k) < 0 && !HIDDEN[k]);
if (missing.length) {
  missing.forEach(k => console.log('  ' + R + 'FAIL' + X + '  ' + k + ' is defined but cannot be selected'));
  fails += missing.length;
} else {
  ok('no defined session is unselectable', true);
}

// The reported cases, pinned by name so a future reordering cannot quietly drop them again.
ok('Strength C is selectable', order.indexOf('strengthC') >= 0);
ok('Strength D is selectable', order.indexOf('strengthD') >= 0);
ok('...and both are still real definitions, not order entries pointing at nothing',
   defKeys.indexOf('strengthC') >= 0 && defKeys.indexOf('strengthD') >= 0);

// NEGATIVE CONTROL, the other direction: an order entry with no definition would render a blank
// option that saves a session type nothing can resolve.
const orphans = order.filter(k => defKeys.indexOf(k) < 0);
ok('NEG: the picker offers nothing the library cannot define' + (orphans.length ? ' - ' + orphans.join(', ') : ''),
   orphans.length === 0);

// And the strength pool and the picker must agree, since the pool is what the rotation prescribes.
const poolM = src.match(/var STRENGTH_POOL_\s*=\s*\[([^\]]*)\]/);
if (poolM) {
  const pool = poolM[1].split(',').map(s => s.trim().replace(/^'/, '').replace(/'$/, '')).filter(Boolean);
  const unpickable = pool.filter(k => order.indexOf(k) < 0 && !HIDDEN[k]);
  ok('every strength session the rotation can prescribe is selectable' +
     (unpickable.length ? ' - ' + unpickable.join(', ') : ''), unpickable.length === 0);
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'session picker: all checks passed' + X));
process.exit(fails ? 1 : 0);
