// Monday 2026-08-24 holds ONE live session (Mobility A) where the block prescribes TWO
// (week[0] = [easyRun, mobility]). Tuesday's [strengthB, vo2] and Friday's [threshold, strengthA]
// both write correctly on the same board.
//
// It is not the pairing. It is the TYPE.
//
//   PLAN_SESSION_TYPES = /^(ride|strength|mobility|rest)$/
//   _isSession_        = /^(ride|run|strength|mobility|rest|optional|attempt)$/
//
// The library defines SEVEN types and the plan's own validator accepts FOUR. Every session whose
// type is 'run', 'attempt' or 'optional' fails validateSession_, planUpsertSession_ throws — and
// generateBlockPlan_ wraps its per-slot upsert in `try{...}catch(e){}`, so the throw is SWALLOWED
// and the slot vanishes with no error anywhere. Mobility passes, the easy run does not, and the day
// ends up with exactly one row.
//
// This is not confined to Monday. It means NO run day, NO attempt (Chalet, Alpe, Ven-Top, the 10k,
// the FTP retest) and NO optional session has ever been written into st.plan by the generator.
// Sunday 2026-08-23 prescribes easyRun ALONE, which is why that day had no Easy Run row at all —
// the same root cause behind the Dashboard/Calendar "Rest" disagreement.
//
// This runs the REAL block and the REAL write path, not a model of them.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// SOURCE-AGNOSTIC ON PURPOSE. With no argument this reads the local worker.js, which is what
// preflight wants. Given a URL it reads what the Worker actually SERVES — the only thing that
// answers "does it work in the browser", and the check that catches the served-template escape
// trap where source \d arrives as d: valid, silent, wrong. The served text needs no unescaping,
// so asServed is the identity on that path.
//   node scripts/plan-run-type-test.mjs https://training-plan.mgrobinson07.workers.dev/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : null;
const LIVE = !!URL_;
const src = LIVE
  ? await (await fetch(URL_, { cache: 'no-store' })).text()
  : fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = LIVE ? (s) => s
  : (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'),
    (_, c) => (c === BS ? BS : c));

