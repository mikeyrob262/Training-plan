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
const M = new Function('st', 'SERIES', asServed(
  'function rideSport_(r){ return r.sportType||r.type||"Ride"; }' + NL +
  'function getTodayKey(){ return new Date().toISOString().slice(0,10); }' + NL +
  'function fitnessSeries_(){ return SERIES; }' + NL +
  exVar('GHOST_MIN_MILES') +
  exFn('_ghostDoy_') + exFn('ghostYears_') + exFn('_ghostMiles_') + exFn('_ghostCtl_') + exFn('ghostRival_') +
  ';return { _ghostDoy_, ghostYears_, _ghostMiles_, _ghostCtl_, ghostRival_, GHOST_MIN_MILES };'
))(st, SERIES);

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

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'ghost rival: all checks passed' + X));
process.exit(fails ? 1 : 0);
