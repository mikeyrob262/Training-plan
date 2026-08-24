// The Dashboard and the Calendar day-editor named different sessions for Sunday 2026-08-23.
//
// They read different things and only one of them can fall back. getWorkoutForDate_ (Dashboard)
// consults the block when the stored day has nothing fuelable. The day-editor EDITS STORED ROWS —
// it opens on planSessionsForDate_(dateKey)[0], and when the stored day holds a rest row and a
// mobility row left by an earlier generator, "first" is a rest row and the editor said Rest while
// the Dashboard said Easy Run.
//
// A third fallback would have papered over the same gap a fourth time. What is actually wrong is
// that the block's session was never written into the day. _blockUncoveredFor_ reports exactly
// which block slots a day does not hold, and planAdoptBlockSession_ writes one — identity only,
// stamped 'gen', through the same upsert generateBlockPlan_ uses, so the row is indistinguishable
// from one the generator would have produced and re-running it replaces rather than stacks.
//
// The load-bearing assertion is the NEGATIVE one: a day that already holds the block's session must
// report nothing, or the notice would appear on every day in the block and mean nothing.
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
// P2 week[6] is a single easyRun; _RUN_BUILD replaces its struct with the distance.
const BLOCK = {
  phase: 'P2', phaseLabel: 'Base build 2', weekInPhase: 1, via: 'week', dateKey: DK,
  sessions: [{ intent: 'easyRun', struct: '4.5 mi easy' }]
};
const DEFS = {
  easyRun: { type: 'run', name: 'Easy Run' },
  mobility: { type: 'mobility', name: 'Mobility' },
  rest: { type: 'rest', name: 'Rest' }
};

function build(sessions) {
  const st = { plan: { [DK]: { sessions: sessions || [] } } };
  const live = (dk) => ((st.plan[dk] && st.plan[dk].sessions) || []).filter(x => x && !x.deleted);
  const upserted = [];
  const M = new Function(
    'st', 'SESSION_DEFS', 'blockPlanFor_', 'planSessionsForDate_', 'planUpsertSession_', 'sv',
    asServed(exFn('_blockUncoveredFor_') + exFn('planAdoptBlockSession_') +
      'return { _blockUncoveredFor_, planAdoptBlockSession_ };')
  )(
    st, DEFS,
    (dk) => (dk === DK ? BLOCK : null),
    live,
    (dk, s, fields, source, slotIdx) => {
      // The real id derivation for a generated row: identity, never position.
      s.id = 'plan-' + dk + '-' + (s.type || 'x') + '-' + (s.intent || 'x') + (slotIdx > 0 ? ('-' + slotIdx) : '');
      s.source = source;
      const day = st.plan[dk] || (st.plan[dk] = { sessions: [] });
      const at = day.sessions.findIndex(x => x && x.id === s.id);
      if (at >= 0) day.sessions[at] = s; else day.sessions.push(s);
      upserted.push({ dk, fields, source, slotIdx });
      return s;
    },
    () => {}
  );
  return { st, M, live, upserted };
}
const gen = (o) => Object.assign({ source: 'gen', status: 'planned' }, o);

console.log('\n' + Y + '=== the reported disagreement is detected ===' + X);
{
  // What Aug 23 actually looked like: a rest row and a mobility row, rest first.
  const { M } = build([
    gen({ id: 'r', type: 'rest', intent: '', name: 'Rest' }),
    gen({ id: 'm', type: 'mobility', intent: 'mobility', name: 'Mobility' })
  ]);
  const unc = M._blockUncoveredFor_(DK);
  ok('one block slot is unheld', unc.length === 1);
  ok('and it is the Easy Run', unc[0].intent === 'easyRun' && unc[0].name === 'Easy Run');
  ok('it carries the struct the block derived', unc[0].struct === '4.5 mi easy');
}

console.log('\n' + Y + '=== NEGATIVE CONTROL: a day that already holds it reports nothing ===' + X);
{
  const { M } = build([gen({ id: 'a', type: 'run', intent: 'easyRun', name: 'Easy Run' })]);
  ok('nothing to offer', M._blockUncoveredFor_(DK).length === 0);
}
{
  // ...even with unrelated extras alongside it. The notice must key on the block slot, not on
  // whether the day looks tidy.
  const { M } = build([
    gen({ id: 'r', type: 'rest', intent: '', name: 'Rest' }),
    gen({ id: 'a', type: 'run', intent: 'easyRun', name: 'Easy Run' })
  ]);
  ok('extras alongside the block session still report nothing', M._blockUncoveredFor_(DK).length === 0);
}

console.log('\n' + Y + '=== an empty day offers the block session ===' + X);
{
  const { M } = build([]);
  const unc = M._blockUncoveredFor_(DK);
  ok('the block slot is offered', unc.length === 1 && unc[0].intent === 'easyRun');
}

console.log('\n' + Y + '=== a tombstoned row does not count as coverage ===' + X);
{
  const { M } = build([Object.assign(gen({ id: 'a', type: 'run', intent: 'easyRun', name: 'Easy Run' }), { deleted: true })]);
  ok('a deleted Easy Run leaves the slot unheld', M._blockUncoveredFor_(DK).length === 1);
}

console.log('\n' + Y + '=== adopting writes the row the generator should have written ===' + X);
{
  const { st, M, live, upserted } = build([
    gen({ id: 'r', type: 'rest', intent: '', name: 'Rest' }),
    gen({ id: 'm', type: 'mobility', intent: 'mobility', name: 'Mobility' })
  ]);
  const w = M.planAdoptBlockSession_(DK, 'easyRun');
  ok('it returns the written row', !!w && !!w.id);
  ok('...with an id, so the editor can reopen on it', w.id === 'plan-' + DK + '-run-easyRun');
  ok('stamped gen, so planResolve_ reprices it off current FTP', w.source === 'gen');
  ok('and therefore replaceable by the generator later', upserted[0].source === 'gen');
  ok('IDENTITY ONLY — no targets are frozen into the row', !w.targets);
  ok('it carries the block context for display', !!w.block && w.block.struct === '4.5 mi easy');
  ok('the day now holds three live sessions', live(DK).length === 3);
  ok('the block slot is covered', M._blockUncoveredFor_(DK).length === 0);
  ok('the rows that disagreed are UNTOUCHED  [adopting is not a delete]',
    live(DK).filter(x => x.id === 'r' || x.id === 'm').length === 2);

  // Idempotence: the derived id means a second adopt replaces in place.
  M.planAdoptBlockSession_(DK, 'easyRun');
  ok('adopting twice does not stack a second row', live(DK).length === 3);
  ok('and the stored array holds no duplicate id',
    st.plan[DK].sessions.filter(x => x.id === w.id).length === 1);
}

console.log('\n' + Y + '=== adopting something the block does not prescribe is refused ===' + X);
{
  const { M, live } = build([]);
  ok('an intent absent from the day returns null', M.planAdoptBlockSession_(DK, 'vo2') === null);
  ok('and nothing was written  [negative control]', live(DK).length === 0);
}

console.log('\n' + Y + '=== a date outside the block offers nothing ===' + X);
{
  const { M } = build([]);
  ok('no block, no notice', M._blockUncoveredFor_('2027-01-01').length === 0);
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'block coverage: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
