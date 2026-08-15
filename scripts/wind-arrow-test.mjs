// The wind arrow must point where the wind is GOING, and every arrow on the screen must agree.
//
// Open-Meteo's winddirection_10m is the direction the wind blows FROM. A rider reading a route for
// headwind vs tailwind wants the opposite, so the glyph is rotated by bearing+180. Get the sign
// wrong and the card is not merely ugly — it confidently tells you to expect a tailwind on the leg
// that will be into the wind.
//
// This file does NOT just grep for "+180". It extracts windArrowSVG, applies the rotation it emits
// to the arrow's tip, and asserts the tip lands in the correct compass quadrant on screen. A sign
// flip, a swapped rotation centre, or a switch to counter-clockwise all fail here.
//
// It also locks the two things that made this card wrong before:
//   - the ride-detail map pins used the RAW bearing while the gauge used bearing+180, so two
//     arrows on one screen pointed opposite ways
//   - midDir fell back to 270, so a forecast with no direction rendered a confident "W"
//
// Run: node scripts/wind-arrow-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

// Pull a function out of the served source by brace matching, so the test runs the REAL code
// rather than a copy that can drift away from it.
function extract(name){
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('cannot find ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++){
    if (src[j] === '{') depth++;
    else if (src[j] === '}'){ depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

const windArrowSVG = new Function(extract('windArrowSVG') + '; return windArrowSVG;')();
const buildGauge   = new Function(extract('buildGauge')   + '; return buildGauge;')();
const getDirStr    = new Function(extract('getDirStr')    + '; return getDirStr;')();

function rotationOf(markup){
  const m = markup.match(/rotate\(([-\d.]+) 12 12\)/);
  return m ? parseFloat(m[1]) : null;
}
// SVG rotate() is CLOCKWISE because y grows downward. The arrow is an up-arrow at rest, so its tip
// starts at (12,4) — due north on screen. Apply the emitted rotation and see where the tip lands.
function tipAfter(fromDeg){
  const a = rotationOf(windArrowSVG(fromDeg, '#000')) * Math.PI / 180;
  const dx = 0, dy = -8;                                   // tip relative to the (12,12) centre
  return { x: +(12 + dx*Math.cos(a) - dy*Math.sin(a)).toFixed(3),
           y: +(12 + dx*Math.sin(a) + dy*Math.cos(a)).toFixed(3) };
}
// Screen quadrant of the tip, in compass terms: up is N, right is E.
function pointsTo(fromDeg){
  const t = tipAfter(fromDeg), ex = t.x - 12, ey = t.y - 12, eps = 0.01;
  const ns = ey < -eps ? 'N' : ey > eps ? 'S' : '';
  const ew = ex >  eps ? 'E' : ex < -eps ? 'W' : '';
  return ns + ew;
}

console.log('\n' + Y + '=== the arrow points where the wind is BLOWING TOWARD ===' + X);
// A north wind blows to the south. This is the assertion the whole feature rests on.
check('wind FROM N points S', pointsTo(0), 'S');
check('wind FROM S points N', pointsTo(180), 'N');
// A westerly blows to the east. Gets the clockwise/counter-clockwise question wrong on its own.
check('wind FROM W points E', pointsTo(270), 'E');
check('wind FROM E points W', pointsTo(90), 'W');
check('wind FROM NW points SE', pointsTo(315), 'SE');
check('wind FROM SE points NW', pointsTo(135), 'NW');

console.log('\n' + Y + '=== the rotation is the documented formula, and it wraps ===' + X);
check('bearing+180, mod 360', [0,90,180,270,359].map(rotationOf === null ? null : (d)=>rotationOf(windArrowSVG(d,'#000'))), [180,270,0,90,179]);
// A bearing of 200 must not emit 380: some renderers accept it, but it hides a missing modulo that
// bites the moment anything reads the number back.
check('never emits an angle at or above 360', [181,270,350,359].every((d)=>rotationOf(windArrowSVG(d,'#000')) < 360), true);
check('rotation centre is the icon centre, not the origin', /rotate\([-\d.]+ 12 12\)/.test(windArrowSVG(45,'#000')), true);

console.log('\n' + Y + '=== the glyph is a stroked SVG, not an emoji ===' + X);
const mk = windArrowSVG(45, '#185FA5');
check('drawn with line + polyline', /<line /.test(mk) && /<polyline /.test(mk), true);
check('honours the colour it is given', mk.indexOf('#185FA5') > -1, true);
check('no fill leaking over the stroke', /fill="none"/.test(mk), true);
check('authored on the shared 24x24 box', /points="6 10 12 4 18 10"/.test(mk), true);

console.log('\n' + Y + '=== one builder, so no two arrows disagree ===' + X);
// The map pins used to rotate a raw-bearing triangle inline. That is the exact contradiction.
check('no inline raw-bearing rotate survives', /transform:rotate\('\+deg\+'deg\)/.test(src), false);
check('the old triangle path is gone', /M12 2l6 18-6-4-6 4z/.test(src), false);
const callers = (src.match(/windArrowSVG\(/g) || []).length;
check('one definition, two call sites', callers, 3);   // definition + gauge + map pin

console.log('\n' + Y + '=== the gauge face accepts markup without breaking emoji ===' + X);
const g = buildGauge(windArrowSVG(0, '#1D9E75'), 'Wind', 0.4, '#1D9E75', 'blowing toward S');
check('markup is centred with a translate', /translate\(33 33\)/.test(g), true);
check('...and is NOT wrapped in a text node', /<text[^>]*><g /.test(g), false);
check('the sub-label renders', g.indexOf('blowing toward S') > -1, true);
const e = buildGauge('\u{1F60A}', 'Temperature', 0.5, '#1D9E75');
check('an emoji still renders as a text node', /<text x="45" y="54" text-anchor="middle" font-size="28">/.test(e), true);
check('...and adds no sub-label when none is given', /margin-top:-2px/.test(e), false);

console.log('\n' + Y + '=== the arrow BADGES the face, it does not replace it ===' + X);
// The regression this section exists for: the arrow was swapped IN for the emoji whenever a bearing
// existed, so Wind became the only gauge with no condition face. Both must be present at once.
{
  const both = buildGauge('\u{1F60A}', 'Wind', 0.45, '#1D9E75', 'blowing toward NE', windArrowSVG(225, '#1D9E75', 3));
  check('the emoji face is still there', /<text x="45" y="54" text-anchor="middle" font-size="28">/.test(both), true);
  check('...and the arrow is there too', both.indexOf('<polyline points="6 10 12 4 18 10"/>') > -1, true);
  check('...rotated to the blowing-toward bearing', /rotate\(45\.0 12 12\)/.test(both), true);
  check('the badge sits on its own circle', /<circle cx="68" cy="24" r="13"/.test(both), true);
  check('...scaled down rather than redrawn at another size', /translate\(59 15\) scale\(0\.75\)/.test(both), true);
  check('...and layered AFTER the face, so it is drawn on top', both.indexOf('font-size="28"') < both.indexOf('cx="68"'), true);
  // Same call with no badge must be byte-identical to the old two-gauge behaviour.
  const plain = buildGauge('\u{1F60A}', 'Wind', 0.45, '#1D9E75', 'blowing toward NE');
  check('NEG: no badge markup when none is passed', /cx="68"/.test(plain), false);
  check('...and the other gauges are untouched by the new parameter',
        buildGauge('\u{1F326}', 'Precipitation', 0.3, '#378ADD').indexOf('cx="68"') < 0, true);
  // An emoji badge must work too - nothing about the slot assumes markup.
  const emojiBadge = buildGauge('\u{1F60A}', 'Wind', 0.45, '#1D9E75', '', '\u{1F4A8}');
  check('an emoji badge renders as text, not raw markup', /<text x="68" y="29"/.test(emojiBadge), true);
}
console.log('\n' + Y + '=== the call site passes it as a badge, not as the face ===' + X);
check('the face is the condition emoji again', /buildGauge\(wc\.emoji,'Wind',wc\.pct,wc\.color,windSub,windBadge\)/.test(src), true);
check('...and the arrow goes to the badge slot', /var windBadge=\(midDir!=null\)\?windArrowSVG\(midDir,wc\.color,3\):''/.test(src), true);
// NEG: the swap that caused the regression must not come back.
check('NEG: the arrow no longer replaces the emoji', /windArrowSVG\(midDir,wc\.color,2\.6\):wc\.emoji/.test(src), false);
check('the badge is still gated on a real bearing', /\(midDir!=null\)\?windArrowSVG/.test(src), true);

console.log('\n' + Y + '=== a missing bearing is omitted, never invented ===' + X);
// The 270 default was indistinguishable from a real due-west reading.
check('midDir no longer defaults to 270', /windDir\.length\?windDir\[Math\.floor\(windDir\.length\/2\)\]:270/.test(src), false);
check('...it is null when absent', /windDir\.length\?windDir\[Math\.floor\(windDir\.length\/2\)\]:null/.test(src), true);
check('getDirStr returns empty for null', getDirStr(null), '');
check('...and for a non-finite value', getDirStr(NaN), '');
check('...but still labels a real bearing', [0,45,90,135,180,225,270,315].map(getDirStr), ['N','NE','E','SE','S','SW','W','NW']);
// The three places that print the cardinal must all tolerate the empty string.
check('gust tile guards the label', /max gust'\+\(dirLbl\?\(' '\+dirLbl\):''\)/.test(src), true);
check('wind chart note guards the label', /'mph'\+\(dirLbl\?\(' '\+dirLbl\):''\)/.test(src), true);
check('the gauge shows no arrow at all without a bearing', /var windBadge=\(midDir!=null\)\?windArrowSVG\(midDir,wc\.color,3\):''/.test(src), true);

console.log('');
if (fails) { console.log(R + 'wind arrow: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'wind arrow: all checks passed' + X + '\n');
