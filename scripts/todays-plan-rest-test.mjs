// Sunday 2026-08-23 read "Rest Day / Recovery" on Today's Plan. The block prescribes exactly one
// session that day — easyRun, 4.5 mi (P2 week[6] = S('easyRun','25-27 min'), struct replaced by
// _RUN_BUILD['2026-08-23']). So "Rest" could not have come from the block.
//
// It came from getWorkoutForDate_ step 1: a stored day whose rows are all rest/mobility was run
// through the FUELLING filter (_fuelable, which strips rest and mobility) and, on an empty result,
// returned Rest and RETURNED — step 2, the block, was unreachable. One mobility row was therefore
// enough to hide a prescribed run.
//
// The filter is a fuelling rule and stays. What changed is that its empty result is now held as a
// LAST RESORT rather than used as an early answer: the block is asked first, and Rest is only
// reported if the block also has nothing fuelable or does not cover the date.
//
// The function is extracted from worker.js and its deps are STUBBED, so what is measured is the
// resolver's own precedence logic and nothing else.
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

const DK = '2026-08-23';
// What blockPlanFor_ returns for that Sunday.
const RUN_DAY = {
  sessions: [{ intent: 'easyRun', struct: '4.5 mi easy', rx: { name: 'Easy Run', targets: { durationMin: 47 } } }]
};
// A day the block itself prescribes as rest + mobility (a P1 Monday shape with the run removed).
const REST_DAY = { sessions: [{ intent: 'mobility', rx: { name: 'Mobility', targets: {} } }] };
const DEFS = {
  easyRun: { type: 'run', name: 'Easy Run' },
  mobility: { type: 'mobility', name: 'Mobility' },
  rest: { type: 'rest', name: 'Rest' },
  strengthA: { type: 'strength', name: 'Strength A' }
};

// block: the blockPlanFor_ answer for DK, or null to model a date outside the block window.
function run(sessions, block) {
  const st = { plan: { [DK]: { sessions } } };
  const live = (dk) => ((st.plan[dk] && st.plan[dk].sessions) || []).filter(x => x && !x.deleted);
  const M = new Function(
    'st', 'SESSION_DEFS', '_trainingBlock_', 'planSessionsForDate_', '_planUserOwned_',
    'getPlannedWorkoutForDate', 'blockPlanFor_',
    asServed(exFn('getWorkoutForDate_') + 'return getWorkoutForDate_;')
  )(
    st, DEFS,
    () => ({ start: '2026-07-24', end: '2026-12-31' }),
    live,
    (s) => !!s && !s.deleted && (s.source === 'user' || (!s.source && !s.gen && !s.migrated)),
    // getPlannedWorkoutForDate's real semantics: drop 'rest', fall back to the block when nothing
    // is left. Modelled, not stubbed away, because its rest-dropping is what feeds step 1.
    (dk) => {
      const t = live(dk).filter(x => x.type !== 'rest');
      if (!t.length) {
        if (!block) return null;
        const w = block.sessions[0], d = DEFS[w.intent];
        return { name: (w.rx && w.rx.name) || d.name, dur: '', type: d.type, intent: w.intent,
          sessions: [{ type: d.type, intent: w.intent, name: (w.rx && w.rx.name) || d.name,
            targets: (w.rx && w.rx.targets) || null }], fromBlock: true };
      }
      const s = t[0];
      return { name: s.name, dur: (s.targets && s.targets.durationMin != null) ? (s.targets.durationMin + ' min') : '',
        type: s.type, intent: s.intent, sessions: t };
    },
    (dk) => (dk === DK ? block : null)
  );
  return M(DK);
}
const gen = (o) => Object.assign({ id: 'g', source: 'gen', status: 'planned' }, o);
const usr = (o) => Object.assign({ id: 'u', source: 'user', status: 'planned' }, o);
const show = (r) => console.log('     -> ' + JSON.stringify(r));
const MOB = { intent: 'mobility', type: 'mobility', name: 'Mobility' };

console.log('\n' + Y + '=== baseline: nothing stored, so the block answers ===' + X);
{
  const r = run([], RUN_DAY); show(r);
  ok('names the block session', !!r && r.name === 'Easy Run');
  ok('is NOT a rest day  [negative control]', !!r && r.isRest === false);
}

console.log('\n' + Y + '=== THE REPORTED BUG: a mobility row on a prescribed-run Sunday ===' + X);
{
  const r = run([usr(MOB)], RUN_DAY); show(r);
  ok('the block Easy Run is reached', !!r && r.name === 'Easy Run');
  ok('the day is not reported as Rest  [pre-fix behaviour, asserted ABSENT]', !!r && r.isRest === false);
  ok('and it carries the block duration', !!r && r.minutes === 47);
}

console.log('\n' + Y + '=== same shape, generator-owned rather than athlete-owned ===' + X);
{
  const r = run([gen(MOB)], RUN_DAY); show(r);
  ok('still reaches the block', !!r && r.name === 'Easy Run' && r.isRest === false);
}

console.log('\n' + Y + '=== a stored rest row alongside the mobility row ===' + X);
{
  const r = run([usr({ id: 'r', intent: 'rest', type: 'rest', name: 'Rest' }), usr(MOB)], RUN_DAY); show(r);
  ok('the block still answers on a day it prescribes a run', !!r && r.name === 'Easy Run' && !r.isRest);
}

console.log('\n' + Y + '=== REGRESSION: a genuine rest+mobility day, block agrees ===' + X);
{
  const r = run([usr(MOB)], REST_DAY); show(r);
  ok('is still reported as Rest', !!r && r.isRest === true);
  ok('with the rest+mobility label intact', !!r && r.name === 'Rest + mobility');
  ok('and zero minutes, so no training-day budget', !!r && r.minutes === 0);
}

console.log('\n' + Y + '=== REGRESSION: mobility-only OUTSIDE the block window ===' + X);
{
  const r = run([usr(MOB)], null); show(r);
  ok('no block to ask, so the held rest verdict is returned', !!r && r.isRest === true);
  ok('and it is not null  [the stored row is still a fact]', r !== null);
}

console.log('\n' + Y + '=== REGRESSION: nothing stored and no block -> null, never a guess ===' + X);
{
  const r = run([], null); show(r);
  ok('returns null', r === null);
}

console.log('\n' + Y + '=== unchanged: a fuelable stored session still wins ===' + X);
{
  const r = run([usr({ id: 's', intent: 'strengthA', type: 'strength', name: 'Strength A' })], RUN_DAY); show(r);
  ok('the athlete session is named, not the block', !!r && r.name === 'Strength A');
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'all passed' + X + '\n');
process.exit(fails ? 1 : 0);
