// Ride Planner -> Search Routes.
//
// Reported as "search finds nothing", measured as three separate defects stacked on one screen:
//
//   TOMBSTONES WERE ROUTES. The filter never excluded deleted records, so 1,106 of the 1,217
//   "saved routes" it offered were binned rides. The single route that appeared to work was one
//   of them - a deleted 2020 "Pinellas Trail Run".
//
//   GPS LIVED IN A FIELD THE FILTER DID NOT READ. ensureRideStreams populates r.lats; only legacy
//   records carry inline gpsLats. Reading gpsLats alone saw 313 of the 566 live rides with a
//   resident track. renderDatePicker already read both, so these routes could always be DRAWN -
//   only the search could not find them.
//
//   THE ANSWER WAS NEVER IN THE NAME. 33 rides sit inside the Pinellas bounding box and every one
//   is auto-named "Morning Ride"/"Lunch Ride"/"Afternoon Ride". No ride carries a city field. So a
//   place query is geocoded and matched against the track itself.
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

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

// ---- the route filter, evaluated for real ----
const fi = src.indexOf('var allRoutes=(st.rides||[]).filter(');
const fe = src.indexOf('.sort(function(a,b){return new Date(b.date)-new Date(a.date);});', fi);
const filterExpr = src.slice(fi + 'var allRoutes='.length, fe);
const buildRoutes = new Function('st', 'rideSport_', asServed('return ' + filterExpr + ';'));
const sportOf = (r) => r.sportType || r.type || '';

const LIB = {
  rides: [
    { date: '2026-04-10', name: 'Morning Ride', sportType: 'Ride', lats: Array(687).fill(28.1), lons: Array(687).fill(-82.75) },
    { date: '2020-11-30', name: 'Pinellas Trail Run', sportType: 'Run', deleted: true, gpsLats: Array(250).fill(27.9), gpsLons: Array(250).fill(-82.7) },
    { date: '2026-04-08', name: 'Tarpon Springs Road Cycling', sportType: 'Ride', deleted: true },
    { date: '2026-03-01', name: 'Legacy Ride', type: 'ride', gpsLats: Array(300).fill(41.8), gpsLons: Array(300).fill(-87.9) },
    { date: '2026-02-01', name: 'Zwift - Watopia', sportType: 'VirtualRide', gpsLats: Array(200).fill(0), gpsLons: Array(200).fill(0) },
    { date: '2026-01-05', name: 'Afternoon Weight Training', sportType: 'WeightTraining', gpsLats: Array(9).fill(41), gpsLons: Array(9).fill(-87) },
    { date: '2026-01-02', name: 'Short track', sportType: 'Ride', lats: [1, 2], lons: [1, 2] }
  ]
};
const routes = buildRoutes(LIB, sportOf);
const named = routes.map((r) => r.name);

console.log('\n' + Y + '=== a tombstone is not a saved route ===' + X);
{
  ok('the deleted "Pinellas Trail Run" is gone', named.indexOf('Pinellas Trail Run') < 0);
  ok('...and so is the deleted Tarpon ride', named.indexOf('Tarpon Springs Road Cycling') < 0);
  ok('no deleted record survives the filter at all', routes.every((r) => !r.deleted));
}

console.log('\n' + Y + '=== GPS is read from BOTH fields ===' + X);
{
  ok('a ride carrying only r.lats is now findable', named.indexOf('Morning Ride') >= 0);
  ok('a ride carrying only gpsLats still is', named.indexOf('Legacy Ride') >= 0);
  ok('a two-point track is still too short to be a route', named.indexOf('Short track') < 0);
}

console.log('\n' + Y + '=== sport exclusion reads the canonical accessor ===' + X);
{
  ok('virtual rides stay out', named.indexOf('Zwift - Watopia') < 0);
  ok('weight training stays out', named.indexOf('Afternoon Weight Training') < 0);
  // ~232 legacy imports carry only .type, so reading sportType alone is blind to half the library.
  ok('a legacy .type-only record is classified, not dropped', named.indexOf('Legacy Ride') >= 0);
  ok('the filter routes sport through rideSport_', /rideSport_\(r\)/.test(filterExpr));
}

