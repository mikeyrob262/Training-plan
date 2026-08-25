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
  '_STR_EPOCH_', 'STRENGTH_SLOTS_', '_BLOCK_START', 'RUN_AHEAD_N', 'RUN_AHEAD_MIN_LIB', 'RUN_AHEAD_LOOKBACK_D',
  // The trend target and the injury log. A constant missing from this list is a ReferenceError
  // that _runAheadFlag_'s own try/catch swallows, so the flag comes back null and every assertion
  // below reads as a broken detector rather than a broken harness.
  'RUN_CATCHUP_PCT', 'RUN_STEP_MAX_PCT', 'RUN_STEP_INJ_PCT', 'RUN_TREND_MIN_N', 'RUN_BAND_WIDTH',
  'INJ_ACTIVE_DAYS'];
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
  '_runLoggedMin_', '_runAheadFlag_', 'runRungAccept_', 'blockPlanFor_',
  '_runMedian_', '_runAheadTarget_', '_injAll_', '_injActive_', 'injSave_', 'injSetStatus_',
  'injDelete_', 'runSetWeekdayTarget_'];

function load(state) {
  const st = Object.assign({ plan: {}, ftp: 183, ftpHistory: [], strength: { log: [] }, runs: [], injuries: [] }, state || {});
  const body = 'var _TB_CACHE=null;\nvar st=arguments[0];\nvar console=arguments[2];\n' +
    'function getRuns(){ return st.runs||[]; }\nfunction sv(){}\nfunction fbPush(){}\n' +
    VARS.map(exVar).join('') + OBJS.map(a => exObj(a[0], a[1], a[2])).join('') + FNS.map(exFn).join('') +
    'return {st:st,' + FNS.concat(['getRuns']).join(',') + ',RUN_AHEAD_N:RUN_AHEAD_N,RUN_AHEAD_MIN_LIB:RUN_AHEAD_MIN_LIB,BLOCK_RUN_RAMP_MAX:BLOCK_RUN_RAMP_MAX,RUN_STEP_MAX_PCT:RUN_STEP_MAX_PCT,RUN_STEP_INJ_PCT:RUN_STEP_INJ_PCT,RUN_TREND_MIN_N:RUN_TREND_MIN_N,RUN_BAND_WIDTH:RUN_BAND_WIDTH};';
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
  // The proposal is now COMPUTED, not the next ladder rung. Median of 38 and 41 is 39.5; the step
  // ceiling is 27 x 1.35 = 36, so 36 governs and the band is 34-36. The old ladder's answer here
  // was 27-29 whatever the runs said; this one is a step toward a named destination.
  eq('...and a computed target, capped by the catch-up rate', f.next, '34-36 min');
  eq('...whose trend figure is the median of the two runs', f.target.trendTop, 39);
  ok('...and it says it was capped', f.target.capped === true);
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
  ok('it returns what it acted on', !!done && done.struct === '34-36 min');
  eq('one rung recorded', M.st.runRungs.length, 1);
  eq('dated today, not backdated', M.st.runRungs[0].from, '2026-09-07');
  ok('the id is content-derived, so two devices converge', M.st.runRungs[0].id === 'rr-2026-09-07-36');

  eq('a future weekday takes the new range',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['34-36 min']);
  eq('...and its duration target moves with it  [or the card prices the new range at the old minutes]',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.rx.targets.durationMin), [36]);
  eq('a run ALREADY DONE keeps the prescription it was given',
    M.blockPlanFor_('2026-09-02').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['25-27 min']);
  eq('Sunday is untouched — still _RUN_BUILD’s miles',
    M.blockPlanFor_('2026-09-13').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['5.5 mi easy']);
}

