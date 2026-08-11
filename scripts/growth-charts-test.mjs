// Growth-chart guard: the shared sparkline and the year-over-year series.
//
// The app-wide rule is that anything implying progress or trajectory is a LINE. These are the
// invariants that make such a line honest, and every one of them fails SILENTLY:
//   - a period with no activity is NULL and breaks the line. Drawn as zero it becomes a collapse
//     that never happened, and a sparkline has no axis to give that away.
//   - a flat series is drawn level, not pinned to the floor. Level IS the reading.
//   - the peak ring must land on the actual peak, because on a record card the peak is the record.
//   - the year lines encode the partial-vs-complete rule in their LENGTHS: the running year stops
//     at today, completed years run their own full length (365 or 366 — leap years are a real
//     off-by-one here, and one wrong day shifts a whole curve).
//
// Fixtures, not the live library: this must run offline and must not change its verdict when the
// athlete rides.
//
// Run: node scripts/growth-charts-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function extract(name){
  const i = src.indexOf('function '+name+'(');
  if (i < 0) throw new Error('fn not found in worker.js: '+name);
  return src.slice(i, matchBrace(i)+1)+'\n';
}
function extractVar(name){
  const m = src.match(new RegExp('^var ' + name + '[^\\n]*$', 'm'));
  if (!m) throw new Error('var not found in worker.js: '+name);
  return m[0]+'\n';
}

const code = extractVar('_GC_YOY') + extractVar('_GC_FACTOR') + extractVar('_YOY_ERA_START')
  + extractVar('_YOY_CUMD') + extractVar('_AL_FACT_WIN') + extractVar('_GC_SPARSE_MAX')
  + extract('_gcSpark_') + extract('_gcSparkFoot_') + extract('_gcTrend_') + extract('_gcScale_') + extract('_gcWeekPts_')
  + extract('_yoyLeap_') + extract('_yoyDaysInYear_') + extract('_yoyDayOfYear_')
  + extract('_alIndexOfYM_') + extract('_alFactorWindow_')
  + extract('_pbQKey_') + extract('_pbQLab_') + extract('_pbQFill_') + extract('_pbProg_');
(0, eval)(code);

