// A RUNNING TRAJECTORY THAT DESCRIBES THE CALENDAR IS NOT A TRAJECTORY.
//
// This card is the Dashboard's Performance Trajectory scoped to running, and scoping it opened four
// failure modes the cycling version never has to survive:
//
//   1 THE STORE DECIDES THE SHAPE. pmcSeries_ sums a STORED r.tss, and applyRunHrTss_ only ever
//     wrote that field onto st.rides records. Measured live: 175 of 2,371 runs carry a stored TSS,
//     2,137 can be scored from avgHR. Reading the stored field draws a ridge shaped by which store
//     a run lives in. The load must be SCORED at read time.
//   2 THE LAYOFF. Run history here is punctuated by real breaks - 154 days from Aug 2025, 107 from
//     Apr 2026. A percentage across one of those is a fact about the calendar, and the card has to
//     say so out loud rather than call it lost form.
//   3 PACE IS INVERTED. A smaller number is better. An arrow driven by the sign of the change
//     paints a 30-second-per-mile GAIN bright red.
//   4 FORM CROSSES ZERO. A percentage on a swing from -5 to +7 is arithmetic, not information.
//
// The card SHARES NO CODE with the Dashboard's Performance Trajectory - own chart, own layout, own
// colours. That is a deliberate duplication: an earlier pass extracted a shared shell, which meant
// editing a file the Dashboard renders to serve a change scoped to this page. Reverted, and pinned
// by dashboard-untouched-test.mjs.
//
// Every assertion carries a negative control. Run: node scripts/run-trajectory-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
function mb(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, mb(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

// The card is SELF-CONTAINED - its own chart, its own layout, no helper shared with the Dashboard.
const FNS = ['_rtInvalidate_','_rtDailyTss_','_rtSeries_','_rtWindow_','_rtDelta_','_rtLayoff_',
             '_rtVerdict_','_rtIsEasy_','_rtDrivers_','_rtInsight_','_rtCardHTML_','_rtChart_','hrTssFor_'];
let bundle = '';
for (const n of FNS) { const s = exFn(n); ok('extracted ' + n, s.indexOf('function ' + n) === 0 && s.trim().endsWith('}')); bundle += s; }

const lit = (re, label) => { const m = src.match(re); ok(label, !!m); return m ? m[1] : null; };
const RT_RANGES = lit(/var _RT_RANGES=(\[\[[^\n]*?\]\]);/, '_RT_RANGES literal found');
const RT_COLS   = lit(/var _RT_COLS=(\{[^}]*\});/, '_RT_COLS literal found');
const RT_FLOOR  = lit(/var _RT_BASE_FLOOR=(\d+);/, '_RT_BASE_FLOOR literal found');
const RT_EASY   = lit(/var _RT_EASY_HRIF=([\d.]+);/, '_RT_EASY_HRIF literal found');
// Every constant _rtDrivers_ reads must be declared in the harness. A missing one is a
// ReferenceError that the function's own try/catch swallows, and the rows come back empty - a
// harness that looks like it is measuring and is not.
const RT_VOL    = lit(/var _RT_VOL_FLOOR=([\d.]+);/, '_RT_VOL_FLOOR literal found');

// A pinned clock: every window and every layoff is relative to "today".
const TODAY = '2026-08-25';
const [TY, TM, TD] = TODAY.split('-').map(Number);

function build(runs, opts) {
  opts = opts || {};
  const harness = `
    // No backticks below - this whole block is a template literal.
    function Date(a,b,c){ if(arguments.length===0) return new RealDate(${TY}, ${TM-1}, ${TD});
                          if(arguments.length===1) return new RealDate(a);
                          return new RealDate(a,b,c); }
    Date.now=RealDate.now;
    var _PMC_CTL_D=42, _PMC_ATL_D=7;
    var _RT_RANGES=${RT_RANGES};
    var _RT_COLS=${RT_COLS};
    var _RT_BASE_FLOOR=${RT_FLOOR};
    var _RT_VOL_FLOOR=${RT_VOL};
    var _RT_EASY_HRIF=${RT_EASY};
    var _rtRange=${JSON.stringify(opts.range || '90D')};
    var _rtCache={ key:null, out:null };
    var st={ lthr:${opts.lthr === undefined ? 170 : opts.lthr}, lastUpdate:1 };
    var __RUNS=${JSON.stringify(runs)};
    function _runAll_(){ return __RUNS.slice(); }
    function stLthr_(){ return st.lthr; }
    function normDate(d){ return String(d||'').slice(0,10); }
    function dayKey_(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    function _durSec_(r){ return (+r.movingSecs)||0; }
    var __PLANNED=${JSON.stringify(opts.plannedEasy || {})};
    function _runPlannedEasy_(dk){ return (dk in __PLANNED) ? __PLANNED[dk] : null; }
    ${bundle}
    return { dailyTss:_rtDailyTss_, series:_rtSeries_, win:_rtWindow_, delta:_rtDelta_,
             layoff:_rtLayoff_, verdict:_rtVerdict_, isEasy:_rtIsEasy_, drivers:_rtDrivers_,
             insight:_rtInsight_, card:_rtCardHTML_, chart:_rtChart_, hrTss:hrTssFor_ };
  `;
  return new Function('RealDate', harness)(Date);
}

// A run generator: n runs ending `endAgo` days ago, one every `every` days.
function mkRuns(spec) {
  const out = [];
  spec.forEach(s => {
    for (let i = 0; i < s.n; i++) {
      const d = new Date(Date.UTC(TY, TM - 1, TD) - (s.startAgo - i * (s.every || 1)) * 86400000);
      out.push({ date: d.toISOString().slice(0, 10), distance: s.mi, movingSecs: s.sec,
                 avgHR: s.hr, name: s.name || 'Run', tss: s.tss, tssSource: s.tssSource });
    }
  });
  return out;
}

console.log('\n' + Y + '=== 1. the load is SCORED, not read off whichever store the run lives in ===' + X);
{
  // The exact live shape: a snapshot run with HR and no stored tss, beside a stale power-tss run.
  const F = build([
    { date:'2026-08-20', distance:5, movingSecs:3000, avgHR:150 },                              // scoreable
    { date:'2026-08-21', distance:5, movingSecs:3000, avgHR:150, tss:99, tssSource:'power' },    // stale power value
    { date:'2026-08-22', distance:5, movingSecs:3000 },                                          // no HR at all
    { date:'2026-08-23', distance:5, movingSecs:3000, tss:44, tssSource:'hr' }                    // stored hr value
  ]);
  const by = F.dailyTss();
  // hrTSS = hours * (hr/LTHR)^2 * 100 = (3000/3600) * (150/170)^2 * 100
  const want = Math.round(((3000/3600) * Math.pow(150/170, 2) * 100) * 10) / 10;
  eq('a snapshot run with HR and no stored tss still carries load', by['2026-08-20'], want);
  eq('a stale POWER tss is ignored - the HR score is used instead', by['2026-08-21'], want);
  ok('NEG: the stale 99 never reaches the series', by['2026-08-21'] !== 99);
  ok('NEG: a run with no HR and no hr-sourced tss contributes nothing', by['2026-08-22'] === undefined);
  eq('a stored hr-sourced tss is the fallback when HR is unreadable', by['2026-08-23'], 44);

  // NEGATIVE CONTROL on the scorer itself.
  ok('NEG: hrTssFor_ refuses a run with no HR', F.hrTss({ date:'x', movingSecs:3000 }, 170) == null);
  ok('NEG: hrTssFor_ refuses a run with no duration', F.hrTss({ date:'x', avgHR:150 }, 170) == null);
  const F0 = build([{ date:'2026-08-20', distance:5, movingSecs:3000, avgHR:150 }], { lthr: 0 });
  eq('NEG: no threshold HR set means no series at all, not a zero one', F0.series(), []);
}

console.log('\n' + Y + '=== 2. the triple always agrees: Fitness minus Fatigue IS Form ===' + X);
{
  const F = build(mkRuns([{ n:40, startAgo:120, every:3, mi:5, sec:3000, hr:150 }]));
  const ser = F.series();
  ok('a series was built', ser.length > 100);
  const bad = ser.filter(p => Math.abs((p.ctl - p.atl) - p.tsb) > 1e-9);
  eq('every day satisfies ctl - atl = tsb exactly', bad.length, 0);
  eq('the series ends today', ser[ser.length - 1].date, TODAY);
  ok('...and starts at the first day carrying load, not at zero-forever', ser[0].ctl > 0);
}

console.log('\n' + Y + '=== 3. a percentage needs a base worth dividing by ===' + X);
{
  const F = build([]);
  eq('a base under the floor suppresses the percentage', F.delta([{ctl:2.4},{ctl:30}]).pct, null);
  ok('...and says the base was weak', F.delta([{ctl:2.4},{ctl:30}]).weakBase === true);
  ok('...and still reports both absolute numbers', F.delta([{ctl:2.4},{ctl:30}]).from === 2.4 && F.delta([{ctl:2.4},{ctl:30}]).to === 30);
  const strong = F.delta([{ctl:20},{ctl:30}]);
  eq('a base above the floor divides normally', strong.pct, 50);
  ok('NEG: a strong base is not flagged weak', strong.weakBase === false);
  // The artifact this floor exists to prevent.
  ok('NEG: 2.4 -> 30 would have been +1150%', Math.round((30-2.4)/2.4*100) === 1150);
  eq('NEG: one point is not a trend', F.delta([{ctl:20}]), null);
  // The verdict must not describe a magnitude it cannot compute.
  ok('a weak base gets a direction verdict, not a speed one', F.verdict(F.delta([{ctl:2.4},{ctl:30}])).head.indexOf('fast') < 0);
  ok('...and reads as rebuilding', /rebuilding/.test(F.verdict(F.delta([{ctl:2.4},{ctl:30}])).head));
}

console.log('\n' + Y + '=== 4. the layoff: a break is named, and never over-claimed ===' + X);
{
  // Runs, then a 107-day hole, then a restart - the live 2026 shape.
  const F = build([
    { date:'2026-01-10', distance:5, movingSecs:3000, avgHR:150 },
    { date:'2026-01-15', distance:5, movingSecs:3000, avgHR:150 },
    { date:'2026-04-13', distance:5, movingSecs:3000, avgHR:150 },
    { date:'2026-07-29', distance:5, movingSecs:3000, avgHR:150 },
    { date:'2026-08-20', distance:5, movingSecs:3000, avgHR:150 }
  ]);
  eq('the 107-day hole is found across the whole history', F.layoff(0).gap, 107);
  eq('...and it is the Apr->Jul one', [F.layoff(0).from, F.layoff(0).to], ['2026-04-13','2026-07-29']);
  // A 90-day window starts 2026-05-27, INSIDE the hole. Claiming 107 days there would be claiming
  // a break that mostly happened before the window began.
  const l90 = F.layoff(90);
  ok('a gap starting before the window is clipped to the part inside it', l90.gap < 107 && l90.gap > 0);
  eq('...to exactly the days from the window edge to the restart', l90.gap, 63);
  ok('NEG: the 90D view does not claim the full 107 days', l90.gap !== 107);

  // A trailing gap - nothing since April - is still a layoff even with no later run to close it.
  const F2 = build([
    { date:'2026-01-10', distance:5, movingSecs:3000, avgHR:150 },
    { date:'2026-04-13', distance:5, movingSecs:3000, avgHR:150 }
  ]);
  eq('an open-ended gap to today counts', F2.layoff(0).gap, 134);
  eq('...and has no closing date', F2.layoff(0).to, null);
  // NEGATIVE CONTROL: an unbroken block reports no layoff worth naming.
  const F3 = build(mkRuns([{ n:30, startAgo:60, every:2, mi:5, sec:3000, hr:150 }]));
  ok('NEG: a steady block reports a small gap, not a layoff', F3.layoff(0).gap < 21);

  // And the sentence has to actually say it.
  const w = F.win('1Y'), d = F.delta(w.pts);
  const s = F.insight(d, w, { rows: [] }, F.layoff(365));
  ok('the insight names the break in days', /not running for \d+ days/.test(s));
  ok('NEG: it does not call a break lost form', s.indexOf('lost form') < 0);
}

console.log('\n' + Y + '=== 5. pace is inverted: faster must read as better ===' + X);
{
  // Prior window: 8 easy runs at 11:00/mi. Current: 8 easy runs at 10:00/mi. That is an improvement.
  const planned = {};
  const runs = [];
  const mk = (ago, secPerMi) => {
    const d = new Date(Date.UTC(TY, TM - 1, TD) - ago * 86400000).toISOString().slice(0, 10);
    planned[d] = true;
    runs.push({ date: d, distance: 5, movingSecs: secPerMi * 5, avgHR: 150, name: 'Run' });
  };
  for (let i = 0; i < 8; i++) mk(3 + i * 3, 600);      // inside 30D, 10:00/mi
  for (let i = 0; i < 8; i++) mk(33 + i * 3, 660);     // the previous 30D, 11:00/mi
  const F = build(runs, { range: '30D', plannedEasy: planned });
  const drv = F.drivers(30);
  const pace = drv.rows.filter(r => r.label === 'Avg easy pace')[0];
  ok('the easy-pace row exists', !!pace);
  ok('a FASTER pace is marked better', pace.better === true);
  ok('NEG: and the raw change is negative, so a sign-driven arrow would have called it worse', pace.delta < 0);
  ok('the detail reads before then after', pace.detail.indexOf('11:00') === 0 && pace.detail.indexOf('10:00') > 0);
  ok('the sample size is stated', /8 vs 8 easy runs/.test(pace.sample));

  const html = F.card();
  const seg = html.slice(html.indexOf('Avg easy pace'), html.indexOf('Avg easy pace') + 400);
  ok('the card paints the improvement green, not red', seg.indexOf('#22c55e') > 0 && seg.indexOf('#ef4444') < 0);
  ok('...with an up arrow', seg.indexOf('&uarr;') > 0);

  // The mirror case must go the other way, or the flag is just hardcoded true.
  const runs2 = [], planned2 = {};
  const mk2 = (ago, secPerMi) => {
    const d = new Date(Date.UTC(TY, TM - 1, TD) - ago * 86400000).toISOString().slice(0, 10);
    planned2[d] = true;
    runs2.push({ date: d, distance: 5, movingSecs: secPerMi * 5, avgHR: 150, name: 'Run' });
  };
  for (let i = 0; i < 8; i++) mk2(3 + i * 3, 660);     // got SLOWER
  for (let i = 0; i < 8; i++) mk2(33 + i * 3, 600);
  const F2 = build(runs2, { range: '30D', plannedEasy: planned2 });
  const pace2 = F2.drivers(30).rows.filter(r => r.label === 'Avg easy pace')[0];
  ok('NEG: a SLOWER pace is marked worse', pace2.better === false);
}

console.log('\n' + Y + '=== 6. Form crosses zero, so it is never a percentage ===' + X);
{
  const F = build(mkRuns([{ n:60, startAgo:200, every:3, mi:5, sec:3000, hr:150 }]), { range:'90D' });
  const form = F.drivers(90).rows.filter(r => r.label === 'Form (TSB)')[0];
  ok('the Form row exists', !!form);
  eq('NEG: Form carries no percentage', form.pct, null);
  eq('Form is stated in points', form.unit, 'pts');
  ok('Form is marked neutral - it has no good side on its own', form.neutral === true);
  const html = F.card();
  const seg = html.slice(html.indexOf('Form (TSB)'), html.indexOf('Form (TSB)') + 500);
  // The legend also prints "Form (TSB)"; take the drivers occurrence.
  const i2 = html.indexOf('Form (TSB)', html.indexOf('The numbers behind it'));
  const seg2 = html.slice(i2, i2 + 400);
  ok('NEG: no percent sign on the Form driver row', seg2.indexOf('%') < 0);
  ok('...and it is not coloured as a win or a loss', seg2.indexOf('#22c55e') < 0 && seg2.indexOf('#ef4444') < 0);
  // Fitness, by contrast, IS a percentage when the base allows it.
  const fit = F.drivers(90).rows.filter(r => r.label === 'Fitness (CTL)')[0];
  ok('Fitness does carry a percentage when the base allows', fit.unit === '%' || fit.pct != null);
}

console.log('\n' + Y + '=== 7. a driver that cannot be computed is NAMED, not dropped ===' + X);
{
  // Eight runs in the last 30 days and nothing at all in the 30 before - the live 30D shape.
  const runs = [], planned = {};
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(TY, TM - 1, TD) - (3 + i * 3) * 86400000).toISOString().slice(0, 10);
    planned[d] = true;
    runs.push({ date: d, distance: 5, movingSecs: 3000, avgHR: 150, name: 'Run' });
  }
  const F = build(runs, { range: '30D', plannedEasy: planned });
  const drv = F.drivers(30);
  ok('easy pace is reported missing', drv.miss.indexOf('Avg easy pace') >= 0);
  ok('...with the reason stated', /no easy runs in the 30 days before/.test(drv.missWhy));
  ok('miles per week is missing too - there is no prior half', drv.miss.indexOf('Miles / week') >= 0);
  const html = F.card();
  ok('the card prints the omission rather than looking sparse', html.indexOf('comparable stretch on both sides') > 0);
  ok('NEG: it does not invent a pace comparison', html.indexOf('/mi') < 0);
  // NEGATIVE CONTROL: with both halves present, nothing is reported missing.
  const F2 = build(mkRuns([{ n:40, startAgo:118, every:3, mi:5, sec:3000, hr:150 }]), { range:'30D' });
  const d2 = F2.drivers(30);
  ok('NEG: a range with both halves populated reports Miles / week', d2.rows.some(r => r.label === 'Miles / week'));
}