function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing fn ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + BS + 's*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const exObj = (n, open, close) => {
  const m = src.match(new RegExp('var ' + n + BS + 's*='));
  const i = m ? m.index : -1;
  if (i < 0) throw new Error('missing ' + n);
  let j = src.indexOf(open, i), d = 0, k = j;
  for (; k < src.length; k++) { const c = src[k]; if (c === open) d++; else if (c === close) { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';\n';
};

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const VARS = ['_TB_VERSION', '_FTP_RETEST_DATE', 'BLOCK_RUN_RAMP_MAX', 'SCHED_PROGRESSION_FROM',
  'SCHED_THU_FRI_SWAP_FROM', '_RUN_BUILD_ANCHORED_FROM', '_RUN_STACK_MIN_MI', 'PLAN_SESSION_TYPES', '_STR_EPOCH_', 'STRENGTH_SLOTS_', '_BLOCK_START'];
const OBJS = [['_BLOCK_MILESTONES', '[', ']'], ['_RUN_BUILD', '{', '}'], ['_CLIMB_REHEARSAL', '{', '}'],
  ['_BLOCK_PROG', '{', '}'], ['STRENGTH_POOL_', '[', ']'], ['MOBILITY_POOL_', '[', ']'],
  ['SESSION_DEFS', '{', '}'], ['EX_LIBRARY', '[', ']']];
const FNS = ['_trainingBlock_', '_tbDK_', '_blockDay_', '_blockDaysBetween_', '_tbPhaseFor_',
  '_blockSwapThuFri_', '_blockAbsWeek_', '_climbRehearsalFor_', '_runBuildFor_', '_blockProgWeekFor_', '_blockProgFor_',
  'strengthForSlot_', '_strWeekIndex_', '_strSlotIndex_', 'strengthRx_', '_isLowerLift_', '_strMissed2_', 'ftpOn_', '_ftpSort_', '_ftpHistLive_', '_ftpHist_', '_ftpToday_', 'settingsArrLive_', '_arrIsDead_', '_strTopSets_', '_ctlRamp_', '_planZoneFromPct_', '_planExercises_', '_planTssFromStruct_',
  '_planSessionFromDef_', 'blockPlanFor_', 'normDate', 'normalizeSession_', '_planCoherce_',
  'validateSession_', 'markPlanEdited_', 'isPlainObj_', 'planDay_', 'planUpsertSession_', 'planSessionsForDate_'];

// A live `st` with an empty plan, plus the few globals the extracted chain reaches for.
const PRELUDE = 'var _TB_CACHE=null;\nvar st={plan:{},ftp:186,ftpHistory:[],strength:{log:[]}};\n' +
  'var console=arguments[0];\n';

function load(typesRe) {
  let body = PRELUDE + VARS.map(exVar).join('') + OBJS.map(a => exObj(a[0], a[1], a[2])).join('') +
    FNS.map(exFn).join('');
  if (typesRe) body = body.replace(/var PLAN_SESSION_TYPES=[^;]*;/, 'var PLAN_SESSION_TYPES=' + typesRe + ';');
  body += 'return { st:st, blockPlanFor_:blockPlanFor_, planUpsertSession_:planUpsertSession_,' +
    ' planSessionsForDate_:planSessionsForDate_, validateSession_:validateSession_,' +
    ' SESSION_DEFS:SESSION_DEFS, PLAN_SESSION_TYPES:PLAN_SESSION_TYPES };';
  return new Function(asServed(body))({ warn() {}, log() {}, error() {} });
}

// generateBlockPlan_'s own per-slot loop, verbatim in shape — including the try/catch that
// swallows the throw. This is what makes the failure silent.
function generateDay(M, key) {
  const plan = M.blockPlanFor_(key);
  const out = { written: 0, swallowed: [] };
  const seenSlot = {};
  (plan.sessions || []).forEach(function (sl) {
    const def = M.SESSION_DEFS[sl.intent]; if (!def) return;
    const s = { type: def.type, intent: (def.type === 'rest' ? '' : sl.intent), name: def.name, status: 'planned',
      block: { name: plan.phaseLabel, phase: plan.phase, week: plan.weekInPhase, struct: sl.struct || '' } };
    const sk = (s.type || 'x') + '|' + (s.intent || 'x');
    const idx = seenSlot[sk] || 0; seenSlot[sk] = idx + 1;
    try { M.planUpsertSession_(key, s, ['type', 'name', 'intent', 'status'], 'gen', idx); out.written++; }
    catch (e) { out.swallowed.push(sl.intent + ': ' + e.message); }
  });
  return out;
}

const MON = '2026-08-24', SUN = '2026-08-23', TUE = '2026-08-25', FRI = '2026-08-28';

// The regex as it stood before the fix — four types where the library defines seven.
const OLD = '/^(ride|strength|mobility|rest)$/';

console.log('\n' + Y + '=== the two type lists are ONE declaration now ===' + X);
{
  const M = load();
  const libTypes = [...new Set(Object.keys(M.SESSION_DEFS).map(k => M.SESSION_DEFS[k].type))].sort();
  eq('the library defines seven types', libTypes,
    ['attempt', 'mobility', 'optional', 'rest', 'ride', 'run', 'strength']);
  eq('the plan validator accepts every one of them',
    libTypes.filter(t => !M.PLAN_SESSION_TYPES.test(t)), []);
  const decls = src.match(/var PLAN_SESSION_TYPES\s*=/g) || [];
  eq('declared exactly once, so it cannot drift again', decls.length, 1);
  ok('_isSession_ reads that declaration rather than a second literal',
    /function _isSession_[^}]*PLAN_SESSION_TYPES\.test/.test(src));
}

console.log('\n' + Y + '=== blockPlanFor_ always returned both Monday slots ===' + X);
{
  const M = load();
  eq('Monday derives two sessions', (M.blockPlanFor_(MON).sessions || []).map(s => s.intent), ['easyRun', 'mobility']);
  eq('Sunday derives one', (M.blockPlanFor_(SUN).sessions || []).map(s => s.intent), ['easyRun']);
  ok('so the block was never the bug — the loss was downstream', true);
}

