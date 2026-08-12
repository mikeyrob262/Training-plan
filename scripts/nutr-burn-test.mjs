// THE PAGE'S BURN COMES FROM burnedCalsForDate_ -> fuelBudgetForDate_. Nothing else.
//
// This test used to exercise a second burn function I had added inside calcTrainingAwareTargets_
// without noticing the app already had one. Both "fixes" passed their own tests and the header still
// read "Base 2,402 cal + nothing burned yet", because the header never called my function. The
// duplicate is gone; these assertions now cover the real path, END TO END, including the exact
// string the athlete reads.
//
// The defect underneath all of it: burnedCalsForDate_ read only r.calories. Measured live - 693
// rides carry calories, 397 carry workKj, and 131 carry workKj with NO calories. Every one of those
// days reported nothing burned.
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

const st = { rides: [], runs: [] };
// burnedCalsForDate_ delegates to rideCalories_, which decides cycling-vs-not via rideSport_ and
// derives kJ via rideKj_ (avgPwr x movingSecs, NOT a stored workKj field). Extracting only the burn
// function tested a chain with its middle removed: every fixture fell through to the r.calories
// fallback and read as a policy failure instead of a missing dependency.
const CHAIN = 'function normDate(d){ return String(d==null?"":d).slice(0,10); }' + String.fromCharCode(10)
  + exFn('rideSport_') + exFn('rideKj_') + exFn('rideCalories_')
  + exFn('burnedCalsForDate_') + exFn('fuelBudgetForDate_');
const M = new Function('st', asServed(CHAIN + ';return { burnedCalsForDate_, fuelBudgetForDate_, rideCalories_ };'))(st);
const setRides = (rs) => { st.rides.length = 0; rs.forEach((r) => st.rides.push(r)); };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const D = '2026-08-11';

console.log('\n' + Y + '=== the fields the library actually stores ===' + X);
{
  // The exact ride that read as nothing burned: workKj set, no calories field at all.
  setRides([{ date: D, name: 'Zwift - VO2 Work', sportType: 'VirtualRide', avgPwr: 124.1, movingSecs: 2702, workKj: 335.2, tss: 48 }]);
  eq('a workKj ride counts as burned', M.burnedCalsForDate_(D).cal, 335);
  eq('...and is listed as a source', M.burnedCalsForDate_(D).n, 1);
}
{
  setRides([{ date: D, sportType: 'Ride', calories: 601, workKj: 900 }]);
  eq('recorded calories win over workKj', M.burnedCalsForDate_(D).cal, 601);
}
{
  // TSS must NOT leak in here. This function's contract is real values only, and a fabricated burn
  // becomes a fabricated fuelling target the athlete eats against.
  setRides([{ date: D, sportType: 'Ride', tss: 48 }]);
  eq('a TSS-only ride contributes nothing', M.burnedCalsForDate_(D).cal, 0);
  // Strip comments: the note in that function explains that TSS is deliberately excluded, and a
  // check that reads comments is testing the prose.
  const burnCode = exFn('burnedCalsForDate_').split(String.fromCharCode(10))
    .filter((l) => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
  ok('no TSS estimate in the burn reader', !/tss/i.test(burnCode));
  // A running power meter's kJ is not kcal: this exact activity has workKj 529 and Strava says 376.
  setRides([{ date: D, name: 'Trail Run', sportType: 'Run', avgPwr: 244.5, movingSecs: 2156, workKj: 529, tss: 100 }]);
  eq('a RUN with kJ but no calories contributes nothing', M.burnedCalsForDate_(D).cal, 0);
  setRides([{ date: D, sportType: 'Run', calories: 376 }]);
  eq('...but a run WITH recorded calories counts', M.burnedCalsForDate_(D).cal, 376);
}

console.log('\n' + Y + '=== END TO END: the numbers the header prints ===' + X);
{
  // fuelBudgetForDate_ is what the header and the meal-plan card both read.
  const tgt = { cal: 2737, baseCal: 2402, exerciseCal: 335, isTrainingAware: true, workoutName: 'Strength B', workoutMinutes: 90 };
  const fuel = (dateKey) => {
    const g = new Function('st', 'tgt', asServed(
      'function calcTrainingAwareTargets_(){ return tgt; }' + String.fromCharCode(10) + CHAIN +
      ';return fuelBudgetForDate_;'))(st, tgt);
    return g(dateKey);
  };
  setRides([{ date: D, name: 'Zwift - VO2 Work', sportType: 'VirtualRide', avgPwr: 124.1, movingSecs: 2702, workKj: 335.2 }]);
  const f = fuel(D);
  eq('burned is the real measurement', f.burned, 335);
  eq('base EXCLUDES the prescribed estimate once a real burn exists', f.base, 2402);
  eq('total is base + burned', f.total, 2737);
  eq('...and it reports which estimate it replaced', f.replacedEstimate, 335);
  // The literal sentence that was wrong on screen.
  const line = f.burned > 0
    ? ('Base ' + f.base.toLocaleString() + ' + Burned ' + f.burned.toLocaleString() + ' = ' + f.total.toLocaleString() + ' cal')
    : ('Base ' + f.base.toLocaleString() + ' cal + nothing burned yet');
  eq('the header line names the burn', line, 'Base 2,402 + Burned 335 = 2,737 cal');
  ok('...and no longer says nothing burned', line.indexOf('nothing burned') < 0);
}
{
  setRides([]);
  const g = new Function('st', asServed(
    'function calcTrainingAwareTargets_(){ return { cal:2402, baseCal:2402, exerciseCal:0 }; }' + String.fromCharCode(10) + CHAIN +
    ';return fuelBudgetForDate_;'))(st);
  const f = g(D);
  eq('a day with no activity burns nothing', f.burned, 0);
  eq('...and shows the plain base, not a hidden burn', f.total, 2402);
}

console.log('\n' + Y + '=== ONE burn path, not two ===' + X);
{
  // The duplicate I added inside calcTrainingAwareTargets_ made the total include a burn that the
  // header then reported as zero, because they were different functions.
  ok('no second burn implementation survives', !/function nutrActualBurn_/.test(src));
  ok('calcTrainingAwareTargets_ does not apply a burn itself',
     !/_burn\s*=|_rbCal/.test(exFn('calcTrainingAwareTargets_')));
  ok('fuelBudgetForDate_ is the only place a real burn is added', /burn\.cal>0 && tgt\.baseCal!=null/.test(exFn('fuelBudgetForDate_')));
}

console.log('\n' + Y + '=== housekeeping ===' + X);
{
  setRides([{ date: '2026-08-10', sportType: 'Ride', calories: 500 }]);
  eq('a different date does not leak in', M.burnedCalsForDate_(D).cal, 0);
  setRides([{ date: D, sportType: 'Ride', calories: 500, deleted: true }]);
  eq('a deleted activity is not counted', M.burnedCalsForDate_(D).cal, 0);
  setRides([{ date: D, sportType: 'Ride', calories: 300 }, { date: D, sportType: 'Ride', avgPwr: 90, movingSecs: 2222, workKj: 200 }]);
  eq('a mixed day sums both sources', M.burnedCalsForDate_(D).cal, 500);
  eq('...counting both activities', M.burnedCalsForDate_(D).n, 2);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'nutr burn: all checks passed' + X));
process.exit(fails ? 1 : 0);