console.log('\n' + Y + '=== 8. the run card draws its OWN ridge ===' + X);
{
  const F = build([]);
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push({ ctl: 20 + i, atl: 15 + i, tsb: 5 });

  const run = F.chart(pts, 600, 150);
  ok('the run ridge is orange', run.indexOf('stroke="#fb923c"') > 0 && run.indexOf('#fdba74') > 0);
  ok('NEG: no dashboard green in the run ridge', run.indexOf('#22c55e') < 0 && run.indexOf('#4ade80') < 0);
  // The two charts are separate copies, so their gradient ids must not collide if both ever render
  // in one document - the run one is prefixed rtg, the Dashboard's ptg.
  ok('the run gradient id cannot collide with the Dashboard chart', /id="rtg[^"]+a"/.test(run));

  // Too little history says so rather than drawing a flat line at zero.
  ok('one point draws no ridge', F.chart([{ctl:1,atl:1,tsb:0}], 600, 150).indexOf('Not enough history') > 0);
}

console.log('\n' + Y + '=== 9. this card touches NOTHING the Dashboard renders ===' + X);
{
  // An earlier pass extracted a shared shell so both trajectory cards could render through one
  // function. It looked like good engineering and it was the wrong call: it edited code the
  // Dashboard renders in order to serve a change scoped to the Run page, and it DID change the
  // Dashboard - fixed 186/344px columns became flexible, the row gained flex-wrap, and the good/bad
  // colours moved from #22c55e/#ef4444 to theme tokens. Reverted; the duplication below is
  // deliberate and is the cheaper of the two costs.
  const rtc = exFn('_rtCardHTML_'), rch = exFn('_rtChart_');
  const SHARED = ['_ptTrajShell_', '_ptDriverRows_', '_ptPanelHead_', '_ptChart_', '_PT_COLS',
                  '_ptWindow_', '_ptDelta_', '_ptVerdict_', '_ptInsight_', '_ptFactors_'];
  SHARED.forEach(n => {
    ok('NEG: the run card does not call ' + n, rtc.indexOf(n) < 0 && rch.indexOf(n) < 0);
  });
  // ...and the helpers that pass no longer exist at all, so nothing can start using them again.
  ['_ptTrajShell_', '_ptDriverRows_', '_ptPanelHead_'].forEach(n => {
    ok('NEG: ' + n + ' is gone from the file', src.indexOf('function ' + n + '(') < 0);
  });
  ok('NEG: the _PT_COLS constant is gone too', src.indexOf('var _PT_COLS=') < 0);
  // The run card draws its own ridge, with its own gradient namespace.
  // 110px, not 150 - the ridge was the largest single block of pure height on a page that has to
  // fit a viewport, and a direction survives compression. Asserted on the call rather than on the
  // number alone so a silent revert to the Dashboard's chart still trips it.
  ok('the run card calls its own chart', /_rtChart_\(w\.pts, 600, 110\)/.test(rtc));
  ok('...whose gradient ids are prefixed rtg', /var uid='rtg'/.test(rch));
  ok('NEG: and the Dashboard chart still uses ptg', /var uid='ptg'/.test(exFn('_ptChart_')));
}

console.log('\n' + Y + '=== 10. the card mounts once, for both surfaces ===' + X);
{
  ok('renderRunInto_ mounts it', /_rtMount_\(scr\);/.test(src));
  // The definition also reads _rtMount_(scr, so count CALLS only - a bare occurrence count would
  // report 2 and the "one call site" claim would be untestable.
  eq('exactly one mount call site', (src.match(/(?<!function )_rtMount_\(scr\)/g) || []).length, 1);
  ok('the desktop page renders through renderRunInto_', /renderRunInto_\(host, 'desktop'\)/.test(src));
  // NEGATIVE CONTROL: the Dashboard card must not have been repointed at the run series.
  ok('NEG: _ptCardHTML_ still reads the all-sport window', /function _ptCardHTML_[\s\S]{0,200}_ptWindow_\(_ptRange\)/.test(src));
  ok('NEG: the run card has its own range state', /var _rtRange=/.test(src) && /var _ptRange=/.test(src));
  ok('NEG: the run range toggle does not write the dashboard one',
     !/function rtSetRange_[\s\S]{0,240}_ptRange=/.test(src));
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'all assertions passed' + X));
process.exit(fails ? 1 : 0);
