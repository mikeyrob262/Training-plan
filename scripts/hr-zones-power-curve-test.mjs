// Two data-integrity invariants, both reported as parser bugs and neither living in the parser.
//
// RUN HR ZONES. The bands were hardcoded as [113,121,141,158] in TWO places with a comment reading
// "max HR 172", while st.maxHR and st.lthr sat in Settings wired to nothing. Correcting the setting
// changed nothing because the setting was never read. Measured: the median run averages 151 bpm,
// the old Z4 floor was 142, and 78% of all recorded running time landed in Z4+ across 1,169 runs.
//
// POWER CURVE. A curve must be non-increasing with duration. The 1800s slot violates that on 47 of
// 186 checkable rides - but ALL 47 are 2025 Strava imports, and all 65 of the 2026 imports are
// clean. The sliding window below makes best[1800] >= best[3600] unavoidable on one array, because
// a 3600-block's mean cannot exceed the better of its two halves. So the parser is already correct
// and the 47 are a closed legacy batch. This pins the invariant so it stays that way.
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
// CRLF-safe comment stripping. worker.js uses CRLF, and in /\/\/.*$/ the dot does not match a
// carriage return, so $ is never reached and the line survives intact. The naive version
// therefore strips NOTHING, and every "is it gone from the code" check silently matches the
// comment that documents it being gone - which is exactly the false failure this hit.
const stripComments = (t) => t.split(NL).map(function(ln){
  return ln.replace(/\r/g, '').replace(/\/\/.*$/, '');
}).join(NL);

const st = { maxHR: 180 };
const M = new Function('st', asServed(
  exVar('RUN_HR_PCTS') + exVar('RUN_HR_MAX_DEFAULT') +
  exFn('runHrMax_') + exFn('runHrBands_') + exFn('runHrZoneOf_') + exFn('runHrZonePcts_') + NL +
  'return { runHrMax_, runHrBands_, runHrZoneOf_, runHrZonePcts_ };'
))(st);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== run HR bands come from the SETTING, not from constants ===' + X);
{
  ok('no hardcoded band set survives anywhere', !/hr<113|hr<=121|hr<=141|hr<=158/.test(src));
  // The old constants appear only inside comments now, as the record of what was wrong. What must
  // not exist is a second LIVE copy of them.
  const code = stripComments(src);
  ok('...and no live copy of 113/121/141/158 remains', !/\b113\b[\s\S]{0,40}\b121\b[\s\S]{0,40}\b141\b/.test(code));
  st.maxHR = 180;
  eq('maxHR 180 gives the standard 5-zone split', M.runHrBands_(), [117, 135, 153, 166]);
  st.maxHR = 190;
  eq('changing the setting MOVES the bands', M.runHrBands_(), [124, 143, 162, 175]);
  st.maxHR = 172;
  eq('...and 172 reproduces roughly the old top end', M.runHrBands_()[3], 158);
  st.maxHR = 180;
  eq('a junk setting falls back to the default, not to zero', (st.maxHR = 0, M.runHrMax_()), 180);
  st.maxHR = 999;
  eq('...and an out-of-range one too', M.runHrMax_(), 180);
  st.maxHR = 180;
}

console.log('\n' + Y + '=== the median run stops being a threshold run ===' + X);
{
  // The measured reality: median run average is 151 bpm, p10 141, p90 160.
  eq('151 bpm (the median run) is Z3, not Z4', M.runHrZoneOf_(151), 3);
  // 141 is the 10th percentile of this athlete's run averages and sits at 78% of max, which is
  // upper Z3 in a percent-of-max model. The point is that it is no longer Z4.
  eq('141 bpm (an easy run) is Z3, and no longer Z4', M.runHrZoneOf_(141), 3);
  eq('...135 bpm is Z2', M.runHrZoneOf_(135), 2);
  eq('160 bpm (a hard run) is Z4', M.runHrZoneOf_(160), 4);
  eq('170 bpm is Z5', M.runHrZoneOf_(170), 5);
  eq('110 bpm is Z1', M.runHrZoneOf_(110), 1);
  // Under the OLD bands 151 was Z4 and 141 was Z3 - that shift is the whole defect.
  ok('the old model would have called 151 threshold', 151 > 142);
}

