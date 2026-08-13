// Run Training Phase 2. Three features, three different ways to lie, so three different pins.
//
//   shin drift  - must not fire on a thin sample. 12 of the last 16 runs carry a zone breakdown.
//   10k pacing  - the 10k PB is from 2015. A pace target built on it that does not say so is
//                 a plan written for an athlete who no longer exists.
//   why         - deterministic drivers only, same contract as _trDrivers_: a measured delta on a
//                 real input, ordered by size, never narration.
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
const NL = String.fromCharCode(10);

const st = { rides: [], plan: {} };
let PR = { rows: [] };
const M = new Function('st', 'getRuns', '_prCompute_', 'rideSport_', 'actName_', 'normDate', 'getTodayKey', '_durSec_',
  'planSessionsForDate_', 'blockPlanFor_', asServed(
    exVar('SHIN_MIN_SAMPLE') + exVar('SHIN_DRIFT_PCT') + exVar('SHIN_LOOKBACK') + exVar('RUN_RACE') +
    exFn('_runAll_') + exFn('_runZonePct_') + exFn('_runPlannedEasy_') + exFn('_runShinWatch_') +
    exFn('_runPaceStr_') + exFn('_runCurrentPace_') + exFn('_run10kPlan_') + exFn('_runWhy_') + NL +
    'return { _runAll_, _runZonePct_, _runShinWatch_, _runPaceStr_, _runCurrentPace_, _run10kPlan_, _runWhy_, SHIN_MIN_SAMPLE, SHIN_DRIFT_PCT };'
  ))(st, () => [], () => PR, (r) => r.sportType || r.type || 'Run', (r) => r.name || 'Run',
     (d) => String(d).slice(0, 10), () => '2026-08-12', (r) => +r.movingSecs || 0,
     () => [], () => null);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const run = (date, o) => Object.assign({ date, sportType: 'Run', name: 'Easy Run', distance: 4, movingSecs: 2600 }, o || {});
const easy = (date) => run(date, { z1pct: 30, z2pct: 55, z3pct: 15 });          // 15% above easy
const drift = (date) => run(date, { z1pct: 5, z2pct: 25, z3pct: 60, z4pct: 10 }); // 70% above easy

console.log('\n' + Y + '=== shin drift will not fire on a thin sample ===' + X);
{
  st.rides = [easy('2026-08-10'), drift('2026-08-08')];
  let w = M._runShinWatch_();
  eq('two runs is not a sample', w.enough, false);
  eq('...and it does not flag', w.flag, false);
  eq('...but it still reports what it has', w.sample, 2);
  ok('the minimum is a named constant', M.SHIN_MIN_SAMPLE >= 4);

  st.rides = [easy('2026-08-10'), easy('2026-08-08'), easy('2026-08-06'), easy('2026-08-04')];
  w = M._runShinWatch_();
  eq('four clean easy runs is a sample', w.enough, true);
  eq('...with nothing drifting', w.drifted, 0);
  eq('...so no flag', w.flag, false);
}

console.log('\n' + Y + '=== ...and fires on a real majority ===' + X);
{
  st.rides = [drift('2026-08-10'), drift('2026-08-08'), drift('2026-08-06'), easy('2026-08-04')];
  const w = M._runShinWatch_();
  eq('three of four drifted', w.drifted, 3);
  eq('...and that is a flag', w.flag, true);
  eq('sample is reported alongside it', w.sample, 4);

  // A tie is not a majority.
  st.rides = [drift('2026-08-10'), drift('2026-08-08'), easy('2026-08-06'), easy('2026-08-04')];
  eq('two of four is not a majority', M._runShinWatch_().flag, false);
}

console.log('\n' + Y + '=== a run with no zone breakdown is not counted as easy ===' + X);
{
  st.rides = [run('2026-08-10'), run('2026-08-08'), run('2026-08-06'), run('2026-08-04')];
  const w = M._runShinWatch_();
  eq('no breakdown -> not in the sample at all', w.sample, 0);
  ok('...rather than counted as clean', !w.flag && !w.enough);
  eq('the drift measure is null with no zones', M._runZonePct_({ z1pct: 0 }), null);
  eq('...and a real breakdown returns the share above easy', M._runZonePct_({ z1pct: 10, z2pct: 40, z3pct: 50 }), 50);
}

console.log('\n' + Y + '=== a hard run is never counted as a drifted easy run ===' + X);
{
  st.rides = [run('2026-08-10', { name: 'Tempo Run', z1pct: 5, z2pct: 15, z3pct: 80 }),
              easy('2026-08-08'), easy('2026-08-06'), easy('2026-08-04'), easy('2026-08-02')];
  const w = M._runShinWatch_();
  ok('the tempo run is excluded', w.rows.every((r) => !/tempo/i.test(r.name)));
  eq('...leaving only the easy ones', w.sample, 4);
}

