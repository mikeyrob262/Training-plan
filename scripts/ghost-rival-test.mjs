// Ghost Rival. The design decisions worth pinning are the two things it REFUSES to do: no FTP axis,
// and no opponent picked from a year that was not a cycling season. Both were arrived at from
// measurements - the FTP log is seven entries inside one ten-day window, and 2019 was 132 cycling
// miles against 220 runs, a runner rather than a rival.
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

const THIS_YEAR = String(new Date().getFullYear());
const st = { rides: [], fitSeries: [] };
let SERIES = [];
const RUNS = [];        // {date, mi} rows the _msRunning_ stub serves
const RUNSERIES = [];   // {date, ctl} rows the _rtSeries_ stub serves
const M = new Function('st', 'SERIES', 'RUNS', 'RUNSERIES', asServed(
  'function _msRunning_(){ return RUNS.map(function(r){ return {date:r.date, mi:r.mi}; }); }' + NL +
  'function _rtSeries_(){ return RUNSERIES.slice(); }' + NL +
  exFn('_ghostRunMiles_') +
  exFn('_ghostRunCtl_') +
  // Ghost Rival counts from allRidesDeduped_, not st.rides - reading the raw library
  // double-counted a FIT import and its Strava twin and put 2025 at 7,050 miles against
  // Strava's own 5,484. The harness supplies a dedupe so the fixtures exercise the real path.
  'function allRidesDeduped_(){ var seen={}, out=[]; (st.rides||[]).forEach(function(r){ if(!r||r.deleted) return; var k=String(r.date).slice(0,10)+"|"+Math.round((parseFloat(r.distance)||0)*10); if(seen[k]) return; seen[k]=1; out.push(r); }); return out; }' + NL +
  'function rideSport_(r){ return r.sportType||r.type||"Ride"; }' + NL +
  'function getTodayKey(){ return new Date().toISOString().slice(0,10); }' + NL +
  'function fitnessSeries_(){ return SERIES; }' + NL +
  exVar('GHOST_MIN_MILES') +
  exFn('_ghostRides_') + exFn('_ghostDoy_') + exFn('ghostYears_') + exFn('_ghostMiles_') + exFn('_ghostCtl_') + exFn('ghostRival_') +
  ';return { _ghostDoy_, ghostYears_, _ghostMiles_, _ghostCtl_, ghostRival_, GHOST_MIN_MILES };'
))(st, SERIES, RUNS, RUNSERIES);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== there is NO FTP axis, and that is deliberate ===' + X);
{
  const g = exFn('ghostRival_') + exFn('aiRenderGhost_');
  ok('the model exposes no ftp field', !/ftp\s*:/i.test(exFn('ghostRival_')));
  ok('the page draws no FTP race', !/FTP race|ftpHistory/i.test(exFn('aiRenderGhost_')));
  ok('...and says why, on the page', /seven[\s\S]{0,80}entries|ten-day window/.test(exFn('aiRenderGhost_')));
}

console.log('\n' + Y + '=== a year that was not a cycling season is not a rival ===' + X);
{
  st.rides.length = 0;
  // 2019 as it really is in this library: a runner's year.
  for (let i = 0; i < 20; i++) st.rides.push({ date: '2019-03-' + String((i % 28) + 1).padStart(2, '0'), sportType: 'Ride', distance: 6 });
  for (let i = 0; i < 40; i++) st.rides.push({ date: '2025-03-' + String((i % 28) + 1).padStart(2, '0'), sportType: 'Ride', distance: 40 });
  const ys = M.ghostYears_();
  ok('2025 qualifies', ys.some((y) => y.year === '2025'));
  ok('2019 does NOT - 120 miles is not a season', !ys.some((y) => y.year === '2019'));
  ok('the bar is a named constant', M.GHOST_MIN_MILES >= 100);
}
{
  // Runs must never count toward a CYCLING rivalry.
  st.rides.length = 0;
  for (let i = 0; i < 60; i++) st.rides.push({ date: '2024-05-' + String((i % 28) + 1).padStart(2, '0'), sportType: 'Run', distance: 20 });
  eq('a year of running is not a cycling season', M.ghostYears_().filter((y) => y.year === '2024').length, 0);
}