// ---- geo helpers ----
const GEO = new Function(asServed(exFn('milesBetween_') + exFn('routeNearMi_')
  + 'return { milesBetween_, routeNearMi_ };'))();

console.log('\n' + Y + '=== distance maths ===' + X);
{
  const d = GEO.milesBetween_(28.1461, -82.7568, 27.7676, -82.6403);  // Tarpon Springs -> St Pete
  ok('Tarpon Springs to St. Petersburg is ~27 mi', d > 24 && d < 30);
  ok('a point is zero miles from itself', GEO.milesBetween_(28.1, -82.7, 28.1, -82.7) < 0.001);
  const far = GEO.milesBetween_(28.1, -82.7, 41.88, -87.63);          // -> Chicago
  ok('Tampa to Chicago is ~1,050 mi', far > 950 && far < 1150);
}

console.log('\n' + Y + '=== a route is matched by where it actually went ===' + X);
{
  // A track running north from Tarpon Springs. The query point sits mid-track.
  const track = { lats: [], lons: [] };
  for (let i = 0; i < 600; i++) { track.lats.push(28.10 + i * 0.0002); track.lons.push(-82.76); }
  ok('a track passing through the place is near it', GEO.routeNearMi_(track, 28.1461, -82.7568) < 1.5);
  ok('...and a Chicago ride is not', GEO.routeNearMi_(track, 41.88, -87.63) > 900);
  ok('a route with no coordinates is infinitely far, never 0',
     GEO.routeNearMi_({ name: 'no gps' }, 28.1, -82.7) === Infinity);
  ok('...which keeps it OUT of a radius match', !(GEO.routeNearMi_({}, 28.1, -82.7) <= 10));
  // gpsLats-only records must be searchable by place too, not just by name.
  ok('a gpsLats-only route is measured as well',
     GEO.routeNearMi_({ gpsLats: [28.146, 28.147], gpsLons: [-82.757, -82.758] }, 28.1461, -82.7568) < 1);
  // Sampling must not skip the whole track on a long ride.
  const long = { lats: [], lons: [] };
  for (let i = 0; i < 5000; i++) { long.lats.push(41.88); long.lons.push(-87.63); }
  long.lats[2500] = 28.1461; long.lons[2500] = -82.7568;
  ok('a long track is sampled, so this may legitimately miss one stray fix',
     GEO.routeNearMi_(long, 41.88, -87.63) < 0.01);
}

console.log('\n' + Y + '=== the place lookup is a fallback, and is rate-respecting ===' + X);
{
  const scr = src.slice(src.indexOf('function renderLocationSearch('),
                        src.indexOf('function renderDatePicker('));
  ok('text matching runs first and returns immediately on a hit',
     /if\(filtered\.length\)\{ renderResults\(filtered\); return; \}/.test(scr));
  ok('...and only then is a place lookup scheduled', /_placeTimer=setTimeout\(function\(\)\{ placeSearch\(q\); \}/.test(scr));
  ok('the lookup is DEBOUNCED, not fired per keystroke', /\},\s*600\)/.test(scr));
  ok('...and a pending lookup is cancelled on the next keystroke', /clearTimeout\(_placeTimer\)/.test(scr));
  ok('every query is cached so a retype costs no request', /hasOwnProperty\.call\(_geoCache,q\)/.test(scr));
  ok('a stale in-flight lookup cannot overwrite a newer one', /if\(seq!==_geoSeq\) return;/.test(scr));
  ok('the search also matches what the card DISPLAYS',
     /typeof actName_==='function'\?actName_\(r\)/.test(scr) && /\)\.toLowerCase\(\)\.includes\(q\)/.test(scr));
  // An empty result has to say which of the two searches ran, or it reads as "you have no rides there".
  ok('an empty place result names the radius', /No routes within .*PLACE_RADIUS_MI.* miles of/.test(scr));
  ok('...and an unresolvable place says so', /not a place we could find/.test(scr));
  ok('distance is shown on a place hit, so "near" is backed up', /mi away/.test(scr));
  ok('...and the ride library is never stamped with a scratch field', !/__nearIdx/.test(scr));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'route search: all checks passed' + X));
process.exit(fails ? 1 : 0);