console.log('\n' + Y + '=== 10k pacing states WHEN each reference was set ===' + X);
{
  PR = { rows: [{ ev: { id: '10k' }, career: { val: 3082, date: '2015-06-14' }, band: { val: 3150, date: '2024-05-05' } }] };
  st.rides = [run('2026-08-10', { distance: 4, movingSecs: 2620 }), run('2026-08-08', { distance: 4, movingSecs: 2640 })];
  const pl = M._run10kPlan_();
  eq('both PB tiers become references', pl.refs.length, 2);
  eq('the career best carries its year', pl.refs[0].year, '2015');
  eq('...and the since-60 best carries its own', pl.refs[1].year, '2024');
  ok('each has a pace derived from the distance', pl.refs.every((r) => r.secPerMi > 0));
  ok('current form is separate from the PBs', !!pl.current && pl.current.runs === 2);
  ok('...and says how far back it reaches', !!pl.current.since);
  eq('the race is the one that was asked for', pl.race.dateKey, '2026-10-18');
  ok('days-out is computed, not typed', pl.daysOut > 0 && pl.daysOut < 100);

  // The card must PRINT the year - a target off an eleven-year-old PB that does not say so is
  // a plan for an athlete who no longer exists.
  const card = exFn('_run10kCardHTML_');
  ok('the card renders the year for every reference', /'set in '\+r\.year/.test(card));
  ok('...and says why that matters', /not current fitness/.test(card));
}

console.log('\n' + Y + '=== pace formatting ===' + X);
{
  eq('seconds per mile to mm:ss', M._runPaceStr_(630), '10:30');
  eq('...keeps the leading zero', M._runPaceStr_(545), '9:05');
  eq('...and does not round to :60', M._runPaceStr_(599.7), '10:00');
  eq('zero is not a pace', M._runPaceStr_(0), null);
  eq('null is not a pace', M._runPaceStr_(null), null);
}

console.log('\n' + Y + '=== Why is deterministic, and silent when it has nothing ===' + X);
{
  st.rides = [];
  eq('no runs -> no drivers', M._runWhy_(90).drivers.length, 0);

  st.rides = [
    run('2026-08-10', { avgHR: 150, cadence: 168, elev: 100, distance: 4 }),
    run('2026-08-05', { avgHR: 152, cadence: 167, elev: 110, distance: 4 }),
    run('2026-05-10', { avgHR: 140, cadence: 172, elev: 60, distance: 4 }),
    run('2026-05-05', { avgHR: 142, cadence: 173, elev: 65, distance: 4 })
  ];
  const w = M._runWhy_(90);
  ok('drivers are produced', w.drivers.length >= 3);
  ok('each carries both windows and a delta', w.drivers.every((d) => d.recent != null && d.prior != null && d.rawDelta != null));
  ok('...and a unit', w.drivers.every((d) => !!d.unit));
  ok('ordered by SIZE of change, not by name', w.drivers.every((d, i, a) => i === 0 || Math.abs(a[i - 1].delta) >= Math.abs(d.delta)));
  const hr = w.drivers.filter((d) => d.key === 'Average HR')[0];
  ok('HR rising is scored as a NEGATIVE', hr && hr.rawDelta > 0 && hr.delta < 0);
  const cad = w.drivers.filter((d) => d.key === 'Cadence')[0];
  ok('cadence falling is also negative', cad && cad.rawDelta < 0 && cad.delta < 0);
  ok('a driver with no data on either side is absent', !w.drivers.some((d) => d.key === 'Temperature'));
  ok('window and run counts are reported', w.window === 90 && w.recentRuns === 2 && w.priorRuns === 2);

  const card = exFn('_runWhyCardHTML_');
  ok('the card says every row is measured', /measured change in one input/.test(card));
  ok('...and that order is size, not story', /Ordered by size, not by story/.test(card));
  ok('no free text is generated anywhere', !/narrat|prose|sentence/i.test(exFn('_runWhy_')));
}

console.log('\n' + Y + '=== both surfaces get all three ===' + X);
{
  const rn = exFn('renderRunInto_');
  ok('mounted inside the SHARED renderer', /_runPhase2Mount_\(scr\)/.test(rn));
  const mount = exFn('_runPhase2Mount_');
  ok('all three cards are mounted', /_runShinCardHTML_/.test(mount) && /_run10kCardHTML_/.test(mount) && /_runWhyCardHTML_/.test(mount));
  ok('one card throwing cannot take the page down', /catch\(e\)\{ try\{ console\.error\('\[run-p2\]'/.test(mount));
  ok('an empty card renders nothing at all', /if\(!html\) return;/.test(mount));
  // The union source, not getRuns alone - the snapshot under-reports the recent runs these read.
  const all = exFn('_runAll_');
  ok('reads st.rides AND getRuns', /st\.rides/.test(all) && /getRuns\(\)/.test(all));
  ok('...deduped', /seen\[k\]/.test(all));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'run phase 2: all checks passed' + X));
process.exit(fails ? 1 : 0);