console.log('\n' + Y + '=== a ride imported twice is counted ONCE ===' + X);
{
  // The reported bug, in miniature. Ghost Rival read st.rides RAW and reported 7,050 miles for
  // 2025 where Strava's own Training Calendar says 5,484.1. Measured against the same library:
  //     raw st.rides        234 rides   7,050 mi
  //     allRidesDeduped_()  197 rides   5,480 mi
  // The extra 1,570 miles are the same rides counted twice. They do NOT share a rideKey - 46 of
  // the 2025 rides carry no stravaId at all - so a FIT import and its Strava twin both survive a
  // naive filter.
  st.rides.length = 0;
  st.rides.push({ date: '2025-06-01', sportType: 'Ride', distance: 40, stravaId: '1', source: 'strava' });
  st.rides.push({ date: '2025-06-01', sportType: 'Ride', distance: 40, source: 'fit' });
  st.rides.push({ date: '2025-06-02', sportType: 'Ride', distance: 30, stravaId: '2', source: 'strava' });
  for (let i = 3; i < 30; i++) st.rides.push({ date: '2025-06-' + String(i).padStart(2, '0'), sportType: 'Ride', distance: 20, stravaId: 's' + i });
  const expected = 40 + 30 + (27 * 20);
  const m = M._ghostMiles_('2025');
  eq('the duplicated ride is counted once', m[366], expected);
  ok('...not twice', m[366] !== expected + 40);
  eq('the year list agrees with the mileage series',
     M.ghostYears_().filter(function(y){ return y.year === '2025'; })[0].miles, expected);
}
{
  const yrs = exFn('ghostYears_'), mil = exFn('_ghostMiles_');
  ok('neither ghost function reads st.rides directly',
     yrs.indexOf('st.rides') < 0 && mil.indexOf('st.rides') < 0);
  ok('...both go through the deduped accessor',
     yrs.indexOf('_ghostRides_()') >= 0 && mil.indexOf('_ghostRides_()') >= 0);
  ok('...which is allRidesDeduped_, the same source every other mileage surface reads',
     /allRidesDeduped_/.test(exFn('_ghostRides_')));
}

console.log('\n' + Y + '=== day-of-year is the comparison basis ===' + X);
{
  eq('Jan 1 is day 1', M._ghostDoy_('2026-01-01'), 1);
  eq('Dec 31 of a non-leap year is 365', M._ghostDoy_('2026-12-31'), 365);
  eq('a leap year reaches 366', M._ghostDoy_('2024-12-31'), 366);
  eq('junk is refused rather than guessed', M._ghostDoy_('nonsense'), null);
}
{
  st.rides.length = 0;
  st.rides.push({ date: '2025-01-10', sportType: 'Ride', distance: 30 });
  st.rides.push({ date: '2025-02-10', sportType: 'Ride', distance: 20 });
  const m = M._ghostMiles_('2025');
  eq('miles accumulate to the day', m[10], 30);
  eq('...and keep accumulating', m[41], 50);
  eq('a day before any ride is zero, not null', m[5], 0);
}

console.log('\n' + Y + '=== CTL holds through a rest day, it does not vanish ===' + X);
{
  SERIES.length = 0;
  SERIES.push({ date: '2025-01-10', ctl: 40 });
  SERIES.push({ date: '2025-01-20', ctl: 44 });
  const c = M._ghostCtl_('2025');
  eq('a day with a reading uses it', c[10], 40);
  eq('a day between readings holds the last', c[15], 40);
  eq('...until the next one', c[20], 44);
  eq('before the first reading there is nothing, not a zero', c[3], null);
}

