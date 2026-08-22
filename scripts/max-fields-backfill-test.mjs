// HAVING THE CHART IS NOT HAVING THE MAX.
//
// Reported as one ride: "Jenison-Georgetown Group Ride, Aug 18 2026 - Speed card shows Avg 19.2 mph
// but Max reads '--'", with Max Elevation blank the same way. Measured against the live library it
// was not one ride. Of 836 live rides, maxSpeed was present on 47 (6%) and maxElev on 45 (5%); 65%
// held an average speed with no max, and 82% an elevation with no max elevation. FIT and Intervals
// imports were at 0% for both.
//
// The derivation was never missing. maxElev and maxSpeed are computed inside fetchStravaStreams_
// from the FULL 1Hz stream - which is right, because the stored series are decimated (the reported
// ride carries 68 elevation and 104 speed points) and a max taken from those understates the truth.
// What was wrong was WHEN that path runs. Both ride-detail renderers decided whether to fetch by
// asking whether the ride had CHARTS:
//
//   var _wantStr = !(r.chartEle && r.chartEle.length) && !r._streamsTried;
//   var _wantSpd = !r._spdTried && !(r.chartSpd && r.chartSpd.length);
//
// A ride that picked up charts from an earlier import path answered "nothing to fetch" forever, so
// the max could never be derived - having the chart is exactly what prevented it. Same failure family
// as the _streamsTried pre-stamp: a predicate asking a question ADJACENT to the one that matters.
//
// Run: node scripts/max-fields-backfill-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

console.log('\n' + Y + '=== the predicate asks about the MAX, not only the chart ===' + X);
{
  const strs = (src.match(/var _wantStr=\(!\(r\.chartEle&&r\.chartEle\.length\) \|\| r\.maxElev==null\) && !r\._streamsTried;/g) || []).length;
  const spds = (src.match(/var _wantSpd=!r\._spdTried && \(!\(r\.chartSpd && r\.chartSpd\.length\) \|\| r\.maxSpeed==null\);/g) || []).length;
  // BOTH renderers, because st.rides is shared and they gate independently: if only one healed the
  // record, a ride opened solely on the other surface would keep its blank max for good.
  eq('both renderers ask for elevation when maxElev is missing', strs, 2);
  eq('both renderers ask for speed when maxSpeed is missing', spds, 2);
  ok('NEG: the chart-only elevation predicate is gone everywhere',
     !/var _wantStr=!\(r\.chartEle&&r\.chartEle\.length\) && !r\._streamsTried;/.test(src));
  ok('NEG: and the chart-only speed predicate with it',
     !/var _wantSpd=!r\._spdTried && !\(r\.chartSpd && r\.chartSpd\.length\);/.test(src));
  ok('the mobile renderer actually acts on the speed want', /\(_wantStr \|\| _wantSpd \|\| _wantGps \|\| _wantLaps\)/.test(src));
}

console.log('\n' + Y + '=== ensureRideStreams learned the same reason ===' + X);
{
  // THE FIRST CUT OF THIS FIX CHANGED NOTHING ON THE REPORTED RIDE, and the unit tests were green.
  // The predicates above decide whether to CALL ensureRideStreams; ensureRideStreams then has its
  // OWN short-circuit, and that gate still asked only about charts. The ride satisfied every
  // condition - chartEle 68, lats 114, chartSpd 104, laps fine - and returned without a request.
  // Caller and callee both gate, so both have to learn the reason. Verified end to end against the
  // live app afterwards, not inferred from the suite passing.
  const gates = (src.match(/&& \(r\._streamsTried \|\| r\.maxElev!=null\)\s*\n\s*&& \(r\._spdTried \|\| \(r\.chartSpd && r\.chartSpd\.length && r\.maxSpeed!=null\)\)/g) || []).length;
  eq('BOTH short-circuits in ensureRideStreams check the maxes', gates, 2);
  ok('NEG: neither gate is chart-only any more',
     !/&& \(r\._spdTried \|\| \(r\.chartSpd && r\.chartSpd\.length\)\)\s*\n\s*&& !lapsNeedMovingFix_/.test(src));
  // The gate must stay keyed on the TRIED flag, or a ride whose stream genuinely carries no altitude
  // or velocity re-fetches on every open forever - the guard-on-attempt mistake this file has already
  // paid for twice via _gpsTried.
  const complete = (r) => !!((r.chartEle && r.chartEle.length) && (r.lats && r.lats.length)
    && (r._streamsTried || r.maxElev != null)
    && (r._spdTried || (r.chartSpd && r.chartSpd.length && r.maxSpeed != null)));
  const base = { chartEle: [1], lats: [1], chartSpd: [1] };
  ok('the reported shape is INCOMPLETE, so it fetches', !complete({ ...base, maxElev: null, maxSpeed: null }));
  ok('...and complete once the maxes land', complete({ ...base, maxElev: 812, maxSpeed: 31.4 }));
  ok('a stream that answered but carried no altitude is complete, not a forever-refetch',
     complete({ ...base, maxElev: null, maxSpeed: null, _streamsTried: true, _spdTried: true }));
  ok('NEG: missing charts still fetch regardless of the maxes',
     !complete({ lats: [1], maxElev: 812, maxSpeed: 31.4, _streamsTried: true, _spdTried: true }));
}

