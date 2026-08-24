// The calendar tile and the day detail named DIFFERENT sessions on the same date.
//
// st.plan persists rows GENERATED from the block. When the block changes those rows go stale and
// nothing regenerates them. The Thu/Fri ride swap is exactly that: from SCHED_THU_FRI_SWAP_FROM the
// block gives Thursday the Threshold and Friday the Z2, while every stored row kept the old
// pairing. Measured live: EVERY Thursday and Friday from Aug 20 on, tile "Threshold" / detail "Z2
// Endurance" and the exact inverse on Friday. One date was reported; it was all of them, twice a
// week.
//
// The repair must be narrow: FUTURE only (a past row is the record of what was prescribed at the
// time), GENERATED only (never an athlete's own session), and IDENTITY only (targets derive at
// read, so writing them here would create a second staler copy).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fnBody, section } from './lib-src-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

const TODAY = '2026-08-13';
// What the block prescribes: Thu = threshold ride, Fri = z2 ride + strengthA.
const BLOCK = {
  '2026-08-20': { sessions: [{ intent: 'threshold', type: 'ride', name: 'Threshold' }] },
  '2026-08-21': { sessions: [{ intent: 'z2', type: 'ride', name: 'Z2 Endurance' }, { intent: 'strengthA', type: 'strength', name: 'Strength A' }] },
  '2026-08-06': { sessions: [{ intent: 'threshold', type: 'ride', name: 'Threshold' }] }   // PAST
};

function build(plan) {
  const st = { plan };
  const M = new Function('st', 'blockPlanFor_', 'getTodayKey', 'sv', asServed(
    exFn('_planSource_') + exFn('_planReplaceable_') + exFn('migratePlanIntentsToBlock_') +
    'return { migratePlanIntentsToBlock_ };'
  ))(st, (dk) => BLOCK[dk] || null, () => TODAY, () => {});
  return { st, run: M.migratePlanIntentsToBlock_ };
}
const gen = (o) => Object.assign({ source: 'gen', status: 'planned' }, o);

console.log('\n' + Y + '=== the reported mismatch is corrected ===' + X);
{
  const { st, run } = build({
    '2026-08-20': { sessions: [gen({ id: 'a', intent: 'z2', type: 'ride', name: 'Z2 Endurance' })] },
    '2026-08-21': { sessions: [gen({ id: 'b', intent: 'threshold', type: 'ride', name: 'Threshold' }),
                               gen({ id: 'c', intent: 'strengthA', type: 'strength', name: 'Strength A' })] }
  });
  const n = run();
  ok('both stale rides were realigned', n === 2);
  ok('Thursday now agrees with the block', st.plan['2026-08-20'].sessions[0].intent === 'threshold');
  ok('...and carries the block name', st.plan['2026-08-20'].sessions[0].name === 'Threshold');
  ok('Friday now agrees too', st.plan['2026-08-21'].sessions[0].intent === 'z2');
  ok('the strength slot is untouched', st.plan['2026-08-21'].sessions[1].intent === 'strengthA');
  ok('the correction is stamped so it can travel', st.plan['2026-08-20'].sessions[0].editedAt > 0);
  ok('re-running it is a no-op', run() === 0);
}

console.log('\n' + Y + '=== the past is the record, and is never rewritten ===' + X);
{
  const { st, run } = build({
    '2026-08-06': { sessions: [gen({ id: 'p', intent: 'z2', type: 'ride', name: 'Z2 Endurance' })] }
  });
  ok('a past date is skipped entirely', run() === 0);
  ok('...and its stored intent is left alone', st.plan['2026-08-06'].sessions[0].intent === 'z2');
  ok('...with no edit stamp invented', st.plan['2026-08-06'].sessions[0].editedAt === undefined);
}

console.log('\n' + Y + '=== only what the generator owns ===' + X);
{
  const mk = (extra) => build({ '2026-08-20': { sessions: [Object.assign({ id: 'x', intent: 'z2', type: 'ride' }, extra)] } });
  const user = mk({ source: 'user', status: 'planned' });
  ok('a session the athlete made is never realigned', user.run() === 0 && user.st.plan['2026-08-20'].sessions[0].intent === 'z2');
  const done = mk({ source: 'gen', status: 'completed' });
  ok('a completed session is never realigned', done.run() === 0);
  const swapped = mk({ source: 'gen', status: 'planned', swap: true });
  ok('an explicit swap is the athlete decision and stands', swapped.run() === 0);
  const tomb = mk({ source: 'gen', status: 'planned', deleted: true });
  ok('a tombstone is left alone', tomb.run() === 0);
  const migrated = mk({ source: 'migrated', status: 'planned' });
  ok('a migrated row IS realignable', migrated.run() === 1);
}

console.log('\n' + Y + '=== it corrects identity, and nothing else ===' + X);
{
  const { st, run } = build({
    '2026-08-20': { sessions: [gen({ id: 'a', intent: 'z2', type: 'ride', name: 'Z2 Endurance',
                                     targets: { powerLo: 111, powerHi: 222 },
                                     _edited: { intent: 1, name: 1, completed: 1 } })] }
  });
  run();
  const s = st.plan['2026-08-20'].sessions[0];
  ok('targets are NOT rewritten — they derive at read', s.targets.powerLo === 111);
  ok('the intent mask entry is cleared as residue', !s._edited.intent);
  ok('...and the name mask entry with it', !s._edited.name);
  ok('...but an unrelated mask entry survives', !!s._edited.completed);
  ok('the type is left to the type repair that runs after this', s.type === 'ride');
}

console.log('\n' + Y + '=== a type can never be rewritten into another type ===' + X);
{
  // A day whose stored strength slot would match the block's RIDE if types were ignored.
  const { st, run } = build({
    '2026-08-20': { sessions: [gen({ id: 's', intent: 'strengthB', type: 'strength', name: 'Strength B' })] }
  });
  ok('a strength slot is not turned into the block ride', run() === 0);
  ok('...and keeps its own intent', st.plan['2026-08-20'].sessions[0].intent === 'strengthB');
  // A date the block says nothing about must be left alone rather than emptied.
  const none = build({ '2026-09-30': { sessions: [gen({ id: 'z', intent: 'z2', type: 'ride' })] } });
  ok('a date outside the block is skipped', none.run() === 0);
}

console.log('\n' + Y + '=== wired in the right order ===' + X);
{
  const afd = fnBody(src, 'applyFirebaseData');
  ok('it runs in applyFirebaseData', /migratePlanIntentsToBlock_\(\)/.test(afd));
  // It rewrites intent; the type repair derives type FROM intent, so order is load-bearing.
  ok('...BEFORE the type repair',
     afd.indexOf('migratePlanIntentsToBlock_()') < afd.indexOf('migrateSessionTypes_()'));
  ok('...and the reason is recorded', /derives type FROM intent/.test(afd));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'plan block realign: all checks passed' + X));
process.exit(fails ? 1 : 0);