const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`${R}  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}${X}`); }
}
const paths = svg => [...String(svg).matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
const circles = svg => [...String(svg).matchAll(/<circle[^>]*>/g)].map(m => m[0]);
// Markers are no longer <circle r>: preserveAspectRatio="none" scales x and y independently, so
// a circle draws as an ellipse (measured 10.2 x 3.8 px on a 430px card). They are zero-length
// segments with a round linecap and a non-scaling stroke, which stay round at any stretch.
const marks = svg => [...String(svg).matchAll(/<line[^>]*stroke-linecap="round"[^>]*>/g)].map(m => m[0]);
const markAt = (m) => { const g = /x1="([\d.]+)" y1="([\d.]+)"/.exec(m); return g ? { x:+g[1], y:+g[2] } : null; };

// ---- sparkline contract -----------------------------------------------------------------------
check('a single point is not a trajectory', _gcSpark_([{v:5}], '#0891b2'), '');
check('an empty series draws nothing', _gcSpark_([], '#0891b2'), '');
check('two points do draw', _gcSpark_([{v:1},{v:2}], '#0891b2').indexOf('<svg') === 0, true);

// THE null fixture: a gap must BREAK the line, never be drawn as zero, and must never delete the
// value beside it. fill:false so the only path returned is the line, not the area wash.
const gapped = _gcSpark_([{v:10},{v:null},{v:30},{v:20},{v:null},{v:40}], '#0891b2', {fill:false});
check('a null breaks the line', paths(gapped)[0].split('M').length - 1, 1);
check('a null is never plotted as a zero', gapped.indexOf('NaN') < 0, true);
// An isolated value cannot be a line segment, but it must still be ON the chart — dropping it
// would silently delete a real measurement, which a sparkline has no axis to reveal.
const lonely = _gcSpark_([{v:10},{v:null},{v:30},{v:20}], '#0891b2', {fill:false});
check('an isolated value survives as a dot', marks(lonely).length >= 2, true);
// ...and the surrounding points keep their own positions, so the gap is not silently closed up.
check('gapped and ungapped are different drawings', lonely === _gcSpark_([{v:10},{v:30},{v:20}], '#0891b2', {fill:false}), false);

// A flat series is level, not on the floor.
const flat = _gcSpark_([{v:5},{v:5},{v:5}], '#0891b2', {fill:false});
const flatYs = [...paths(flat)[0].matchAll(/[ML](\d+\.?\d*) (\d+\.?\d*)/g)].map(m => +m[2]);
check('a flat series is drawn level', new Set(flatYs).size, 1);
check('...and centred, not pinned to the baseline', flatYs[0] > 5 && flatYs[0] < 33, true);
check('a flat series gets no peak halo', marks(flat).filter(c => c.indexOf('opacity=".32"') >= 0).length, 0);

// The peak halo lands on the peak.
const peaked = _gcSpark_([{v:1},{v:9},{v:2},{v:3}], '#0891b2');
const ring = marks(peaked).filter(c => c.indexOf('opacity=".32"') >= 0);
check('the peak gets exactly one halo', ring.length, 1);
const ringX = +(/x1="([\d.]+)"/.exec(ring[0])||[])[1];
check('the halo sits on the peak, not the last point', ringX > 50 && ringX < 60, true);
// When the peak IS the last point the end dot already marks it — no double mark.
check('no duplicate ring when the peak is last', circles(_gcSpark_([{v:1},{v:2},{v:9}], '#0891b2')).filter(c => c.indexOf('fill="none"') >= 0).length, 0);
check('fill:false suppresses the wash', _gcSpark_([{v:1},{v:5}], '#0891b2', {fill:false}).indexOf('opacity=".12"') < 0, true);

// ---- day of year ------------------------------------------------------------------------------
check('Jan 1 is day 1', _yoyDayOfYear_(2026,1,1), 1);
check('Dec 31 in a common year is 365', _yoyDayOfYear_(2025,12,31), 365);
check('Dec 31 in a leap year is 366', _yoyDayOfYear_(2024,12,31), 366);
check('Mar 1 shifts by one in a leap year', [_yoyDayOfYear_(2024,3,1), _yoyDayOfYear_(2025,3,1)], [61,60]);
check('Feb 29 exists in 2024', _yoyDayOfYear_(2024,2,29), 60);
check('a garbage month yields 0, never a wrong day', _yoyDayOfYear_(2026,0,5), 0);
check('leap rule handles the century case', [_yoyLeap_(1900), _yoyLeap_(2000), _yoyLeap_(2024)], [false,true,true]);
check('days in year', [_yoyDaysInYear_(2025), _yoyDaysInYear_(2024)], [365,366]);

// ---- the factor window ------------------------------------------------------------------------
// 164 scored months in a 200px sparkline is a texture, not a trend. The window is capped AND
// centred on the panel's month so the selected month is always on the chart.
const many = Array.from({length:164}, (_,i) => ({ ym:'m'+i }));
const w1 = _alFactorWindow_(many, 'm80');
check('the window is capped', w1.list.length, _AL_FACT_WIN);
check('the selected month is inside it', w1.list[w1.idx].ym, 'm80');
check('...and near the middle', Math.abs(w1.idx - _AL_FACT_WIN/2) <= 1, true);
const w2 = _alFactorWindow_(many, 'm2');
check('clamped at the start, still containing the month', [w2.list.length, w2.list[w2.idx].ym], [_AL_FACT_WIN,'m2']);
const w3 = _alFactorWindow_(many, 'm163');
check('clamped at the end, still containing the month', [w3.list.length, w3.list[w3.idx].ym], [_AL_FACT_WIN,'m163']);
const few = Array.from({length:9}, (_,i) => ({ ym:'s'+i }));
check('a short history is shown whole', _alFactorWindow_(few, 's3').list.length, 9);

// ---- personal-best progression ------------------------------------------------------------------
const q = (y,mo,v) => ({ t:new Date(y,mo-1,15), v:v });
const prog = _pbProg_([q(2025,1,10), q(2025,2,30), q(2025,8,20)], x => x.v, null);
check('progression spans every quarter between first and last', prog.length, 3);
check('...taking the best in each', prog.map(p => p.v), [30, null, 20]);
check('an empty quarter is null, NEVER zero', prog[1].v, null);
check('quarter labels are readable', prog.map(p => p.lab), ['Q1 2025','Q2 2025','Q3 2025']);
check('quarter keys are contiguous across a year boundary', _pbQKey_(new Date(2025,0,5)) - _pbQKey_(new Date(2024,11,5)), 1);
check('a metric with no qualifying ride yields nothing', _pbProg_([q(2025,1,10)], x => x.v, () => false), []);
// A zero is not an achievement, so it neither scores its quarter nor stretches the range backwards
// into quarters the athlete never registered anything in.
check('a zero does not open the range', _pbProg_([q(2025,1,0), q(2025,5,4)], x => x.v, null).map(p=>p.v), [4]);
check('a zero does not score its own quarter', _pbProg_([q(2025,1,0), q(2025,2,7)], x => x.v, null).map(p=>p.v), [7]);

// ---- _gcScale_: a scale, not a bar ---------------------------------------------------------------
// Three Trajectory readouts are single scalars (a prediction confidence, measured once, with no
// history). They must NOT be drawn as a filled pill — a fill reads as accumulation, which is
// exactly what a probability is not — and they must not be faked into a trend either.
const scale = _gcScale_(62, '#FC4C02', 'no chance', 'even', 'certain');
check('the scale places a marker at the value', scale.indexOf('left:62%') >= 0, true);
check('the scale never fills to the value', /width:\s*62%/.test(scale), false);
check('the scale is labelled at both ends and the middle', ['no chance','even','certain'].every(s => scale.indexOf(s) >= 0), true);
check('out-of-range values clamp rather than overflow', [_gcScale_(-40,'#fff').indexOf('left:0%')>=0, _gcScale_(180,'#fff').indexOf('left:100%')>=0], [true,true]);

// ---- _gcTrend_: the value+history block --------------------------------------------------------
check('a trend with no history renders nothing at all', _gcTrend_([{v:1}], '#0891b2'), '');
check('a real trend renders a chart', _gcTrend_([{v:1},{v:4},{v:3}], '#0891b2').indexOf('<svg') >= 0, true);

// ---- weekly rate series --------------------------------------------------------------------------
// The three Trajectory rate cards share this. A week with no denominator is a GAP: a week in which
// nothing was prescribed is not a week of 0% completion, and drawing it as one invents a collapse.
const wk = _gcWeekPts_([{presc:3,done:3},{presc:0,done:0},{presc:4,done:2}], w => w.presc>0?Math.round(w.done/w.presc*100):null);
check('weekly rates computed', wk.map(p => p.v), [100, null, 50]);
check('a week with no denominator is null, not zero', wk[1].v, null);
check('an empty weeks array yields an empty series', _gcWeekPts_([], () => 1), []);
check('a thrower in the picker degrades to null, not a crash',
  _gcWeekPts_([{}], () => { throw new Error('x'); }).map(p => p.v), [null]);

// ---- palette identity ---------------------------------------------------------------------------
// Not a taste check: these hexes were validated as sets (lightness band, chroma floor, all-pairs
// CVD separation, normal-vision floor, contrast) against the #0e1117 card surface. Changing one
// without re-running that check is the exact defect this replaced.
check('year palette is three distinct hues', new Set(_GC_YOY).size, 3);
check('factor palette is three distinct hues', new Set(_GC_FACTOR).size, 3);
check('the two chart palettes are not the same set', JSON.stringify(_GC_YOY) === JSON.stringify(_GC_FACTOR), false);
check('year palette is the validated set', _GC_YOY, ['#0891b2','#8b5cf6','#d97706']);
check('factor palette is the validated set', _GC_FACTOR, ['#ec4899','#3b82f6','#d97706']);

if (failed) { console.error(`${R}✗ growth charts: ${failed} check(s) failed${X}`); process.exit(1); }
console.log(`${G}✓ growth charts (sparkline, scale-not-bar, weekly gaps, day-of-year, factor window, PB progression, palettes)${X}`);
