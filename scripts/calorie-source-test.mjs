// Activity calories: the right quantity, from the authoritative source.
//
// Reported: the 2026-07-29 trail run showed 527 Cal against Garmin's 376, and the Nutrition page
// said nothing was burned. Both came from ONE missing field.
//
//   rideKj_ returns MECHANICAL WORK in kilojoules (avgPwr x seconds). It was printed with a "Cal"
//   label. For CYCLING the two land close — gross efficiency ~24%, so metabolic kcal is roughly
//   work in kJ — which is why the mislabel survived for years. Running power is not drivetrain
//   work, so 529 kJ overstated that run's burn by 40%.
//
//   The real figure was available all along: Strava's DETAIL endpoint returns calories: 376 for
//   activity 19515414647 (verified live; identical to Garmin). The LIST endpoint the sync reads
//   does not return it, so r.calories was never set — and burnedCalsForDate_ reads ONLY r.calories
//   (correctly; it refuses to invent numbers), which is why Nutrition showed nothing burned.
//
// Run: node scripts/calorie-source-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let code='';
for(const f of ['rideSport_','rideKj_','rideCalories_','rideCalText_','stravaHarvestDetail_',
                'normDate','burnedCalsForDate_']) code+=extract(f);
const M=new Function('st', code+'\n;return {rideKj_,rideCalories_,rideCalText_,stravaHarvestDetail_,burnedCalsForDate_};');

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
const mk = st => M(st);

// ---- the reported activity, exactly as it sits in /data/rides ----
const RUN = { name:'Gaines - PHT Trail Run', date:'2026-07-29', sportType:'Run',
  distance:3.3, duration:'0:35:56', movingSecs:2156, avgPwr:244.5, np:245, workKj:529, tss:100 };
// ...and what Strava's detail endpoint actually returns for it (fetched live, id 19515414647)
const STRAVA_DETAIL = { calories:376, kilojoules:529.4, average_watts:244.5, device_watts:true, moving_time:2156 };

const A = mk({rides:[], runs:[]});

console.log('\n=== the quantity that was being shown ===');
check('rideKj_ is 527 kJ of mechanical work', A.rideKj_(RUN), 527);
check('...which is what the card used to print as "Cal"', A.rideKj_(RUN), 527);

console.log('\n=== a run with no measured calories gets NO number invented ===');
check('rideCalories_ returns null rather than the kJ', A.rideCalories_(RUN), null);
check('the card shows a dash, not 527', A.rideCalText_(RUN), '—');

console.log('\n=== harvesting the detail response fixes it ===');
const filled = Object.assign({}, RUN);
check('the harvester reports it moved something', A.stravaHarvestDetail_(filled, STRAVA_DETAIL), true);
check('calories now match Garmin exactly', filled.calories, 376);
check('the card shows 376 Cal', A.rideCalText_(filled), '376 Cal');
check('...and it is NOT flagged as an estimate', A.rideCalories_(filled).est, false);
check('527 is nowhere near the shown figure any more', A.rideCalText_(filled).indexOf('527')<0, true);
check('the 40% overstatement is gone', Math.round((527-376)/376*100), 40);

console.log('\n=== the harvester only fills gaps ===');
const manual = Object.assign({}, RUN, {calories:400});
check('an existing value is not overwritten', [A.stravaHarvestDetail_(manual, STRAVA_DETAIL), manual.calories], [false, 400]);
check('workKj is filled when missing', (function(){ const r={}; A.stravaHarvestDetail_(r, STRAVA_DETAIL); return r.workKj; })(), 529);
check('re-running changes nothing (idempotent)', A.stravaHarvestDetail_(filled, STRAVA_DETAIL), false);
// RUN already carries workKj:529, so a detail response offering only kilojoules moves nothing.
check('a detail response with no calories is a no-op', A.stravaHarvestDetail_(Object.assign({},RUN), {kilojoules:529.4}), false);
check('...but it DOES fill workKj on a record that lacks it', (function(){ const r={sportType:'Ride'}; A.stravaHarvestDetail_(r,{kilojoules:529.4}); return r.workKj; })(), 529);

console.log('\n=== cycling keeps the kJ approximation, but MARKED ===');
const RIDE = { sportType:'Ride', date:'2026-07-25', distance:33.2, movingSecs:6779, avgPwr:115.2 };
const rc = A.rideCalories_(RIDE);
check('a ride with power still gets a figure', rc.cal, 781);
check('...flagged as an estimate', rc.est, true);
check('...and rendered with a tilde', A.rideCalText_(RIDE), '~781 Cal');
check('a measured value beats the estimate', A.rideCalText_(Object.assign({},RIDE,{calories:812})), '812 Cal');
check('VirtualRide counts as cycling', A.rideCalories_({sportType:'VirtualRide', movingSecs:2665, avgPwr:136.8}).est, true);
check('a legacy blank-sport .fit ride still estimates', A.rideCalories_({movingSecs:3600, avgPwr:100}).est, true);

