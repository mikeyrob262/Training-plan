// Month Race cumulative-chart guard.
//
// The section is a race between three curves, and almost everything that can go wrong with it is
// silent: a line drawn outside the plot box still renders, a Best Month curve truncated to today
// still looks like a chart, an axis that does not reach the tallest series just clips it, and a
// crosshair whose geometry disagrees with the drawn path reads values off the wrong day. None of
// those throw, so none of them are caught by "did it render".
//
// The rules being pinned, all of which carry meaning rather than taste:
//   - You and last month STOP AT TODAY. Comparing a partial month against a complete one is the
//     defect this whole page was corrected for, and the line lengths are where that now lives.
//   - Best Month runs its FULL length and is the DASHED one. It is a record, not a peer.
//   - Every plotted point lands inside the plot box, on both surfaces.
//   - The callouts survive, and sit BELOW the chart.
//   - The crosshair reads the same number the curve was drawn from.
//
// Fixtures, not the live library: this must run offline in preflight and must not change its
// verdict when the athlete rides.
//
// Run: node scripts/month-race-chart-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){
  const idx = src.indexOf('function '+name+'(');
  if (idx < 0) throw new Error('fn not found in worker.js: '+name);
  return src.slice(idx, matchBrace(idx)+1)+'\n';
}
function extractVar(name){
  const m = src.match(new RegExp('^var ' + name + '[^\\n]*$', 'm'));
  if (!m) throw new Error('var not found in worker.js: '+name);
  return m[0]+'\n';
}

// A DOM stub good enough for the hover path; the build path is pure string work.
const els = {};
const stub = id => (els[id] = els[id] || { id, style:{}, textContent:'', _a:{}, setAttribute(k,v){this._a[k]=v;}, getAttribute(k){return this._a[k];} });
globalThis.document = { getElementById: id => els[id] || null };
// _mrGeo_ asks isDesktop(); the harness drives it, one surface at a time.
let DESKTOP = true;
globalThis.isDesktop = () => DESKTOP;

const code = 'var _YVY_RANK_MIN=4;\n'
  + extractVar('_YVY_TOP') + extractVar('_YVY_BASE') + extractVar('_YVY_GOOD') + extractVar('_YVY_MON')
  + extractVar('_MR_YOU') + extractVar('_MR_DATA') + extractVar('_MR_CSS')
  + extract('_yvyDaysInYM_') + extract('_yvyOrdComment_') + extract('_yvyMonLabel_')
  + extract('_mrMi_') + extract('_mrDaysIn_') + extract('_mrNice_') + extract('_mrGap_')
  + extract('_mrCompute_') + extract('_mrGeo_') + extract('_mrX_') + extract('_mrY_')
  + extract('_mrPath_') + extract('_mrShow_')
  + extract('_gcLineChart_') + extract('_gcTable_')
  + extract('_mrSpec_') + extract('_mrChart_') + extract('_mrTable_')
  + extract('_mrSection_');
(0, eval)(code);

const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`${R}  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}${X}`); }
}

// A VM carrying only what Month Race reads. Cumulative arrays are built here so the fixture states
// its own expected curves rather than inheriting whatever _yvyVM_ would produce.
const cum = (perDay, days) => { const o=[]; let r=0; for(let d=1;d<=days;d++){ r+=perDay[d]||0; o.push(Math.round(r*10)/10);} return o; };
function fixture(over){
  const domNow = over.domNow ?? 29;
  const curDaily = over.curDaily || {2:34,3:30.7,5:25.7,11:33.1,18:100.5,25:33.2};
  const lastDaily = over.lastDaily || {4:40,12:60,19:80,26:50};
  const bestDaily = over.bestDaily || {3:70,9:90,17:120,24:140,29:60};
  const cumCur = cum(curDaily, domNow), cumLast = cum(lastDaily, domNow);
  const daysInBest = over.daysInBest ?? 30;
  const bestCum = over.noBest ? [] : cum(bestDaily, daysInBest);
  return Object.assign({
    sport:'ride', nA:'ride', nP:'rides', monthN:'ride-months', m:6, y:2026,
    domNow, daysInCur: over.daysInCur ?? 31, daysLeft: (over.daysInCur ?? 31) - domNow,
    curYM:'2026-07', lastYM:'2026-06', nCur:Object.keys(curDaily).length,
    cumCur, cumLast, curTot:cumCur[cumCur.length-1]||0,
    kDist:{ last: cumLast[cumLast.length-1]||0 },
    bestMonthYM: over.noBest ? null : '2025-11',
    bestMonthMi: bestCum.length ? bestCum[bestCum.length-1] : (over.noBest ? 0 : 0),
    bestCum, daysInBest: over.noBest ? 0 : daysInBest,
    rate:110, rankTot:29, completedRankable:28,
  }, over.vm || {});
}