console.log('\n' + Y + '=== presence is ==null, not truthiness ===' + X);
{
  // A stored 0 is a value; a missing field is not. Truthiness cannot tell them apart, and this app
  // has been bitten by that before (+null and +'' are both 0).
  ok('elevation presence uses ==null', /r\.maxElev==null/.test(src));
  ok('speed presence uses ==null', /r\.maxSpeed==null/.test(src));
  ok('NEG: neither predicate tests truthiness', !/\|\| !r\.maxElev\)/.test(src) && !/\|\| !r\.maxSpeed\)/.test(src));
  const present = (v) => !(v == null);
  ok('a stored 0 counts as present, so it is not refetched forever', present(0));
  ok('undefined counts as absent', !present(undefined));
  ok('null counts as absent', !present(null));
  ok('a real value counts as present', present(31.4));
}

console.log('\n' + Y + '=== the derivation it unblocks is unchanged ===' + X);
{
  // These are the two lines the predicate exists to reach. They read the FULL stream, not the stored
  // decimated series, and they only fill a gap rather than overwrite a value already recorded.
  ok('maxElev is derived from the altitude stream', /if\(!r\.maxElev\)\{ var _ma=maxOf\(alt,10000\)/.test(src));
  ok('...converted m -> ft', /r\.maxElev=Math\.round\(_ma\*3\.28084\)/.test(src));
  ok('maxSpeed is derived from the velocity stream', /if\(vel && !r\.maxSpeed\)\{ var mv=maxOf\(vel,50\)/.test(src));
  ok('...converted m/s -> mph', /r\.maxSpeed=Math\.round\(mv\*2\.23694\*10\)\/10/.test(src));
  ok('both only FILL, never overwrite an existing value', /if\(!r\.maxElev\)/.test(src) && /!r\.maxSpeed\)/.test(src));
}

console.log('\n' + Y + '=== it stays self-limiting ===' + X);
{
  // The whole safety argument for letting ~65% of rides fetch once is that the flags are stamped on
  // ANSWER, so a ride cannot loop and a stream that carries no altitude does not retry forever.
  ok('the elevation want is still gated on _streamsTried', /\) && !r\._streamsTried;/.test(src));
  ok('the speed want is still gated on _spdTried', /var _wantSpd=!r\._spdTried &&/.test(src));
  ok('the flag is stamped where the endpoint answers, not before the call',
     /_streamsTried is NOT stamped here any more/.test(src));
  ok('a non-Strava ride is never fetched, since there is no stream to ask for',
     /if\(!_noFetch && r\.stravaId &&/.test(src));
  // Exercise the loop bound: one attempt per ride per flag, regardless of how many opens.
  let fetches = 0;
  const ride = { chartSpd: [1, 2, 3], maxSpeed: null, _spdTried: false };
  for (let open = 0; open < 5; open++) {
    const want = !ride._spdTried && (!(ride.chartSpd && ride.chartSpd.length) || ride.maxSpeed == null);
    if (want) { fetches++; ride._spdTried = true; }        // stamped when the endpoint answers
  }
  eq('five opens of a gap-carrying ride cause exactly one fetch', fetches, 1);
  let none = 0;
  const healthy = { chartSpd: [1, 2, 3], maxSpeed: 31.4, _spdTried: false };
  for (let open = 0; open < 5; open++) {
    if (!healthy._spdTried && (!(healthy.chartSpd && healthy.chartSpd.length) || healthy.maxSpeed == null)) none++;
  }
  eq('NEG: a ride that already has its max is never fetched at all', none, 0);
}

console.log('');
if (fails) { console.log(R + 'max fields backfill: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'max fields backfill: all checks passed' + X + '\n');
