// Calendar week column — per-sport breakdown.
//
// The week card used to lump every sport into one Miles/TSS/ft total. Splitting it introduces
// four ways to be quietly wrong, all of which render fine:
//   - a sport bucketed into the wrong line (blank-sportType .fit imports are RIDES, not "other")
//   - a per-sport total that no longer adds up to the combined total shown beside it
//   - "0 ft" printed for a sport whose activities carry no elevation data (the same false claim
//     as an insight calling an unmeasured route flat)
//   - a bare-number duration ("4715") read as MINUTES, turning a 79-minute ride into 78 hours
//
// Run: node scripts/cal-week-sport-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){
  const idx=src.indexOf('function '+name+'(');
  if(idx<0) throw new Error('fn not found in worker.js: '+name);
  return src.slice(idx, matchBrace(idx)+1)+'\n';
}
const CLOSURE=['rideSport_','_actElevGain_','parseDurToMin','actSecs_','fmtHM_','calSportBucket_','calRollup_','calSportRows_'];
let code=''; for(const f of CLOSURE) code+=extract(f);
const M=new Function(code+'\n;return {actSecs_,fmtHM_,calSportBucket_,calRollup_,calSportRows_,_actElevGain_};')();

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

console.log('\n=== actSecs_: a bare duration is SECONDS, not minutes ===');
check('movingSecs wins when present', M.actSecs_({movingSecs:2156, duration:'9:99:99'}), 2156);
check('H:MM:SS parses', M.actSecs_({duration:'1:38:15'}), 5895);
check('MM:SS parses', M.actSecs_({duration:'35:56'}), 2156);
check('bare "4715" is 4715s (79m), NOT 4715 minutes', M.actSecs_({duration:'4715'}), 4715);
check('missing duration is 0, not NaN', M.actSecs_({}), 0);

console.log('\n=== fmtHM_ ===');
check('35:56 rounds to 36m', M.fmtHM_(2156), '36m');
check('pads the minutes past an hour', M.fmtHM_(3900), '1h 05m');
check('rolls 59.7m up to a clean hour', M.fmtHM_(3599), '1h 00m');

console.log('\n=== calSportBucket_: matches the calendar filter vocabulary ===');
check('Ride', M.calSportBucket_({sportType:'Ride'}), 'ride');
check('VirtualRide is a ride', M.calSportBucket_({sportType:'VirtualRide'}), 'ride');
check('Run', M.calSportBucket_({sportType:'Run'}), 'run');
check('TrailRun is a run', M.calSportBucket_({sportType:'TrailRun'}), 'run');
check('Swim', M.calSportBucket_({sportType:'Swim'}), 'swim');
check('WeightTraining is workout', M.calSportBucket_({sportType:'WeightTraining'}), 'workout');
check('Yoga is workout', M.calSportBucket_({sportType:'Yoga'}), 'workout');
check('a blank-sportType .fit import is a RIDE, not other', M.calSportBucket_({name:'3748577774.fit'}), 'ride');

// ---- the real week of 2026-07-27..08-02 (from /data/rides): 1 strength, 1 vride, 1 run ----
const WEEK = [
  { sportType:'WeightTraining', date:'2026-07-27', distance:0,   duration:'0:50:02', movingSecs:3002, tss:0 },
  { sportType:'VirtualRide',    date:'2026-07-28', distance:15.1, duration:'0:44:25', movingSecs:2665, tss:52, elev:125 },
  { sportType:'Run',            date:'2026-07-29', distance:3.3,  duration:'0:35:56', movingSecs:2156, tss:100, maxElev:791,
    chartEle:[766,768,770,772,773,774,776,775,778,777,780,781,782,783,785,786,787,788,789,790,791,779,784,771,767,765,764,769] },
];
const roll = M.calRollup_(WEEK);
const rows = M.calSportRows_(roll);

console.log('\n=== real week (2026-07-27 .. 08-02) ===');
check('three buckets present', Object.keys(roll.bySport).sort(), ['ride','run','workout']);
check('no swim bucket invented', roll.bySport.swim===undefined, true);
check('ride miles', roll.bySport.ride.miles, 15.1);
check('run miles keep their decimal (3.3, not 3)', roll.bySport.run.miles, 3.3);
check('run elevation derives 37ft from the stream', roll.bySport.run.elev, 37);
check('run elevation is NOT maxElev 791', roll.bySport.run.elev===791, false);
check('strength contributes time but no distance', [roll.bySport.workout.miles, roll.bySport.workout.secs], [0, 3002]);
check('combined miles still 18 (15.1+3.3)', roll.miles, 18);
check('combined TSS still 152', roll.tss, 152);
check('combined secs = sum of the three', roll.secs, 3002+2665+2156);

console.log('\n=== the rendered lines ===');
check('row order is Ride, Run, Other', rows.map(r=>r.label), ['Ride','Run','Other']);
check('Ride line: distance / TSS / elevation', [rows[0].main, rows[0].sub], ['15.1 mi','52 TSS · 125 ft']);
check('Run line: distance / time / elevation',  [rows[1].main, rows[1].sub], ['3.3 mi','36m · 37 ft']);
check('Other line carries time as its headline', rows[2].main, '50m');

console.log('\n=== the breakdown reconciles with the total it sits under ===');
const sumMi = Object.keys(roll.bySport).reduce((a,k)=>a+roll.bySport[k].miles,0);
check('per-sport miles sum to the combined total', Math.round(sumMi), roll.miles);
const sumTss = Object.keys(roll.bySport).reduce((a,k)=>a+roll.bySport[k].tss,0);
check('per-sport TSS sums to the combined total', sumTss, roll.tss);
check('every activity lands in exactly one bucket',
  Object.keys(roll.bySport).reduce((a,k)=>a+roll.bySport[k].acts,0), roll.acts);

console.log('\n=== zero terms are dropped, never printed as a fact ===');
const noElev = M.calSportRows_(M.calRollup_([{sportType:'Run', distance:5, duration:'0:40:00', tss:0}]));
check('a run with no elevation data shows no "0 ft"', noElev[0].sub.indexOf('ft')<0, true);
check('and still shows its time', noElev[0].sub, '40m');
const noTss = M.calSportRows_(M.calRollup_([{sportType:'Ride', distance:20, duration:'1:00:00', elev:300}]));
check('a ride with no TSS shows no "0 TSS"', noTss[0].sub, '300 ft');
// An indoor/trainer week genuinely climbs nothing — say nothing, do not assert "0 ft".
const flatRide = M.calSportRows_(M.calRollup_([{sportType:'VirtualRide', distance:15, duration:'0:45:00', tss:52, elev:0}]));
check('a ride with zero elevation shows no "0 ft"', flatRide[0].sub, '52 TSS');
check('an empty week produces no rows at all', M.calSportRows_(M.calRollup_([])), []);

console.log('\n=== swim: distance and time only, per spec ===');
const swim = M.calSportRows_(M.calRollup_([{sportType:'Swim', distance:1.2, duration:'0:32:10', tss:40, elev:0}]));
check('swim main is distance', swim[0].main, '1.2 mi');
check('swim sub is time only — no TSS, no elevation', swim[0].sub, '32m');

console.log('\n=== a bucket with distance-less activities falls back to time ===');
const strengthOnly = M.calSportRows_(M.calRollup_([{sportType:'WeightTraining', distance:0, duration:'0:45:00'}]));
check('shows 45m rather than "0 mi"', strengthOnly[0].main, '45m');

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'cal-week-sport: all checks passed'+X));
process.exit(fails?1:0);