console.log('\n' + Y + '=== the race itself ===' + X);
{
  st.rides.length = 0;
  SERIES.length = 0;
  const today = new Date();
  const mk = (y, d, dist) => ({ date: y + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), sportType: 'Ride', distance: dist });
  // both riders have ridden every day so far this season
  for (let i = 1; i <= 40; i++) {
    const d = new Date(today.getFullYear(), 0, i);
    st.rides.push(mk(THIS_YEAR, d, 30));
    st.rides.push(mk(String(+THIS_YEAR - 1), d, 20));
  }
  SERIES.push({ date: THIS_YEAR + '-01-05', ctl: 50 });
  SERIES.push({ date: (+THIS_YEAR - 1) + '-01-05', ctl: 35 });
  const g = M.ghostRival_();
  ok('a rival is chosen', !!g && g.rivalYear === String(+THIS_YEAR - 1));
  ok('the rival is never the current year', g.rivalYear !== g.meYear);
  ok('miles are compared', g.miles.me > 0 && g.miles.rival > 0);
  eq('...with the lead stated', g.miles.delta, g.miles.me - g.miles.rival);
  eq('CTL is compared too', g.ctl.delta, 15);
}
{
  // A missing reading must not be rendered as a defeat.
  st.rides.length = 0; SERIES.length = 0;
  for (let i = 1; i <= 40; i++) {
    const d = new Date(new Date().getFullYear(), 0, i);
    st.rides.push({ date: THIS_YEAR + '-01-' + String(i).padStart(2, '0'), sportType: 'Ride', distance: 30 });
    st.rides.push({ date: (+THIS_YEAR - 1) + '-01-' + String(i).padStart(2, '0'), sportType: 'Ride', distance: 20 });
  }
  const g = M.ghostRival_();
  eq('no CTL for either rider -> null, not zero', g.ctl.delta, null);
  ok('...and the values themselves are null', g.ctl.me === null && g.ctl.rival === null);
}

console.log('');
console.log(Y + '=== the running race is drawn from the RUN library, not the ride one ===' + X);
{
  // Ghost Rival raced cycling only on a page meant to represent the whole athlete - the same gap
  // found on Milestones and the Overview. This pins that running is actually raced, that it is raced
  // against RUNNING fitness rather than the all-sport figure, and that a year with no running is not
  // dressed up as a contest.
  st.rides.length = 0; SERIES.length = 0; RUNS.length = 0; RUNSERIES.length = 0;
  const Y0 = THIS_YEAR, Y1 = String(+THIS_YEAR - 1);
  // Enough cycling in both years that they qualify as rival seasons at all.
  for (let i = 1; i <= 60; i++) {
    st.rides.push({ date: Y0 + '-01-' + String((i % 28) + 1).padStart(2, '0'), distance: 30, sportType: 'Ride' });
    st.rides.push({ date: Y1 + '-01-' + String((i % 28) + 1).padStart(2, '0'), distance: 30, sportType: 'Ride' });
  }
  RUNS.push({ date: Y0 + '-01-05', mi: 12 }, { date: Y0 + '-01-06', mi: 8 });
  RUNS.push({ date: Y1 + '-01-05', mi: 4 });
  RUNSERIES.push({ date: Y0 + '-01-06', ctl: 31.5 }, { date: Y1 + '-01-06', ctl: 22.0 });
  const g = M.ghostRival_(Y1);
  ok('run miles are raced', !!g && g.runMiles && g.runMiles.me === 20 && g.runMiles.rival === 4);
  ok('...with the lead stated', g.runMiles.delta === 16);
  ok('running fitness is raced, and it is the RUNNING series', g.runCtl && g.runCtl.me === 31.5 && g.runCtl.rival === 22);
  ok('...and is not the all-sport CTL', g.runCtl.me !== g.ctl.me);
  ok('the running series are returned for the chart', !!g.series.meRunMiles && !!g.series.rivalRunCtl);
  // NEGATIVE CONTROL: no running in either year must not draw an empty race.
  RUNS.length = 0; RUNSERIES.length = 0;
  const g2 = M.ghostRival_(Y1);
  ok('NEG: with no running at all, both sides are zero rather than invented', g2.runMiles.me === 0 && g2.runMiles.rival === 0);
  ok('NEG: and running CTL is null, not zero', g2.runCtl.me == null && g2.runCtl.rival == null);
  const page = exFn('aiRenderGhost_');
  ok('the page only draws the run race when there is one', /_rivalRan \|\| _meRan/.test(page));
  ok('...and says so when there is not', /no run race to draw/.test(page));
  ok('the footnote names the running series as running-only', /counts running only/.test(page));
}


console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'ghost rival: all checks passed' + X));
process.exit(fails ? 1 : 0);
