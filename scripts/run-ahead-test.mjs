// Weekday run progression.
//
// The Sunday long run already had a ladder — _RUN_BUILD, nine dated rungs capped at
// BLOCK_RUN_RAMP_MAX. The WEEKDAY easy runs did not: a fixed minute range from the phase table,
// moving only when a phase boundary moved it, with nothing anywhere comparing it to what was run.
//
// Three things here are the whole design and each is asserted rather than trusted:
//
//   1. THE RUNGS ARE NOT NEW NUMBERS. The ladder is read out of the phase tables at call time —
//      20-25 -> 25-27 -> 27-29 -> 29-31 — so advancing means adopting the next phase's range early
//      and the ceiling is whatever the block already builds toward. There is no second table to
//      drift, and the test proves the ladder came from the block rather than from a literal.
//   2. NOTHING ADVANCES ITSELF. The detector returns a flag; only an explicit accept writes. That
//      is the shin guardrail: mileage data cannot see a shin.
//   3. AHEAD MEANS PAST THE TOP OF THE RANGE. A 26-minute run against 25-27 is inside the
//      prescription. Comparing to the midpoint would call that progress and ramp on nothing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : null;
const LIVE = !!URL_;
const src = LIVE ? await (await fetch(URL_, { cache: 'no-store' })).text()
                 : fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = LIVE ? (s) => s
  : (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'), (_, c) => (c === BS ? BS : c));

function matchBrace(from) { let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing fn ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + BS + 's*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const exObj = (n, open, close) => {
  const m = src.match(new RegExp('var ' + n + BS + 's*=')); const i = m ? m.index : -1;
  if (i < 0) throw new Error('missing ' + n);
  let k = src.indexOf(open, i), d = 0;
  for (; k < src.length; k++) { const c = src[k]; if (c === open) d++; else if (c === close) { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';\n';
};

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const VARS = ['_TB_VERSION', '_FTP_RETEST_DATE', 'BLOCK_RUN_RAMP_MAX', 'SCHED_PROGRESSION_FROM',
  'SCHED_THU_FRI_SWAP_FROM', '_RUN_BUILD_ANCHORED_FROM', '_RUN_STACK_MIN_MI', 'PLAN_SESSION_TYPES',
  '_STR_EPOCH_', 'STRENGTH_SLOTS_', '_BLOCK_START', 'RUN_AHEAD_N', 'RUN_AHEAD_MIN_LIB', 'RUN_AHEAD_LOOKBACK_D'];
const OBJS = [['_BLOCK_MILESTONES', '[', ']'], ['_RUN_BUILD', '{', '}'], ['_CLIMB_REHEARSAL', '{', '}'],
  ['_BLOCK_PROG', '{', '}'], ['STRENGTH_POOL_', '[', ']'], ['MOBILITY_POOL_', '[', ']'],
  ['SESSION_DEFS', '{', '}'], ['EX_LIBRARY', '[', ']']];
const FNS = ['_trainingBlock_', '_tbDK_', '_blockDay_', '_blockDaysBetween_', '_tbPhaseFor_',
  '_blockSwapThuFri_', '_blockAbsWeek_', '_climbRehearsalFor_', '_runBuildFor_', '_blockProgWeekFor_',
  '_blockProgFor_', 'strengthForSlot_', '_strWeekIndex_', '_strSlotIndex_', 'strengthRx_',
  '_isLowerLift_', '_strMissed2_', 'ftpOn_', '_ftpSort_', '_ftpHistLive_', '_ftpHist_', '_ftpToday_',
  'settingsArrLive_', '_arrIsDead_', '_strTopSets_', '_ctlRamp_', '_planZoneFromPct_', '_planExercises_',
  '_planTssFromStruct_', '_planSessionFromDef_', 'normDate', 'planSessionsForDate_',
  '_RUN_RUNG_LADDER_', '_runRangeTopMin_', '_runRungFor_', '_runRungStruct_', 'parseDurToMin',
  '_runLoggedMin_', '_runAheadFlag_', 'runRungAccept_', 'blockPlanFor_'];

function load(state) {
  const st = Object.assign({ plan: {}, ftp: 183, ftpHistory: [], strength: { log: [] }, runs: [] }, state || {});
  const body = 'var _TB_CACHE=null;\nvar st=arguments[0];\nvar console=arguments[2];\n' +
    'function getRuns(){ return st.runs||[]; }\nfunction sv(){}\nfunction fbPush(){}\n' +
    VARS.map(exVar).join('') + OBJS.map(a => exObj(a[0], a[1], a[2])).join('') + FNS.map(exFn).join('') +
    'return {st:st,' + FNS.concat(['getRuns']).join(',') + ',RUN_AHEAD_N:RUN_AHEAD_N,RUN_AHEAD_MIN_LIB:RUN_AHEAD_MIN_LIB,BLOCK_RUN_RAMP_MAX:BLOCK_RUN_RAMP_MAX};';
  return new Function(asServed(body))(st, null, { warn() {}, log() {}, error() {} });
}
const M0 = load();
const D = (s) => new Date(s + 'T12:00:00');

console.log('\n' + Y + '=== the ladder is the block’s own numbers, not a new table ===' + X);
{
  const lad = M0._RUN_RUNG_LADDER_();
  eq('read out of the phase tables in order', lad, ['20-25 min', '25-27 min', '27-29 min', '29-31 min']);
  // If these were a literal somewhere they would survive the phase tables changing. They are not.
  ok('every rung appears in a phase table', lad.every(s => src.indexOf("S('easyRun','" + s + "')") >= 0));
  ok('no separate weekday rung table exists to drift', src.indexOf('_WEEKDAY_RUN_BUILD') < 0);
  // The shin cap the Sunday build is held to applies here too — asserted, not assumed.
  const tops = lad.map(M0._runRangeTopMin_);
  const steps = tops.slice(1).map((t, i) => (t - tops[i]) / tops[i]);
  ok('every step is inside BLOCK_RUN_RAMP_MAX (' + steps.map(s => (s * 100).toFixed(1) + '%').join(', ') + ')',
    steps.every(s => s > 0 && s <= M0.BLOCK_RUN_RAMP_MAX + 1e-9));
}

console.log('\n' + Y + '=== "ahead" is measured against the TOP of the range ===' + X);
{
  eq('25-27 min tops out at 27', M0._runRangeTopMin_('25-27 min'), 27);
  eq('a single figure is its own top', M0._runRangeTopMin_('30 min'), 30);
  eq('nothing parseable -> null, not 0', M0._runRangeTopMin_('easy'), null);
  ok('NEG: it is not the midpoint  [26 min against 25-27 is inside the prescription]',
    M0._runRangeTopMin_('25-27 min') !== 26);
}

console.log('\n' + Y + '=== minutes come from movingSecs, never from a formatted string ===' + X);
{
  eq('movingSecs is authoritative', Math.round(M0._runLoggedMin_({ movingSecs: 2400 })), 40);
  // _num('0:44:13') is 4413 — the bug that drove a calorie target to 34,356. parseDurToMin, not
  // digit-stripping.
  eq('a formatted duration is parsed as clock time', Math.round(M0._runLoggedMin_({ duration: '0:44:13' })), 44);
  eq('nothing usable -> null', M0._runLoggedMin_({}), null);
}

// P2 runs Aug 22 - Sep 14 and prescribes easyRun '25-27 min' on Mon and Wed.
const runsOn = (pairs) => pairs.map(([d, min]) => ({ date: d, movingSecs: min * 60, type: 'Run' }));
const NOW = D('2026-09-07');   // a Monday inside P2

console.log('\n' + Y + '=== the detector fires on a PATTERN, not a good day ===' + X);
{
  // Two consecutive weekday runs past 27 min.
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  const f = M._runAheadFlag_(NOW);
  ok('a flag is raised', !!f);
  eq('...naming the current prescription', f.current, '25-27 min');
  eq('...and the next rung, which is the next phase’s range', f.next, '27-29 min');
  eq('...off two consecutive runs', f.streak, 2);
}
{
  const M = load({ runs: runsOn([['2026-09-02', 41]]) });
  ok('ONE long run does not fire it  [negative control]', M._runAheadFlag_(NOW) === null);
}
{
  const M = load({ runs: runsOn([['2026-08-31', 26], ['2026-09-02', 41]]) });
  ok('a run INSIDE the range breaks the streak', M._runAheadFlag_(NOW) === null);
}
{
  const M = load({ runs: [] });
  ok('no runs at all, no flag', M._runAheadFlag_(NOW) === null);
}

console.log('\n' + Y + '=== Sunday belongs to _RUN_BUILD and is not counted here ===' + X);
{
  // Aug 30 and Sep 6 are Sundays: _RUN_BUILD prescribes 5.0 mi and 4.0 mi, not a minute range.
  const M = load({ runs: runsOn([['2026-08-30', 60], ['2026-09-06', 62]]) });
  ok('two long SUNDAYS do not raise the weekday flag', M._runAheadFlag_(NOW) === null);
}

console.log('\n' + Y + '=== a thin library is declared, not hidden ===' + X);
{
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  const f = M._runAheadFlag_(NOW);
  ok('two runs in six weeks is flagged as thin', f.thin === true);
  eq('...and the sample size is reported', f.sample, 2);
}
{
  const many = [['2026-08-31', 38], ['2026-09-02', 41]];
  for (let d = 6; d < 40; d += 2) { const dt = new Date(NOW.getTime() - d * 86400000); many.push([dt.toISOString().slice(0, 10), 30]); }
  const M = load({ runs: runsOn(many) });
  const f = M._runAheadFlag_(NOW);
  ok('a deeper library is not flagged as thin', f && f.thin === false);
  ok('...and still reports what it read', f.sample >= M.RUN_AHEAD_MIN_LIB);
}

console.log('\n' + Y + '=== NOTHING advances itself ===' + X);
{
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  M._runAheadFlag_(NOW);
  eq('raising the flag writes nothing', M.st.runRungs, undefined);
  eq('the block still prescribes the current range',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['25-27 min']);
  ok('NEG: the only writer is the explicit accept',
    (src.match(/runRungAccept_\(/g) || []).length === 2);   // the definition and the one button
}

console.log('\n' + Y + '=== accepting advances the block, FORWARD ONLY ===' + X);
{
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  const done = M.runRungAccept_(NOW);
  ok('it returns what it acted on', !!done && done.next === '27-29 min');
  eq('one rung recorded', M.st.runRungs.length, 1);
  eq('dated today, not backdated', M.st.runRungs[0].from, '2026-09-07');
  ok('the id is content-derived, so two devices converge', M.st.runRungs[0].id === 'rr-2026-09-07-1');

  eq('a future weekday takes the new range',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['27-29 min']);
  eq('...and its duration target moves with it  [or the card prices the new range at the old minutes]',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.rx.targets.durationMin), [29]);
  eq('a run ALREADY DONE keeps the prescription it was given',
    M.blockPlanFor_('2026-09-02').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['25-27 min']);
  eq('Sunday is untouched — still _RUN_BUILD’s miles',
    M.blockPlanFor_('2026-09-13').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['5.5 mi easy']);
}

console.log('\n' + Y + '=== the ceiling is the block’s own last rung ===' + X);
{
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  M.st.runRungs = [{ id: 'x', from: '2026-01-01', rung: 9 }];   // absurd, on purpose
  eq('a rung beyond the ladder clamps to the last one',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['29-31 min']);
  ok('and no flag is offered once there is nowhere left to go', M._runAheadFlag_(NOW) === null);
}

console.log('\n' + Y + '=== both surfaces, from one renderer ===' + X);
{
  ok('the card is mounted in the shared run renderer', /_runAheadFlag_/.test(
    (function () {
    const i = src.indexOf('function renderRunInto_(');
    let k = src.indexOf('{', i), d = 0;
    for (; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
    return src.slice(i, k + 1);
  })()));
  ok('the coach is told about it too', src.indexOf('runAhead:(typeof _runAheadFlag_') >= 0);
  ok('the coach panel states it without offering to act', src.indexOf('it is on the Run Training page when you want it') >= 0);
  ok('the card says out loud that it cannot see the shin', src.indexOf('it cannot see how the shin feels') >= 0);
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'run ahead: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