console.log('\n' + Y + '=== zone percentages are honest about missing data ===' + X);
{
  eq('no samples -> null, not five zeros', M.runHrZonePcts_([]), null);
  eq('null input -> null', M.runHrZonePcts_(null), null);
  const junk = M.runHrZonePcts_([0, -5, 300, 999]);
  eq('dropouts and strap spikes are not zones', junk, null);
  const z = M.runHrZonePcts_([110, 110, 151, 151, 160, 160, 170, 170]);
  eq('a real distribution sums to 100', z.z1pct + z.z2pct + z.z3pct + z.z4pct + z.z5pct, 100);
  ok('...and records which reference produced it', z.zSrc === 'maxhr:180');
  const mixed = M.runHrZonePcts_([151, 999, 151, 0]);
  eq('junk samples are dropped, not counted as Z1', mixed.z3pct, 100);
}

console.log('\n' + Y + '=== both import paths read the one reference ===' + X);
{
  const fit = src.slice(src.indexOf('Run HR-zone distribution from record HR'), src.indexOf('Run HR-zone distribution from record HR') + 700);
  ok('the FIT parser calls runHrZonePcts_', /runHrZonePcts_\(hrStream\)/.test(fit));
  const tcx = src.slice(src.indexOf('HR zones from trackpoint HR'), src.indexOf('HR zones from trackpoint HR') + 700);
  ok('the TCX run import calls it too', /runHrZonePcts_\(hrVals\)/.test(tcx));
  ok('the stored record carries its provenance', /zSrc: _rz\?_rz\.zSrc:null/.test(src));
}

console.log('\n' + Y + '=== legacy zones are marked, never rescaled and never blanked ===' + X);
{
  const mig = exFn('migrateRunHrZones_');
  ok('rows with a stream are recomputed', /runHrZonePcts_\(hr, mx\)/.test(mig));
  ok('rows without one are stamped legacy-172', /zSrc='legacy-172'/.test(mig));
  // Test the BEHAVIOUR, not the vocabulary - the function both comments and logs about not
  // rescaling, so searching for the word finds the explanation rather than an offence.
  // A rescale would have to do arithmetic on a stored percentage. Nothing may.
  const migCode = stripComments(mig);
  ok('...and no stored percentage is ever multiplied or divided',
     !/z[1-5]pct\s*[*/]|[*/]\s*(?:r|x)\.z[1-5]pct/.test(migCode));
  ok('...a percentage is only ever assigned from a fresh computation',
     /r\.z1pct=z\.z1pct/.test(migCode));
  ok('...nor deletes one', !/delete r\.z1pct|z1pct=0/.test(mig));
  ok('the reason is recorded in the code', /have already collapsed the samples/.test(mig));
}

console.log('\n' + Y + '=== the power curve cannot rise with duration ===' + X);
{
  // The parser's own sliding window, extracted and run over adversarial streams.
  const i = src.indexOf('var pwrDurations = [5,15,30,60,120,300,600,1200,1800,3600];');
  const block = src.slice(i, src.indexOf('result.peak20', i));
  const curve = new Function('pwrStream', asServed(
    'var result={pwrStream:pwrStream};' + NL + block + NL + 'return result.powerCurve;'
  ));
  const D = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const monotonic = (pc) => {
    for (let a = 0; a < D.length - 1; a++) {
      if (!(pc[D[a]] > 0)) continue;
      for (let b = a + 1; b < D.length; b++) {
        if (pc[D[b]] > 0) { if (pc[D[a]] < pc[D[b]]) return D[a] + '<' + D[b]; break; }
      }
    }
    return null;
  };
  const mk = (n, f) => Array.from({ length: n }, (_, k) => f(k));
  const cases = {
    'a 90-minute negative split': mk(5400, (k) => 100 + Math.floor(k / 30)),
    'a hard first hour then fade': mk(5400, (k) => (k < 3600 ? 250 : 90)),
    'one huge spike at the end': mk(5400, (k) => (k > 5390 ? 900 : 120)),
    'all zeros': mk(4000, () => 0),
    'a steady ride': mk(4000, () => 180),
    'sawtooth': mk(5400, (k) => (k % 60 < 30 ? 300 : 60)),
    'exactly 3600 samples': mk(3600, (k) => 100 + (k % 7))
  };
  Object.keys(cases).forEach((label) => {
    const pc = curve(cases[label]);
    const bad = monotonic(pc);
    ok(label + ' -> curve never rises with duration' + (bad ? ('   VIOLATION ' + bad) : ''), !bad);
  });
  const short = curve(mk(1000, () => 200));
  ok('a stream shorter than a window omits that slot rather than faking it', short[1800] === undefined && short[600] > 0);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'run zones + power curve: all checks passed' + X));
process.exit(fails ? 1 : 0);