console.log('\n=== non-cycling never gets a power-derived calorie figure ===');
for(const sp of ['Run','TrailRun','Walk','Swim','WeightTraining','Rowing'])
  check(sp+' with power -> null', A.rideCalories_({sportType:sp, movingSecs:2156, avgPwr:244.5}), null);
check('a run WITH measured calories still shows them', A.rideCalText_({sportType:'Run', calories:376}), '376 Cal');
check('an activity with no power and no calories -> dash', A.rideCalText_({sportType:'WeightTraining', movingSecs:3002}), '—');

console.log('\n=== Nutrition sees the burn once the field exists ===');
const B0 = mk({ rides:[RUN], runs:[] });
check('before: nothing burned on 2026-07-29', B0.burnedCalsForDate_('2026-07-29'), {cal:0, n:0, sources:[]});
const B1 = mk({ rides:[filled], runs:[] });
const after = B1.burnedCalsForDate_('2026-07-29');
check('after: 376 burned', after.cal, 376);
check('...from one activity', after.n, 1);
check('...named in the breakdown', (after.sources[0]||{}).name, 'Gaines - PHT Trail Run');
check('a different day is unaffected', B1.burnedCalsForDate_('2026-07-28').cal, 0);

console.log('\n=== a derived CYCLING burn counts, and says that it is derived ===');
// REVERSED 2026-08-11, deliberately. This used to contribute 0, on the rule that fuelling must
// not follow a power-derived number. But 131 rides in the library carry workKj and no calories
// field, so every one of those days told the athlete nothing was burned after a real ride -
// which is its own way of being wrong about what to eat. It counts now and is MARKED: est is
// carried per source and both rendered lines print a tilde.
//
// What has NOT changed: a flat per-session guess (the old 250-per-strength) is still refused,
// and a RUN is still excluded - rideCalories_ derives from kJ for cycling only, because a
// running power meter's 529 kJ is not 529 kcal. Strava reports 376 for that exact activity.
const B2 = mk({ rides:[RIDE], runs:[] });
check('a derived cycling burn now counts', B2.burnedCalsForDate_('2026-07-25').cal, 781);
check('...and is flagged as derived', (B2.burnedCalsForDate_('2026-07-25').sources[0]||{}).est, true);
check('a RUN with kJ but no calories still contributes nothing',
      mk({ rides:[RUN], runs:[] }).burnedCalsForDate_('2026-07-29').cal, 0);
check('...even though the card shows ~781', A.rideCalText_(RIDE), '~781 Cal');

console.log('\n=== source guard: no surface prints kJ as Cal ===');
check('no site renders rideKj_ with a Cal label', /rideKj_\([^)]*\)[^;]{0,80}' Cal'/.test(src), false);
// The colour here is incidental — it was only ever an anchor to identify the call site, and pinning
// a literal hex made this fail the moment desktop colours moved to theme variables for light mode.
// Match the structure, not the palette.
check('the desktop Burned cell reads through rideCalText_', /rideCalText_\(r\)\+'<\/div><div style="font-size:9px;color:[^"]+">/.test(src), true);
check('the backfill exists and is newest-first', /function backfillStravaCalories_[\s\S]{0,700}\(a\.date<b\.date\)\?1:-1/.test(src), true);
check('the sync calls it', /backfillStravaCalories_\(40,/.test(src), true);
// EVERY DETAIL FETCH, COUNTED AGAINST THE FETCHES — not a bare occurrence count.
//
// The old form was `occurrences >= 3`, and the function DEFINITION is one of those occurrences, so
// it passed while fetchStravaStreams_ — which pulls /activities/{id} for laps — threw the calorie
// payload away, and while fetchStravaGPS did the same for the polyline. A run synced today read
// calories:null and contributed nothing to the day's burn; on a bike day the kJ estimate hid it, so
// it only ever surfaced on a run-only day. The assertion existed and did not ask the right question.
//
// Now: every site that fetches the ACTIVITY object must harvest. Streams-only URLs are excluded —
// they return no activity payload to harvest.
{
  const detailFetches = [...src.matchAll(/api\/v3\/activities\/'\+[^\n]*/g)]
    .map((m) => m[0]).filter((u) => !/\/streams/.test(u));
  const harvests = (src.match(/stravaHarvestDetail_\(/g) || []).length - 1;   // minus the definition
  check('every activity-detail fetch site harvests the payload', harvests >= detailFetches.length, true);
  check('...and there are at least four such sites', detailFetches.length >= 4, true);
  // The two that were silently discarding it.
  check('fetchStravaStreams_ harvests the detail it already fetched',
    /var s=arr\[0\]\|\|\{\}, a=arr\[1\]\|\|\{\};[\s\S]{0,900}stravaHarvestDetail_\(r, a\)/.test(src), true);
  check('fetchStravaGPS harvests BEFORE its no-map early return',
    /stravaHarvestDetail_\(_ht, a\)[\s\S]{0,300}if\(!a\|\|!a\.map\)/.test(src), true);
}

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'calorie-source: all checks passed'+X));
process.exit(fails?1:0);
