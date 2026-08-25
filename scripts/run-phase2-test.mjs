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
    exVar('SHIN_MIN_SAMPLE') + exVar('SHIN_DRIFT_PCT') + exVar('SHIN_LOOKBACK') + exVar('SHIN_LOOKBACK_DAYS') + exVar('RUN_RACE') +
    exFn('_runAll_') + exFn('_runZonePct_') + exFn('_runPlannedEasy_') + exFn('_runShinWatch_') +
    exFn('_runPaceStr_') + exFn('_runCurrentPace_') + exFn('_run10kPlan_') + exFn('_runWhy_') + NL +
    'return { _runAll_, _runZonePct_, _runShinWatch_, _runPaceStr_, _runCurrentPace_, _run10kPlan_, _runWhy_, SHIN_MIN_SAMPLE, SHIN_DRIFT_PCT, SHIN_LOOKBACK_DAYS };'
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

console.log('\n' + Y + '=== the lookback is bounded by TIME, not just by count ===' + X);
{
  // A count-only lookback reached back to 2019 and 2021 to fill eight runs, and those old runs at
  // 99% / 93% / 91% above easy were what made the card flag. Recency has to be real, and those
  // zones were computed on the mis-calibrated model anyway.
  st.rides = [easy('2026-08-10'), easy('2026-08-08'),
              drift('2021-06-12'), drift('2019-09-29'), drift('2019-08-04')];
  const w = M._runShinWatch_();
  eq('only the recent runs enter the sample', w.sample, 2);
  ok('...so seven-year-old runs cannot create a flag', !w.flag);
  ok('the bound is a named constant', typeof M.SHIN_LOOKBACK_DAYS === 'number' && M.SHIN_LOOKBACK_DAYS <= 180);
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
  ok('ordered by SIZE of change, not by name', w.drivers.every((d, i, a) => i === 0 || Math.abs(a[i - 1].rawDelta) >= Math.abs(d.rawDelta)));
  // NO ROW CARRIES A VERDICT ANY MORE, and this assertion used to require the opposite: HR rising was
  // scored negative, cadence falling was scored negative, and the card painted them red and green.
  // That is "more distance is good, more of everything else is concerning" - applied to rows that are
  // per-run means over the SAME runs whose volume changed. One behaviour was being stated four times
  // with three of them called problems, while the drift card beside it called that same behaviour
  // progress. The card is named Why: it reports which inputs moved, and the verdict is reached
  // elsewhere. Direction is still carried, because direction is information.
  const hr = w.drivers.filter((d) => d.key === 'Average HR')[0];
  ok('HR rising is still reported, with its direction', !!hr && hr.rawDelta > 0);
  const cad = w.drivers.filter((d) => d.key === 'Cadence')[0];
  ok('cadence falling is still reported, with its direction', !!cad && cad.rawDelta < 0);
  ok('NEG: no row carries a good/bad score at all', w.drivers.every((d) => d.delta === undefined));
  ok('NEG: and the card paints no row green or red',
     !/--c-green/.test(exFn('_runWhyCardHTML_')) && !/--c-red/.test(exFn('_runWhyCardHTML_')));
  ok('a driver with no data on either side is absent', !w.drivers.some((d) => d.key === 'Temperature'));
  ok('window and run counts are reported', w.window === 90 && w.recentRuns === 2 && w.priorRuns === 2);

  const card = exFn('_runWhyCardHTML_');
  ok('the card says every row is measured', /measured change in one input/.test(card));
  ok('...and that order is size', /ordered by size/i.test(card));
  ok('...and that they are inputs behind a verdict, not findings of their own',
     /not separate findings/.test(card));
  ok('...naming the dominant mover, so the rest are read against it', /moved most/.test(card));
  ok('no free text is generated anywhere', !/narrat|prose|sentence/i.test(exFn('_runWhy_')));
}

console.log('\n' + Y + '=== both surfaces get all three ===' + X);
{
  const rn = exFn('renderRunInto_');
  ok('mounted inside the SHARED renderer', /_runPhase2Mount_\(scr\)/.test(rn));
  const mount = exFn('_runPhase2Mount_');
  // 10k RACE PACE MOVED OUT of this list and now mounts directly under the Personal Bests board,
  // where the distances it targets are already ranked. The requirement changed, so the assertion
  // does - but it gets STRICTER, not looser: the card must still render, still render exactly once,
  // and must no longer be in the list it left, or it would draw twice.
  // "Why" has left the phase-2 list too - it now mounts beside HR zones as a padded pair, so that
  // the two reference panels sit side by side instead of each running the full width. Same shape as
  // the 10k move below: the requirement changed, so the assertion gets STRICTER rather than looser -
  // it must still render, still render exactly once, and no longer be in the list it left.
  ok('the phase-2 list still mounts the drift card', /_runShinCardHTML_/.test(mount));
  ok('NEG: why is no longer in the phase-2 list', !/_runWhyCardHTML_/.test(mount));
  ok('why mounts from the shared renderer instead', /_runWhyCardHTML_/.test(rn));
  // UNPAIRED. Side by side each panel was half a column wide, and Why is a table of label/number
  // cells - at 190px every one wrapped and the card became the tall narrow strip it was asked not to
  // be. It takes the column width now and lays its cells ACROSS it. Stricter, not looser: it must
  // still mount, still mount exactly once, and must no longer be inside the pair it left.
  ok('NEG: why is no longer paired into a half-width column', !/pair\.appendChild/.test(rn));
  ok('...the zone panel is appended at the column width like every other card',
     /scr\.appendChild\(zoneCard\)/.test(rn));
  ok('...and the why cells lay out across rather than down',
     /flex-wrap:wrap/.test(exFn('_runWhyCardHTML_')));
  ok('exactly one why call site in the file',
     (src.match(/(?<!function )_runWhyCardHTML_\(\)/g) || []).length === 1);
  ok('NEG: 10k is no longer in the phase-2 list', !/_run10kCardHTML_/.test(mount));
  // 10k now renders INSIDE the Personal Bests card as a section of it - "under Personal Bests"
  // meaning part of that card rather than a separate card that happens to land nearby. So it is
  // called by _prSection_, not mounted by the page, and it is called with asSection=true.
  const pr = exFn('_prSection_');
  ok('10k renders inside the Personal Bests card', /_run10kCardHTML_\(true\)/.test(pr));
  ok('...as a section below the board', pr.indexOf('_runRail_') < pr.indexOf('_run10kCardHTML_'));
  ok('NEG: and the page no longer mounts it separately', !/_run10kCardHTML_/.test(rn));
  ok('the section form draws its own heading', /10k race pace<\/span>/.test(exFn('_run10kCardHTML_')));
  // Exactly one CALL site across the whole file, so the move cannot have left a second one behind.
  // The definition also reads _run10kCardHTML_( , so it is excluded rather than counted.
  ok('exactly one 10k call site in the file',
     (src.match(/(?<!function )_run10kCardHTML_\(/g) || []).length === 1);
  ok('one card throwing cannot take the page down', /catch\(e\)\{ try\{ console\.error\('\[run-p2\]'/.test(mount));
  ok('an empty card renders nothing at all', /if\(!html\) return;/.test(mount));
  // The union source, not getRuns alone - the snapshot under-reports the recent runs these read.
  const all = exFn('_runAll_');
  ok('reads st.rides AND getRuns', /st\.rides/.test(all) && /getRuns\(\)/.test(all));
  ok('...deduped', /seen\[k\]/.test(all));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'run phase 2: all checks passed' + X));
process.exit(fails ? 1 : 0);