console.log('\n' + Y + '=== the ceiling is now what he ACTUALLY RUNS, not the last rung ===' + X);
{
  // THE OLD CEILING WAS THE BUG. The ladder's rungs are the phase tables' own ranges and its top is
  // 29-31 min; measured live, the last eight weekday runs were 57/54/44/44/44/36/36/36. Accepting
  // every rung that exists landed at 31 - below the SHORTEST of those. The flag used to go silent
  // there, so the card's answer to "I am running 44" was permanently "move to 27-29, then stop".
  const M = load({ runs: runsOn([['2026-08-31', 38], ['2026-09-02', 41]]) });
  M.st.runRungs = [{ id: 'x', from: '2026-01-01', rung: 9 }];   // absurd, on purpose
  eq('a legacy rung beyond the ladder still clamps to the last one',
    M.blockPlanFor_('2026-09-09').sessions.filter(s => s.intent === 'easyRun').map(s => s.struct), ['29-31 min']);
  const f9 = M._runAheadFlag_(NOW);
  ok('NEG: the flag is NOT silenced by the ladder running out', !!f9);
  ok('...it proposes past the ladder ceiling of 31', !!f9 && f9.target.proposedTop > 31);
}
{
  // G1: RATIFY, NEVER EXTRAPOLATE. The proposal can never exceed the median of the qualifying runs,
  // however many steps are accepted - the plan follows the athlete, it never leads him somewhere new.
  const M = load({ runs: runsOn([['2026-08-24', 60], ['2026-08-26', 40], ['2026-08-31', 40], ['2026-09-02', 40]]) });
  const f = M._runAheadFlag_(NOW);
  eq('the trend is the MEDIAN, so one 60-minute day cannot set it', f.target.trendTop, 40);
  ok('NEG: and it is not the mean or the max', f.target.trendTop !== 45 && f.target.trendTop !== 60);
  let guard = 0, top = f.target.proposedTop;
  while (guard++ < 40) {
    M.runSetWeekdayTarget_(top, NOW, 't');
    const g = M._runAheadFlag_(NOW);
    if (!g || !g.target || !g.target.proposedTop || g.target.proposedTop <= top) break;
    top = g.target.proposedTop;
  }
  ok('accepting repeatedly converges to the trend and stops (' + top + ' min)', top === 40);
  ok('NEG: it never overshoots what he actually ran', top <= 40);
}
{
  // G2: the step ceiling is the block's OWN ramp cap, not a second number invented for the same leg.
  const M = load({ runs: runsOn([['2026-08-31', 90], ['2026-09-02', 90]]) });
  const f = M._runAheadFlag_(NOW);
  eq('one step moves the top by at most the block ramp cap',
    f.target.proposedTop, Math.floor(27 * (1 + M.RUN_STEP_MAX_PCT)));
  ok('...and the card is told it was capped, so it can say so', f.target.capped === true);
  // CATCHING UP IS NOT RAMPING UP. BLOCK_RUN_RAMP_MAX governs NEW load - the Sunday build asking for
  // a distance not yet run - and is untouched. This governs moving the written plan toward minutes
  // already being run three times a week, which asks for no new load, and G1 is what keeps that
  // safe: the proposal can never exceed the median however large this rate is.
  ok('the catch-up rate is its own number, not the new-load ramp',
     M.RUN_STEP_MAX_PCT !== M.BLOCK_RUN_RAMP_MAX);
  ok('NEG: and the block ramp cap is untouched at 10%', Math.abs(M.BLOCK_RUN_RAMP_MAX - 0.10) < 1e-9);
  // The live shape: 27 min prescribed against a 44 min median must reach 44 in TWO decisions, not
  // six, and must not overshoot it.
  {
    const L = load({ runs: runsOn([['2026-08-24', 44], ['2026-08-26', 44], ['2026-08-31', 44], ['2026-09-02', 44]]) });
    const steps = [];
    let cur = null, guard = 0;
    while (guard++ < 20) {
      const g = L._runAheadFlag_(NOW);
      if (!g || !g.target.proposedTop || g.target.proposedTop === cur) break;
      cur = g.target.proposedTop; steps.push(cur);
      L.runSetWeekdayTarget_(cur, NOW, 't');
    }
    ok('27 -> 44 in two acceptances (' + steps.join(' -> ') + ')', steps.length === 2);
    ok('...landing exactly on the median, never past it', steps[steps.length - 1] === 44);
  }
}
{
  // G3: a logged injury is a real input, not a disclaimer.
  const M = load({ runs: runsOn([['2026-08-31', 60], ['2026-09-02', 60]]) });
  M.injSave_({ from: '2026-09-05', area: 'Shin', severity: 6, status: 'active', note: 'sore' });
  const f = M._runAheadFlag_(NOW);
  ok('the flag still shows - the pattern is real either way', !!f);
  ok('...but nothing is proposed while it is active', f.target.blocked === true && !f.target.proposedTop);
  ok('...and it names the reason', /shin report on file/.test(f.target.why));
  M.injSetStatus_(M.st.injuries[0].id, 'easing');
  const g = M._runAheadFlag_(NOW);
  ok('easing lets a step through', !!g.target.proposedTop);
  ok('...at half the rate', Math.abs(g.target.stepPct - M.RUN_STEP_MAX_PCT / 2) < 1e-9);
  M.injSetStatus_(M.st.injuries[0].id, 'resolved');
  const h = M._runAheadFlag_(NOW);
  ok('resolved stops governing immediately', Math.abs(h.target.stepPct - M.RUN_STEP_MAX_PCT) < 1e-9);
  M.st.injuries = [];
  M.injSave_({ from: '2026-05-01', area: 'Shin', severity: 6, status: 'active' });
  const k = M._runAheadFlag_(NOW);
  ok('NEG: a stale report does not block', !k.target.blocked);
  ok('...and is reported AS stale rather than ignored', !!k.injury && k.injury.stale === true);
}
{
  // NOTHING AUTO-ADVANCES. The one rule that did not change, asserted on the code: the only writers
  // are the accept button and the manual sheet, both through one function.
  ok('the accept path delegates to the one writer', /runRungAccept_[\s\S]{0,500}runSetWeekdayTarget_/.test(src));
  ok('NEG: nothing else pushes a rung record',
    (src.match(/st\.runRungs\.push/g) || []).length === 1);
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
  // THE CARD WAS DELIBERATELY CUT DOWN. It used to make one point in four sentences - the runs, the
  // median, that nothing moves on its own, and that it cannot feel the leg - and the athlete asked
  // for the re-justification to go: the four buttons already say nothing happens automatically.
  //
  // What must SURVIVE is the one input the reader cannot check by looking: whether an injury is on
  // file, and what it does to the proposal. That is asserted below.
  //
  // The "nothing changes until you say so" PROSE is gone on purpose. The guarantee it described is
  // not - it is asserted on the CODE further up this file (one writer, reachable only from the
  // accept button and the manual sheet, and nothing else pushing a rung record), which is a stronger
  // check than a sentence being present.
  ok('with nothing on file the card says so', src.indexOf('No injury on file') >= 0);
  ok('with a report on file it says what it read', src.indexOf("_runEsc_(String(_inj.rec.area))+' issue '") >= 0);
  ok('...and what that does to the proposal',
     src.indexOf('Nothing proposed until you mark it easing') >= 0);
  ok('...and when a stale report has stopped holding it back',
     src.indexOf('no longer holding this back') >= 0);
  // The card must still be short. A regression here is the whole complaint coming back.
  {
    const rn = exFn('renderRunInto_');
    const card = rn.slice(rn.indexOf('raCard.innerHTML='), rn.indexOf('scr.appendChild(raCard)'));
    const sentences = (card.match(/[a-z]\. /g) || []).length;
    ok('the card body stays terse (' + sentences + ' sentence breaks in the emitted copy)', sentences <= 6);
    ok('NEG: the cut explanatory lines have not crept back',
       card.indexOf('Nothing changes until you say so') < 0
       && card.indexOf('it cannot feel your leg') < 0
       && card.indexOf('The figure is the middle of those runs') < 0);
  }
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'run ahead: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
