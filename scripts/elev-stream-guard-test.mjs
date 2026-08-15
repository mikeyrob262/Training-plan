// One ride must not report climbing and "nothing recorded" for the same fact.
//
// The Aug 14 2026 Zwift ride showed 1739 ft Elevation Gain on the summary tile, "No elevation data"
// in the profile underneath it, and "—" for Max Elevation. Three reads, three different answers,
// one ride. They come from two genuinely different places:
//
//   r.elev     - Strava SUMMARY scalar (total_elevation_gain), arrives with the activity sync
//   r.chartEle - per-point ALTITUDE STREAM, fetched separately and lazily
//   r.maxElev  - derived from that same stream, so it is blank exactly when the stream is
//
// The gain total was RIGHT. The stream was missing, and the reason it stayed missing forever is the
// guard-on-attempt bug: both ride-detail open paths stamped r._streamsTried=true BEFORE calling the
// fetch, so a single rate-limited or failed call permanently denied that ride its altitude data.
// The flag is not in STORAGE_HEAVY_FIELDS_, so it persisted and synced across devices.
//
// This file locks down both halves: the flag is stamped on ANSWER, and an absent profile is
// described honestly rather than as an absence of elevation.
//
// Run: node scripts/elev-stream-guard-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const lines = src.split(/\r?\n/);

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

console.log('\n' + Y + '=== the flag is stamped on ANSWER, never on attempt ===' + X);
// The stamp lives next to _spdTried, which already had this rule right, and both sit behind the
// same arr[0] condition: the streams endpoint responded.
check('_streamsTried is stamped inside the fetch', /if\(arr\[0\]\) r\._streamsTried=true;/.test(src), true);
check('...alongside _spdTried, under the same answered-condition', /if\(arr\[0\]\) r\._spdTried=true;/.test(src), true);

// The regression that must never come back: either open path stamping before ensureRideStreams.
const preStamp = [];
lines.forEach((L, i) => {
  if (/^\s*\/\//.test(L)) return;
  if (/_wantStr\s*\)?\s*r\._streamsTried\s*=\s*true/.test(L)) preStamp.push('worker.js:' + (i+1) + '  ' + L.trim());
});
check('neither open path pre-stamps the flag', preStamp, []);
if (preStamp.length) preStamp.forEach((b) => console.log('    ' + R + b + X));

// Both renderers gate the fetch independently. A fix applied to one leaves the other writing the
// poisoned flag onto the shared ride record, which re-breaks the surface that was fixed.
const stampCount = (src.match(/r\._streamsTried\s*=\s*true/g) || []).length;
check('exactly one writer of the flag in the whole file', stampCount, 1);

console.log('\n' + Y + '=== rides already carrying the flag get one re-attempt ===' + X);
// Fixing the rule does nothing for a ride whose flag was already persisted and synced.
check('a version-stamped heal exists', /function healElevStreamFlag_\(\)/.test(src), true);
check('...it clears the blocking flag', /delete r\._streamsTried;[\s\S]{0,80}n\+\+;/.test(src), true);
check('...only for rides with no profile', /if\(r\.chartEle && r\.chartEle\.length\) return;/.test(src), true);
check('...and stamps a version so it is not per-load', /st\._elevHealV=_ELEV_HEAL_V;/.test(src), true);
// Placement matters: a repair run at boot sees whatever this device held, not the merged library.
// Match the guarded CALL, not the definition — "function healElevStreamFlag_()" contains the same
// substring, so a bare indexOf finds the declaration and the ordering assertion means nothing.
const CALL = /typeof (healElevStreamFlag_|healStaleLaps_)==='function'\) \1\(\);/g;
const callOrder = [...src.matchAll(CALL)].map((m) => m[1]);
check('the heal is invoked exactly once, as a guarded call', callOrder.filter((c) => c === 'healElevStreamFlag_').length, 1);
// Both live in the post-remote-pull block; adjacency is what keeps them seeing the merged library.
const healCall = src.search(/typeof healElevStreamFlag_==='function'\) healElevStreamFlag_\(\);/);
const lapCall = src.search(/typeof healStaleLaps_==='function'\) healStaleLaps_\(\);/);
check('it runs beside the lap heal, after the remote pull', healCall > lapCall && healCall - lapCall < 400, true);

console.log('\n' + Y + '=== an absent profile is described, not denied ===' + X);
// "No elevation data" beside a real ft figure is the fabrication this fixes.
check('the flat denial is gone', /No elevation data<\/div>/.test(src), false);
check('the empty state names the missing thing', /no per-point altitude stream stored for this ride/.test(src), true);
check('...and reports the gain that DOES exist', /ft total gain &mdash; /.test(src), true);
check('elevProfile receives the gain', /function elevProfile\(ele,distMi,secs,_sc,_st,_sd,_gain\)/.test(src), true);
check('...from the canonical resolver at the call site', /elevProfile\(r\.chartEle,r\.distance,r\.movingSecs,r\.chartSpd,r\.chartTime,r\.chartDist,_actElevGain_\(r\)\)/.test(src), true);

console.log('\n' + Y + '=== both renderers resolve gain the same way ===' + X);
// Parallel renderers: a bare r.elev on either surface lets them report different climbing, and the
// runs library stores gain on .elevation rather than .elev, so a bare read is wrong there outright.
check('desktop tile goes through _actElevGain_', /var _eg=_actElevGain_\(r\);return _eg\?Math\.round\(_eg\)\+' ft':'--';/.test(src), true);
check('mobile row goes through _actElevGain_', /var _mEg=_actElevGain_\(r\);/.test(src), true);

const bareElev = [];
lines.forEach((L, i) => {
  if (/^\s*\/\//.test(L)) return;
  // The two ride-detail gain displays specifically. Both used to read r.elev directly.
  if (/(Elevation Gain|Elev Gain)<\/div>/.test(L) && /r\.elev\b/.test(L)) {
    bareElev.push('worker.js:' + (i+1) + '  ' + L.trim().slice(0, 110));
  }
});
check('no ride-detail gain tile reads r.elev bare', bareElev, []);
if (bareElev.length) bareElev.forEach((b) => console.log('    ' + R + b + X));

console.log('\n' + Y + '=== max elevation is still the HIGH POINT, never the gain ===' + X);
// The one thing this fix must not "reconcile": maxElev is altitude, not climbing. Filling it from
// the gain total to make the row look consistent is how a 37ft trail run became a 791ft climb.
check('maxElev is derived from the altitude stream only', /r\.maxElev=Math\.round\(_ma\*3\.28084\)/.test(src), true);
check('...and _actElevGain_ never reads it', /var direct=\[r\.elev, r\.elevation, r\.total_elevation_gain, r\.totalElevationGain\];/.test(src), true);
check('...which is written down where it matters', /deliberately never summed here/.test(src), true);

console.log('');
if (fails) { console.log(R + 'elev stream guard: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'elev stream guard: all checks passed' + X + '\n');
