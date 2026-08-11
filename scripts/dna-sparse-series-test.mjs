// The DNA trait sparklines read as suspiciously smooth near-straight diagonals, and the question
// was whether the underlying yearly ratios really are that stable or whether the CHART was
// manufacturing the smoothness. It was the chart, in two independent ways:
//
//   1. A missing year was not a null, it was ABSENT. Each per-year series was built by mapping over
//      the years that happened to carry a reading, so a year with no power-curve ride / no new
//      segment / too few cadence runs never entered the array. _gcSpark_ spaces points by array
//      INDEX, so an absent year did not open a gap - it closed one up.
//   2. Only the LAST point and the PEAK were marked. Four annual readings joined corner to corner
//      with no dots read as one continuous line rather than as four measurements.
//
// Together those turn sparse, gappy annual data into a clean diagonal. Neither is smoothing in the
// bezier sense - _gcSpark_ only ever emits straight M/L segments - which is why this needed
// measuring rather than assuming.
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

const M = new Function(asServed(
  exVar('_GC_SPARSE_MAX') + exFn('_gcSpark_') + exFn('_dnaYearFill_') +
  ';return { _gcSpark_, _dnaYearFill_, _GC_SPARSE_MAX };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log('  ' + (cond ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label); };
const eq = (label, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); if (!good) fails++; console.log('  ' + (good ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label + (good ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
// Every continuous run goes into ONE d attribute separated by spaces (M..L.. M..L..), so counting
// <path> elements always returns 1. The number of RUNS is the number of M commands.
const segs = (svg) => (svg.match(/ d="([^"]*)"/g) || []).join(' ').split('M').length - 1;
// A marker is a zero-length round-capped segment, not a <circle> - a circle would be drawn as an
// ellipse under preserveAspectRatio="none". Count those, and assert they are genuinely round.
const dots = (svg) => (svg.match(/<line[^>]*stroke-linecap="round"/g) || []).length;

console.log('\n' + Y + '=== a year with no reading is a GAP, not a closed-up axis ===' + X);
{
  // The real shape: readings in 2019 and 2020, nothing in 2021-2022, readings again in 2023-2024.
  const raw = [{ v: 0.9, lab: '2019' }, { v: 1.0, lab: '2020' }, { v: 1.2, lab: '2023' }, { v: 1.3, lab: '2024' }];
  const filled = M._dnaYearFill_(raw);
  eq('the year axis is contiguous 2019..2024', filled.map((p) => p.lab), ['2019', '2020', '2021', '2022', '2023', '2024']);
  eq('...with the two missing years null, not interpolated', filled.map((p) => p.v), [0.9, 1.0, null, null, 1.2, 1.3]);
  ok('every real value is preserved exactly', filled.filter((p) => p.v != null).map((p) => p.v).join() === '0.9,1,1.2,1.3');
  // The visible consequence: the line BREAKS instead of running straight through the empty years.
  eq('the drawn line breaks into two runs', segs(M._gcSpark_(filled, '#fff', { fill: false })), 2);
  eq('...where the un-filled series drew one unbroken line', segs(M._gcSpark_(raw, '#fff', { fill: false })), 1);
}
{
  // Guards on the filler itself: it must not invent an axis it cannot justify.
  eq('a single reading is left alone', M._dnaYearFill_([{ v: 1, lab: '2020' }]).length, 1);
  eq('an empty series stays empty', M._dnaYearFill_([]).length, 0);
  eq('non-year labels are passed through untouched', M._dnaYearFill_([{ v: 1, lab: 'wk 1' }, { v: 2, lab: 'wk 2' }]).length, 2);
  ok('an absurd span is refused rather than filled', M._dnaYearFill_([{ v: 1, lab: '1900' }, { v: 2, lab: '2026' }]).length === 2);
  eq('already-contiguous years are unchanged', M._dnaYearFill_([{ v: 1, lab: '2023' }, { v: 2, lab: '2024' }]).map((p) => p.lab), ['2023', '2024']);
}

console.log('\n' + Y + '=== sparse readings are drawn as readings, not as a line ===' + X);
{
  const four = [{ v: 0.9, lab: '2021' }, { v: 1.0, lab: '2022' }, { v: 1.1, lab: '2023' }, { v: 1.2, lab: '2024' }];
  const svg = M._gcSpark_(four, '#fff', { fill: false });
  // 4 readings marked; the last point and the peak coincide here on a rising series.
  ok('all four readings carry a mark (' + dots(svg) + ' circles)', dots(svg) >= 4);
  ok('the marks are round at any stretch, not ellipses', /stroke-width="3.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/.test(svg));
  ok('...and no <circle> marker survives, which would distort', !/<circle/.test(svg));
  ok('markPoints:false still opts out', dots(M._gcSpark_(four, '#fff', { fill: false, markPoints: false })) < 4);
}
{
  // A dense series must NOT get 90 dots - there the line is the shape and dots would be noise.
  const dense = Array.from({ length: 90 }, (_, i) => ({ v: 50 + Math.sin(i / 6) * 8, lab: 'd' + i }));
  ok('a 90-point series is left as a line', dots(M._gcSpark_(dense, '#fff', { fill: false })) <= 2);
  ok('the sparse threshold is a named constant', typeof M._GC_SPARSE_MAX === 'number');
  const atLimit = Array.from({ length: M._GC_SPARSE_MAX }, (_, i) => ({ v: i, lab: 'y' + i }));
  ok('a series at exactly the threshold is still marked', dots(M._gcSpark_(atLimit, '#fff', { fill: false })) >= M._GC_SPARSE_MAX);
}
{
  // Nothing here may smooth. _gcSpark_ emits straight M/L segments only - no bezier command should
  // ever appear, or the chart would be inventing intermediate values between annual readings.
  const svg = M._gcSpark_([{ v: 1, lab: '2021' }, { v: 9, lab: '2022' }, { v: 2, lab: '2023' }], '#fff', { fill: false });
  ok('no bezier/quadratic curve commands in the path', !/[CcSsQqTtAa]\d/.test(svg.replace(/<[^>]*>/g, (m) => (/ d="/.test(m) ? m : ''))));
  ok('real variance is preserved, not flattened', / d="M[^"]*L[^"]*L[^"]*"/.test(svg));
}

console.log('\n' + Y + '=== the three DNA per-year series all route through the filler ===' + X);
{
  // Power-curve ratios, run cadence and Explorer each built their own year array by hand.
  const body = src.slice(src.indexOf('function _dnaPowerAxes_'), src.indexOf('function aiRenderDNA_'));
  ok('power-curve ratio series is gap-filled', /series:_dnaYearFill_\(yKeys\.map/.test(body));
  ok('run cadence series is gap-filled', /var sp=_dnaYearFill_\(yrs\.map/.test(body));
  ok('Explorer series is gap-filled', /var sp2=_dnaYearFill_\(ys\.map/.test(body));
}

console.log('\n' + Y + '=== the Signature keeps its six months instead of averaging them away ===' + X);
{
  // _dnaSignature_ read six scored months, took the mean, and drew ONE flat bar under a heading
  // that said 'last 6 scored months'. Same fabrication as the trait sparklines: an aggregate
  // presented as if it were the whole story. The months are individually meaningful, so they are
  // carried out on the axis and drawn as points.
  const sig = src.slice(src.indexOf('function _dnaSignature_'), src.indexOf('function aiRenderDNA_'));
  ok('the per-month series is carried out of _dnaSignature_', /series:ser/.test(sig));
  ok('...built from the recent rows, oldest-first', /\.sort\(function\(a,b\)\{ return a\.lab<b\.lab\?-1:1; \}\)/.test(sig));
  ok('...and the mean is still reported as the headline', /z:mean/.test(sig));
  const dnaTab = src.slice(src.indexOf('function aiRenderDNA_'), src.indexOf('function aiRenderDNA_') + 14000);
  ok('the Signature draws the months as a line', /_gcTrend_\(ax\.series/.test(dnaTab));
  ok('...falling back to a bar ONLY when there is a single reading', /ax\.series\.length>1/.test(dnaTab));
}

console.log('\n' + Y + '=== the Era timeline width means duration ===' + X);
{
  // flex:1 0 auto gave every era the same width, so a 14-year era read as equal to a 2-year one
  // on a chart where width is the one thing a reader takes as duration.
  const dnaTab = src.slice(src.indexOf('function aiRenderDNA_'), src.indexOf('function aiRenderDNA_') + 14000);
  ok('era width is proportional to its span', /flex:'\+_yrs\+' 1 0/.test(dnaTab));
  ok('...no era is still hardcoded to equal width', !/flex:1 0 auto;min-width:150px/.test(dnaTab));
  ok('...with a min-width so a short era stays legible', /min-width:150px/.test(dnaTab));
  ok('...and the span is stated in words, not left to be inferred', /year'\+\(_yrs===1/.test(dnaTab));
}
console.log('\n' + Y + '=== the Trends range control drives the whole tab, not one card ===' + X);
{
  // The range control shipped governing exactly ONE card - the consistency heatmap - while the
  // story, the drivers and the PMC chart stayed on hardcoded windows and the labels stayed on
  // literal 90s. That is worse than having no control, because the control asserts it did
  // something. These assertions are what makes 'wired' checkable instead of claimed.
  const tr = src.slice(src.indexOf('function aiRenderTrends_'), src.indexOf('function aiRenderTrends_') + 26000);
  ok('the window is resolved once, at the top', /var _trD=_trDays_\(\), _trW=_trWords_\(\)/.test(tr));
  ok('the story takes the window', /_trStory_\(_trDays_\(\)\)/.test(tr));
  ok('the drivers take the window', /_trDrivers_\(_trD\)/.test(tr));
  ok('the consistency cells take the window', /dsConsistency_\(rides,_trD,/.test(tr));
  ok('the heatmap takes the window', /_consHeatHTML_\(rides, _trD\)/.test(tr));
  ok('the PMC chart slices to the window', /series\.slice\(-\(_trD\+1\)\)/.test(tr));
  // No literal window may survive in the rendered copy - a label saying 90 under a 7D selection is
  // the exact bug this is guarding.
  ok('no hardcoded 90-day label survives', !/90 days|Last 90 Days/.test(tr));
  ok('no hardcoded 60-vs-60 label survives', !/60 vs prior 60/.test(tr));

  const story = exFn('_trStory_'), drivers = exFn('_trDrivers_');
  ok('_trStory_ is parameterised, not reading the range itself', /function _trStory_\(days\)/.test(story));
  ok('...and clamps to the series it actually has', /Math\.min\(_w, s\.length-1\)/.test(story));
  ok('...reporting the span it really used', /span:_span/.test(story));
  ok('_trDrivers_ is parameterised too', /function _trDrivers_\(days\)/.test(drivers));
  ok('...comparing the window against the one before it', /now\.getDate\(\)-2\*_w/.test(drivers));
}
console.log('\n' + Y + '=== the power-curve radar is on the tab Overview links to ===' + X);
{
  const dnaTab = src.slice(src.indexOf('function aiRenderDNA_'), src.indexOf('function aiRenderDNA_') + 12000);
  ok('DNA Insights renders the radar', /_dnaRadarHTML_/.test(dnaTab));
  ok('...through _aiSafe_ like every other section', /_aiSafe_\('DNAradar'/.test(dnaTab));
  ok('...and prints no heading when the radar returns empty', /if\(!_rad\) return;/.test(dnaTab));
  // It is the SAME component Overview uses, not a reimplementation.
  const calls = (src.match(/_dnaRadarHTML_\(\)/g) || []).length;
  ok('_dnaRadarHTML_ is called from 3 surfaces, defined once (' + calls + ' calls)', calls >= 3);
  eq('defined exactly once', (src.match(/function _dnaRadarHTML_\(/g) || []).length, 1);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'DNA sparse series: all checks passed' + X));
process.exit(fails ? 1 : 0);
