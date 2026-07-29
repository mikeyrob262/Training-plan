// /store_v2 live-tail fold guard.
//
// /store_v2 is a HAND-UPLOADED snapshot -- storeV2Put_ from the console is its only writer --
// while Strava/Intervals sync keeps filling st.rides. Every reader downstream of
// allRidesDeduped_ therefore stops at the snapshot's newest activity unless the tail is folded
// back on. On 2026-07-29 that showed as You vs. You reporting July at 335.2 mi over 10 rides
// against Strava's 452.2 over 15: a 117.0 mi undercount that was entirely the five rides logged
// after the snapshot's last ride (2026-07-18).
//
// storeV2Tail_ closes it with a DATE CUT, and the two fixtures that matter are the ones pulling
// against each other:
//   - fold everything after the horizon, or the gap reopens the moment the snapshot goes stale;
//   - fold NOTHING at or before it, or the same ride gets counted twice.
// The date cut is deliberately not the fuzzy date+distance rule dedupeRides_ uses. Fixture 3 is
// the real record that proves the fuzzy rule is too weak here: st.rides carries a no-id 52.4 mi
// "Lunch Ride" on 2024-06-30 against the snapshot's 54.7 mi copy of the SAME ride, 2.3 mi apart,
// which the <1 mi test calls a different ride and would fold in as 52.4 phantom miles.
//
// Run: node scripts/store-v2-tail-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){
  const idx = src.indexOf('function '+name+'(');
  if (idx < 0) throw new Error('fn not found in worker.js: '+name);
  return src.slice(idx, matchBrace(idx)+1)+'\n';
}
function extractVar(name){
  const m = src.match(new RegExp('^var ' + name + '[^\\n]*$', 'm'));
  if (!m) throw new Error('var not found in worker.js: '+name);
  return m[0]+'\n';
}

const code = extractVar('STORE_V2_RIDE_RE') + extractVar('STORE_V2_RUN_RE')
  + extract('rideSport_') + extract('storeV2Sport_') + extract('storeV2Tail_');
(0, eval)(code);

const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
let failed = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`${R}  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}${X}`); }
}
const ride = (date, distance, stravaId, type) => ({ date, distance, stravaId, type: type || 'Ride' });
// Horizon 2026-07-18, the generation that produced the 117 mi gap.
const SNAP = [ride('2026-07-10', 20, 1), ride('2026-07-18', 30, 2)];

// 1. THE JULY FIXTURE -- the five post-horizon rides must all fold, and only them.
const july = storeV2Tail_(SNAP, STORE_V2_RIDE_RE, SNAP.concat([
  ride('2026-07-21', 21.5, 19410857031, 'VirtualRide'),
  ride('2026-07-23', 15.4, 19432701272, 'VirtualRide'),
  ride('2026-07-23', 31.8, 19439329084),
  ride('2026-07-25', 33.2, 19461105747),
  ride('2026-07-28', 15.1, 19507730168, 'VirtualRide'),
]));
check('july tail folds exactly the post-horizon rides', july.add.length, 5);
check('july tail is 117.0 mi', Math.round(july.add.reduce((s,r)=>s+r.distance,0)*10)/10, 117.0);
check('horizon is the bucket max', july.horizon, '2026-07-18');

// 2. records the snapshot already holds never fold, however they are spelled
check('a stravaId already in the snapshot is skipped', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 30, 2)]).add.length, 0);
check('stravaId string/number mismatch still matches', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 30, '2')]).add.length, 0);
check('anything before the horizon is skipped', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-05', 40, 9)]).add.length, 0);

// 3. THE 2024-06-30 FIXTURE -- the phantom the fuzzy rule would let through. It sits far before
//    the horizon, so the date cut refuses it without ever comparing distances.
check('the 52.4 mi no-id twin of a 54.7 mi snapshot ride never folds',
  storeV2Tail_([ride('2024-06-30', 54.7, 11777932314)].concat(SNAP), STORE_V2_RIDE_RE,
    [ride('2024-06-30', 52.4, null)]).add.length, 0);

// 4. the boundary day: an id the snapshot lacks is a second activity; anything else is a twin
const bTwin = storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-18', 30, null)]);
check('boundary-day record with no id is skipped and counted', [bTwin.add.length, bTwin.skipped], [0, 1]);
check('boundary-day record with a new id folds', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-18', 12, 77)]).add.map(r=>r.stravaId), [77]);

// 5. an empty bucket has no horizon, and "after nothing" would be the whole library -- the 6x
//    inflation the ride filter exists to prevent. Fold nothing rather than guess a cut.
check('empty snapshot bucket folds nothing', storeV2Tail_([], STORE_V2_RIDE_RE, [ride('2026-07-25', 40, 9)]).add.length, 0);

// 6. sport and tombstone gates
check('a run never enters the ride bucket', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 6, 9, 'Run')]).add.length, 0);
check('VirtualRide does', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 15, 9, 'VirtualRide')]).add.length, 1);
check('the spaced Strava form does too', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [{date:'2026-07-25', distance:15, stravaId:9, sportType:'Virtual Ride'}]).add.length, 1);
check('a tombstone never folds', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [{date:'2026-07-25', distance:40, stravaId:9, type:'Ride', deleted:true}]).add.length, 0);

// 7. the run pool is a union (st.rides run-typed + st.runs), so one activity can appear twice
check('the same activity twice in the pool folds once', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 40, 9), ride('2026-07-25', 40, 9)]).add.length, 1);
check('id-less same-day same-distance pair folds once', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 40, null), ride('2026-07-25', 40, null)]).add.length, 1);
check('two distinct same-day rides both fold', storeV2Tail_(SNAP, STORE_V2_RIDE_RE, [ride('2026-07-25', 40, 9), ride('2026-07-25', 40, 10)]).add.length, 2);

// 8. each bucket cuts on its OWN horizon -- a ride library that has moved must not drag runs in
check('the run bucket uses the run horizon',
  storeV2Tail_([ride('2026-04-13', 5, 100, 'Run')], STORE_V2_RUN_RE,
    [ride('2026-05-01', 4, 101, 'Run'), ride('2026-07-25', 40, 9)]).add.map(r=>r.date), ['2026-05-01']);

// 9. dates carrying a time component still compare by day
check('an ISO datetime still cuts by day',
  storeV2Tail_([ride('2026-07-18T09:00:00Z', 30, 2)], STORE_V2_RIDE_RE, [ride('2026-07-25T06:00:00Z', 40, 9)]).add.length, 1);

if (failed) { console.error(`${R}✗ store_v2 live-tail fold: ${failed} check(s) failed${X}`); process.exit(1); }
console.log(`${G}✓ store_v2 live-tail fold (18 checks, incl. the July-117mi and 2024-06-30-phantom fixtures)${X}`);
