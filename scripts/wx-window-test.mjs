// THE WEATHER CARD ANSWERS FOR THE ACTIVITY, NOT FOR SOME LARGER SPAN AROUND IT.
//
// Reported: "Creekside Park Run, 8AM start" showed "78F - peak temp" while the chart directly below
// it showed ~67F at 8AM. Reported as "the gauge shows the daily peak". It was worse than that, and
// the real cause was two lines up:
//
//   var durH = ride.duration ? parseInt(ride.duration.split(':')[0]) || 4 : 4;
//
// parseInt on the HOURS FIELD ALONE. A 42-minute run is "0:42:00", so that parsed to 0, fell through
// the ||4 fallback, and gave the run a FOUR-HOUR weather window. The 78F was noon. A 1:25 ride was
// wrong in the other direction, silently truncated to one hour of a ninety-minute ride.
//
// So there were two defects stacked: the window was wrong, AND the headline read the window's
// MAXIMUM when the card is titled with a specific start time. Both are fixed here, and the fix
// keeps a padded window for the CHART only - a 45-minute run drawn over 45 minutes is four points
// and cannot show you that it is about to warm up, which was the useful thing on the old screen.
//
// Run: node scripts/wx-window-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
function matchBrace(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

console.log('\n' + Y + '=== the duration parse that caused it ===' + X);
{
  const parseDurToMin = new Function(exFn('parseDurToMin') + 'return parseDurToMin;')();
  // The old expression, reproduced, so the regression is demonstrated rather than described.
  const oldDurH = (d) => (d ? (parseInt(String(d).split(':')[0]) || 4) : 4);
  eq('OLD: a 42-min run was given a 4-hour window', oldDurH('0:42:00'), 4);
  eq('OLD: a 1h25 ride was truncated to 1 hour', oldDurH('1:25:23'), 1);
  // The real helper, which already handled both shapes.
  ok('NEW: 0:42:00 parses to ~42 min', Math.abs(parseDurToMin('0:42:00') - 42) < 1);
  ok('NEW: 1:25:23 parses to ~85 min', Math.abs(parseDurToMin('1:25:23') - 85) < 1);
  ok('NEW: 2:10:00 parses to ~130 min', Math.abs(parseDurToMin('2:10:00') - 130) < 1);
  ok('the old hours-field parse is gone from the source',
     !/parseInt\(\(ride\.duration\|\|'4:00'\)\.split\(':'\)\[0\]\)/.test(src));
  ok('the helper is used instead', /parseDurToMin\(ride\.duration\)/.test(src));
  ok('an unknown duration still falls back to 4h, as before', /if\(!\(durMin>0\)\) durMin=240;/.test(src));
  ok('...and the window is clamped at both ends', /durMin=Math\.max\(15, Math\.min\(durMin, 12\*60\)\);/.test(src));
}

console.log('\n' + Y + '=== two windows: the activity, and a padded one for the chart ===' + X);
ok('the ride window ends at start + duration', /var iRide1=i0\+Math\.ceil\(durMin\/15\);/.test(src));
ok('the chart window is padded to at least three hours', /var iChart1=Math\.max\(iRide1, i0\+12\);/.test(src));
ok('slR slices the activity', /function slR\(arr\)\{return\(arr\|\|\[\]\)\.slice\(i0,iRide1\+1\);\}/.test(src));
ok('sl slices the padded window', /function sl\(arr\)\{return\(arr\|\|\[\]\)\.slice\(i0,iChart1\+1\);\}/.test(src));
ok('the time axis follows the chart window', /\(h\.time\|\|\[\]\)\.slice\(i0,iChart1\+1\)/.test(src));

console.log('\n' + Y + '=== every headline number comes from the ACTIVITY window ===' + X);
ok('temperature', /var maxTemp=rTemps\.length\?Math\.max\.apply\(null,rTemps\):75;/.test(src));
ok('precipitation', /var maxPrecip=rPrecip\.length\?Math\.max\.apply\(null,rPrecip\):0;/.test(src));
ok('gusts', /var maxGust=rGusts\.length\?Math\.max\.apply\(null,rGusts\)/.test(src));
ok('sustained wind', /Math\.round\(rWind\.length\?Math\.max\.apply\(null,rWind\):0\)/.test(src));
ok('wind direction', /var midDir=rDir\.length\?rDir\[Math\.floor\(rDir\.length\/2\)\]:null;/.test(src));
// NEG: none of them may read the padded chart series any more. Scoped to the GAUGE BLOCK - the
// chart's own axis bounds (suggestedMax) legitimately read the chart series, and a file-wide regex
// flags those plus unrelated functions elsewhere. A negative control has to be aimed at the thing
// it is controlling for, or it fails on correct code and gets "fixed" by weakening the real one.
const gauge = src.slice(src.indexOf("var gEl=document.getElementById('wx-gauges');"),
                        src.indexOf("var cEl=document.getElementById('wx-charts');"));
ok('NEG: the gauge block never reads the padded temps', !/Math\.max\.apply\(null,temps\)/.test(gauge));
ok('NEG: the gauge block never reads the padded gusts', !/Math\.max\.apply\(null,gusts\)/.test(gauge));
ok('NEG: the gauge block never reads the padded wind', !/Math\.max\.apply\(null,wind\)/.test(gauge));
ok('...and the chart axes still DO use the chart series, as they should',
   /suggestedMax:Math\.max\.apply\(null,temps\)\+3/.test(src) && /suggestedMax:Math\.max\.apply\(null,gusts\)\+3/.test(src));

console.log('\n' + Y + '=== the gauge answers for the start time ===' + X);
ok('the start sample is captured', /var startTemp=rTemps\.length\?rTemps\[0\]:null;/.test(src));
ok('the gauge condition uses it', /getCondition\('temp',\(startTemp!=null\?startTemp:maxTemp\)\)/.test(src));
ok('NEG: the gauge no longer judges on the window maximum', !/getCondition\('temp',maxTemp\)/.test(src));
ok('the tile prints the start value', /\(startTemp!=null\?Math\.round\(startTemp\):Math\.round\(maxTemp\)\)/.test(src));
ok('...labelled with the actual clock time', /'at '\+startLbl/.test(src));
ok('NEG: the bare "peak temp" label is gone', !/>peak temp</.test(src));
// The peak is still useful - it is shown as a climb, not as the headline, and only when real.
ok('the climb is shown as a secondary line', /&deg; by '\+peakLbl/.test(src));
ok('...suppressed under 3 degrees', /var tempClimbs=\(startTemp!=null && \(maxTemp-startTemp\)>=3\);/.test(src));
ok('rain is labelled as during the run', /max rain, during run/.test(src));

console.log('\n' + Y + '=== clock labels come from the sample index ===' + X);
{
  // Naming the peak by a guess would reintroduce the same class of error in a different field.
  ok('clockAt derives from s0 and the sample number', /var mins=s0\*60\+sampleIdx\*15/.test(src));
  ok('the peak label is the index of the max', /var peakLbl=clockAt\(Math\.max\(0, rTemps\.indexOf\(maxTemp\)\)\);/.test(src));
  // Reproduce it to confirm the arithmetic, since an off-by-one here mislabels every card.
  const clockAt = (s0, n) => { const m = s0*60 + n*15, h = Math.floor(m/60)%24, mn = m%60;
    return (h>12?h-12:(h===0?12:h)) + (mn?(':'+(mn<10?'0':'')+mn):'') + (h>=12?'PM':'AM'); };
  eq('8AM start, sample 0', clockAt(8, 0), '8AM');
  eq('8AM start, sample 3 (45 min in)', clockAt(8, 3), '8:45AM');
  eq('8AM start, sample 16 (4h in)', clockAt(8, 16), '12PM');
  eq('11AM start crossing noon', clockAt(11, 6), '12:30PM');
  eq('midnight reads 12AM, not 0AM', clockAt(0, 0), '12AM');
}

console.log('\n' + Y + '=== the inverse mistake is guarded too ===' + X);
// The chart now shows MORE than the activity. If that is not said, a reader takes the chart's right
// hand end for the end of the run - the same confusion, pointing the other way.
ok('the padding is detected', /var chartPadded=\(iChart1>iRide1\);/.test(src));
ok('...and the temperature chart names when the run ends', /chartPadded\?\(' · run ends '\+runEndLbl\):''/.test(src));

console.log('');
if (fails) { console.log(R + 'wx window: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'wx window: all checks passed' + X + '\n');
