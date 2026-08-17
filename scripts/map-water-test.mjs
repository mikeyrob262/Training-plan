// NAIP HAS NO PHOTO OVER OPEN WATER, SO SOMETHING HAS TO BE UNDERNEATH IT.
//
// Lake Michigan rendered as a flat grey polygon on lakefront routes. Not a loading failure and not
// this app's bug: USGS NAIP is farmland/land aerial photography that was never flown over open water,
// so the tile comes back 200 OK and FULLY TRANSPARENT - measured rgba(0,0,0,0) across all 65,536
// pixels of z10/264/377, 872 bytes. Leaflet's default #ddd container showed through.
//
// A FLAT BLUE FILL WOULD HAVE BEEN WRONG: NAIP 404s at every zoom outside the US, so Paris and
// Watopia would have rendered as solid ocean. A real map underneath is right in both cases.
//
// Run: node scripts/map-water-test.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== there is ground under the imagery ===' + X);
ok('an underlay layer exists', /var satUnder=L\.tileLayer\(/.test(src));
ok('...it is Esri World_Ocean_Base, which has real water', /Ocean\/World_Ocean_Base\/MapServer/.test(src));
ok('...in its own pane', /pane:'satBase'/.test(src));
ok('...created below tilePane', /map\.getPane\('satBase'\)\.style\.zIndex=190;/.test(src));
ok('...and attributed', /attribution:'Ocean base &copy; Esri'/.test(src));

console.log('\n' + Y + '=== it only appears under satellite, and adds no noise elsewhere ===' + X);
ok('removed on every base switch', /try\{ map\.removeLayer\(satUnder\); \}catch\(e\)\{\}/.test(src));
ok('...added back only for satellite', /if\(which==='satellite'\)\{ try\{ satUnder\.addTo\(map\); \}catch\(e\)\{\} \}/.test(src));
// It must carry no labels: satLabels already draws names and two sets double-print.
ok('NEG: the underlay is not a labelled style', !/World_Ocean_Reference/.test(src));

console.log('\n' + Y + '=== the reason NAIP was chosen is untouched ===' + X);
ok('NAIP is still the satellite layer', /USGSImageryOnly\/MapServer/.test(src));
ok('...still capped at native z16', /maxNativeZoom:16/.test(src));
ok('NEG: not switched back to Esri World_Imagery', !/services\/World_Imagery\/MapServer/.test(src));
ok('the measurement that motivated NAIP is still recorded', /luminance SD 20\.7 vs 30\.2/.test(src));

console.log('');
if (fails) { console.log(R + 'map water: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'map water: all checks passed' + X + '\n');
