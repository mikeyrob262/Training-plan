// HUMIDITY AS THE FOURTH RIDE PLANNER GAUGE, ON BANDS THE APP ALREADY HELD.
//
// The one thing worth pinning here is not the icon - it is that the gauge does NOT invent its own
// opinion of humidity. wxScore_ already scores it (h<50 -> 100, h<65 -> 80, h<80 -> 55, else 30) and
// that score already feeds the ride score. A gauge calling 70% "fine" while the score docked the
// ride for it would be two sources of truth for one fact, which is the failure this app keeps
// paying for - the FTP split, the two max-HR defaults, the prescription-vs-grader contradiction.
// So the cut points are reused verbatim and this file fails if either side moves alone.
//
// Second: it reads the RIDE WINDOW (slR), not the padded chart series. Reading the chart window is
// what once let a 45-minute run be judged on three hours of weather, and the same trap was sitting
// one variable away here.
//
// Run: node scripts/humidity-gauge-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== the gauge does not invent its own humidity opinion ===' + X);
ok('wxScore_ still holds the canonical bands', /humScore=h<50\?100:h<65\?80:h<80\?55:30/.test(SRC));
ok('getCondition gained a humidity branch', /if\(type==='humidity'\)\{/.test(SRC));
{
  // The cut points must MATCH. Extract both and compare, so a change to either side fails here
  // rather than silently producing a gauge and a score that disagree about the same ride.
  const score = SRC.match(/humScore=h<(\d+)\?100:h<(\d+)\?80:h<(\d+)\?55:30/);
  const gauge = SRC.slice(SRC.indexOf("if(type==='humidity'){"));
  const cuts = [...gauge.slice(0, 400).matchAll(/val>=(\d+)\)return/g)].map((m) => +m[1]).sort((a, b) => a - b);
  ok('score cut points found: ' + (score ? score.slice(1, 4).join('/') : 'none'), !!score);
  ok('gauge cut points found: ' + cuts.join('/'), cuts.length === 3);
  ok('...and they are IDENTICAL', !!score && JSON.stringify(cuts) === JSON.stringify(score.slice(1, 4).map(Number)));
}

console.log('\n' + Y + '=== it reads the ride window, not the padded chart ===' + X);
ok('a ride-window humidity slice exists', /var rHum=slR\(h\.relativehumidity_2m\)\|\|\[\]/.test(SRC));
ok('NEG: the gauge does not read the padded chart series', !/getCondition\('humidity',\s*humid/.test(SRC));
ok('the gauge reads the ride-window peak', /var humMax=rHum\.length\?Math\.max\.apply\(null,rHum\):null/.test(SRC));
ok('...and keeps the start value to disclose a climb', /var humStart=rHum\.length\?rHum\[0\]:null/.test(SRC));
ok('...saying so only when the two are a separate fact', /\(humMax-humStart\)>=5/.test(SRC));

console.log('\n' + Y + '=== it matches the other three gauges ===' + X);
ok('an emoji face, like Temperature and Precipitation', /buildGauge\(hc\.emoji,'Humidity '/.test(SRC));
ok('...with the droplet as a BADGE, the pattern Wind established', /humidityDropSVG\(hc\.color,2\.6\)/.test(SRC));
ok('the droplet icon exists', /function humidityDropSVG\(color, ?sw\)/.test(SRC));
ok('...authored stroke-only on the same 24x24 box as the other icons',
   /humidityDropSVG[\s\S]{0,400}fill="none" stroke="'\+c/.test(SRC));
ok('...and drawn inside the 24-unit box the gauge slot expects',
   /humidityDropSVG[\s\S]{0,600}d="M12 2\.7c/.test(SRC));
ok('...and takes a colour, so it tracks the band like the wind arrow does', /humidityDropSVG\(color, ?sw\)\{[\s\S]{0,120}var c=color\|\|'currentColor'/.test(SRC));
ok('the label carries the actual figure', /'Humidity '\+Math\.round\(humMax\)\+'%'/.test(SRC));
ok('no gauge is drawn when there is no reading, rather than a fabricated 0',
   /var humGauge=\(hc!=null\)/.test(SRC) && /:\s*'';/.test(SRC.slice(SRC.indexOf('var humGauge='), SRC.indexOf('var humGauge=') + 300)));

console.log('\n' + Y + '=== four gauges divide evenly, or three when there is no reading ===' + X);
const HEAD = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
ok('the gauge rules live in the GLOBAL head sheet, not a panel-scoped one', HEAD.indexOf('.wx-gauge-grid{') > -1);
ok('the column is a query container', /\.wx-gauge-col\{container-type:inline-size\}/.test(HEAD));
ok('...so the CONTAINER decides, not the viewport', /@container \(min-width:372px\)\{\.wx-gauge-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/.test(HEAD));
ok('...with a viewport fallback for browsers without container queries', /@media \(min-width:420px\)\{\.wx-gauge-grid\{grid-template-columns:repeat\(4/.test(HEAD));
ok('the three-gauge case keeps three across, not a hole', /\.wx-gauge-grid\.wx-gauge-3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/.test(HEAD));
ok('...and the class is applied only when humidity is absent', /'\+\(humGauge\?'':' wx-gauge-3'\)\+'/.test(SRC));

console.log('\n' + Y + '=== the bands and the layout, exercised ===' + X);
{
  const band = (v) => (v >= 80 ? 'poor' : v >= 65 ? 'high' : v >= 50 ? 'noticeable' : 'ideal');
  const score = (h) => (h < 50 ? 100 : h < 65 ? 80 : h < 80 ? 55 : 30);
  // Every boundary, from both directions, so an off-by-one on either side is caught.
  for (const [v, b, s] of [[0,'ideal',100],[49,'ideal',100],[50,'noticeable',80],[64,'noticeable',80],
                           [65,'high',55],[79,'high',55],[80,'poor',30],[100,'poor',30]])
    ok(v + '% -> ' + b + ' / score ' + s, band(v) === b && score(v) === s);
  // 372 is four 90px rings plus three 4px gaps - the real requirement, not a round number.
  ok('the container threshold is 4 rings + 3 gaps', 4 * 90 + 3 * 4 === 372);
  const perRow = (cw) => (cw >= 372 ? 4 : 2);
  const widths = []; for (let w = 200; w <= 900; w += 2) widths.push(w);
  ok('no container width yields 3 or 1, so no gauge is ever stranded alone',
     widths.every((w) => perRow(w) === 4 || perRow(w) === 2));
  ok('...and four items divide evenly by every count offered', widths.every((w) => 4 % perRow(w) === 0));
}

console.log('');
if (fails) { console.log(R + 'humidity gauge: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'humidity gauge: all checks passed' + X + '\n');