['desktop','mobile'].forEach(function(surface){
  DESKTOP = (surface === 'desktop');
  const vm = fixture({});
  const mr = _mrCompute_(vm);
  const html = _mrSection_(vm);
  [...html.matchAll(/id="([^"]+)"/g)].forEach(m => stub(m[1]));
  const p = surface + ': ';

  check(p+'three series', mr.series.map(s=>s.key), ['you','last','best']);
  check(p+'You stops at today', mr.series[0].pts.length, vm.domNow);
  check(p+'last month stops at today too', mr.series[1].pts.length, vm.domNow);
  check(p+'Best Month runs its full length', mr.series[2].pts.length, vm.daysInBest);
  check(p+'Best Month is the only dashed series', mr.series.map(s=>!!s.dash), [false,false,true]);
  check(p+'axis spans the longest month', mr.nx, 31);
  check(p+'axis ceiling clears the tallest series', mr.maxY >= 480, true);

  // every plotted point inside the plot box
  const g = _MR_DATA['ride'];
  let out = 0;
  g.series.forEach(s => s.pts.forEach((v,i) => {
    const x=_mrX_(g,i+1), y=_mrY_(g,v);
    if (x < g.PL-0.5 || x > g.W-g.PR+0.5 || y < g.PT-0.5 || y > g.H-g.PB+0.5) out++;
  }));
  check(p+'no point escapes the plot box', out, 0);
  check(p+'today marker is on the axis', mr.domNow >= 1 && mr.domNow <= g.nx, true);
  check(p+'x axis labels the last day', html.indexOf('>'+mr.nx+'</text>') >= 0, true);

  // callouts kept, and below the chart
  const svgEnd = html.indexOf('</svg>');
  check(p+'a callout exists for each opponent', mr.series.filter(s=>s.gap).length, 2);
  mr.series.filter(s=>s.gap).forEach((s,i) => {
    check(p+'callout '+i+' present', html.indexOf(s.gap.text) >= 0, true);
    check(p+'callout '+i+' sits below the chart', html.indexOf(s.gap.text) > svgEnd, true);
  });
  check(p+'legend names every series', mr.series.every(s => html.indexOf('>'+s.label+'<') >= 0), true);
  check(p+'table view exists', html.indexOf('<details') >= 0, true);
  check(p+'no pill bars survive', html.indexOf('height:34px') < 0, true);

  // the crosshair must read the number the curve was drawn from
  _mrShow_('ride', 12);
  check(p+'hover header names the day', els['mrc-tth-ride'].textContent, 'Jul 12');
  mr.series.forEach(s => check(p+'hover reads '+s.key+' at day 12', els['mrc-ttv-ride-'+s.key].textContent, _mrMi_(s.pts[11])+' mi'));
  // past a series' last day its marker hides rather than clamping onto a wrong value
  _mrShow_('ride', 31);
  check(p+'You marker hides past its last day', els['mrc-dot-ride-you'].style.opacity, '0');
  check(p+'Best marker also hides past day 30', els['mrc-dot-ride-best'].style.opacity, '0');
});

DESKTOP = true;
// A best month with a total but no daily shape must NOT be faked as a straight line to its
// endpoint -- that would be a drawn claim about days that were never like that.
const noShape = fixture({ noBest:true });
noShape.bestMonthYM='2025-11'; noShape.bestMonthMi=480; noShape.bestCum=[]; noShape.daysInBest=0;
const mrNo = _mrCompute_(noShape);
check('shapeless Best Month is not drawn', mrNo.series.map(s=>s.key), ['you','last']);
check('...and the footnote says so', _mrSection_(noShape).indexOf('not drawn at all here') >= 0, true);

// Degenerate months must not throw or produce a broken axis.
check('empty month renders', typeof _mrSection_(fixture({ curDaily:{}, domNow:1 })), 'string');
check('no opponent at all returns empty', _mrSection_(fixture({ lastDaily:{}, noBest:true, curDaily:{} })), '');
check('day 1 of the month renders a plot', _mrSection_(fixture({ domNow:1 })).indexOf('<svg ') >= 0, true);
check('last day of the month renders a plot', _mrSection_(fixture({ domNow:31 })).indexOf('<svg ') >= 0, true);

// Axis ticks stay round, and stay distinct on a tiny month (sub-1 steps used to print "0 0 1 1").
check('nice axis: 625.7 -> 750/150', [_mrNice_(625.7,5).max, _mrNice_(625.7,5).step], [750,150]);
check('nice axis: 187.6 -> 200/50', [_mrNice_(187.6,5).max, _mrNice_(187.6,5).step], [200,50]);
const tiny = _mrSection_(fixture({ curDaily:{4:0.6}, lastDaily:{3:0.4}, noBest:true }));
const ticks = [...tiny.matchAll(/text-anchor="end">([^<]+)<\/text>/g)].map(m=>m[1]);
check('tiny month axis ticks are distinct', ticks.length, new Set(ticks).size);

if (failed) { console.error(`${R}✗ Month Race chart: ${failed} check(s) failed${X}`); process.exit(1); }
console.log(`${G}✓ Month Race cumulative chart (both surfaces, geometry + callouts + crosshair)${X}`);