console.log('\n' + Y + '=== REGRESSION REPRODUCED: the old regex drops the run, silently ===' + X);
{
  const M = load(OLD);
  const mon = generateDay(M, MON);
  eq('only one of the two Monday slots is written', mon.written, 1);
  ok('the easy run threw', mon.swallowed.length === 1 && /^easyRun: /.test(mon.swallowed[0]));
  ok('...and the reason is its TYPE', /type\(run\)/.test(mon.swallowed[0]));
  eq('the day holds Mobility A alone — exactly what was measured live',
    M.planSessionsForDate_(MON).map(s => s.name), ['Mobility A']);
  const sun = generateDay(M, SUN);
  eq('Sunday writes NOTHING, its only slot being a run', sun.written, 0);
  eq('...so that day had no session for the editor to open', M.planSessionsForDate_(SUN).length, 0);
}

console.log('\n' + Y + '=== the fix: both slots are written ===' + X);
{
  const M = load();
  const mon = generateDay(M, MON);
  eq('Monday writes both slots', mon.written, 2);
  ok('nothing swallowed', !mon.swallowed.length);
  eq('and the day names both sessions', M.planSessionsForDate_(MON).map(s => s.name), ['Easy Run', 'Mobility A']);
  eq('the run keeps its own type  [not coerced to ride]', M.planSessionsForDate_(MON)[0].type, 'run');

  const sun = generateDay(M, SUN);
  eq('Sunday writes its Easy Run', sun.written, 1);
  eq('...the row the day editor had nothing to open', M.planSessionsForDate_(SUN).map(s => s.name), ['Easy Run']);
  ok('ids are identity-derived', M.planSessionsForDate_(SUN)[0].id === 'plan-' + SUN + '-run-easyRun');
  generateDay(M, SUN);
  eq('re-running writes no duplicate', M.planSessionsForDate_(SUN).length, 1);
}

console.log('\n' + Y + '=== NEGATIVE CONTROL: the pairs that always worked, still work ===' + X);
{
  const M = load();
  const tue = generateDay(M, TUE), fri = generateDay(M, FRI);
  eq('Tuesday writes both slots', tue.written, 2);
  eq('Friday writes both slots', fri.written, 2);
  ok('neither swallowed anything', !tue.swallowed.length && !fri.swallowed.length);
  ok('...which is why the pairing looked like the suspect', true);
}

// Every slot the block prescribes across the window, bucketed by whether the validator in force
// would accept it. The blast radius, measured rather than asserted.
function radius(M) {
  const lost = {}, kept = {};
  const d = new Date('2026-08-22T00:00:00'), end = new Date('2026-12-31T00:00:00');
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const bp = M.blockPlanFor_(key); if (!bp) continue;
    (bp.sessions || []).forEach(sl => {
      const def = M.SESSION_DEFS[sl.intent]; if (!def) return;
      const b = M.PLAN_SESSION_TYPES.test(def.type) ? kept : lost;
      b[def.type] = (b[def.type] || 0) + 1;
    });
  }
  return { lost, kept };
}

console.log('\n' + Y + '=== blast radius across the whole block ===' + X);
{
  const before = radius(load(OLD));
  console.log('     before -> lost ' + JSON.stringify(before.lost));
  ok('the old regex lost runs across the block, not on one date', (before.lost.run || 0) > 10);
  ok('...every attempt too — Chalet, Alpe, Ven-Top, the 10k', (before.lost.attempt || 0) >= 4);
  ok('...and the optional days', (before.lost.optional || 0) >= 1);
  ok('rides, strength, mobility and rest were never affected  [negative control]',
    !before.lost.ride && !before.lost.strength && !before.lost.mobility && !before.lost.rest);

  const after = radius(load());
  console.log('     after  -> kept ' + JSON.stringify(after.kept));
  eq('nothing is lost now', after.lost, {});
  ok('the runs are all kept', (after.kept.run || 0) === (before.lost.run || 0));
  ok('and so are the attempts', (after.kept.attempt || 0) === (before.lost.attempt || 0));
}

console.log('\n' + Y + '=== the generator no longer fails silently ===' + X);
{
  const gen = src.slice(src.indexOf('function generateBlockPlan_('));
  const loop = gen.slice(0, gen.indexOf('out.generated++'));
  ok('a dropped slot is counted', /out\.failed/.test(loop));
  ok('...and logged with the date, intent and type', /console\.warn\('\[blockPlan\]/.test(loop));
  ok('NEG: the silent catch is gone', !/catch\(e\)\{\}/.test(loop));
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'plan run type: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
