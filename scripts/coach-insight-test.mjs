// AI Coach Insight prompt test.
//
// Guards the three defects behind "35-Minute Flat Ride at High Intensity" on a trail run:
//   1. "Ride"  — the prompt hardcoded the noun and a cycling-coach persona, but st.rides mixes
//                every sport (only 234 of 643 live activities are actually rides).
//   2. "Flat / zero elevation gain" — the prompt read ONLY r.elev and emitted `(r.elev||0)`, so a
//                missing field became the asserted fact "Elevation gain: 0ft".
//   3. Cycling FTP framing applied to running watts ("above FTP of 190W ... zone 4 to 5").
//
// Extracts the real closure from worker.js and asserts on the prompt actually sent to the model.
// Run: node scripts/coach-insight-test.mjs
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
function extractVar(name){
  const idx=src.indexOf('var '+name+'=');
  if(idx<0) throw new Error('var not found in worker.js: '+name);
  const end=src.indexOf('\n', idx);
  return src.slice(idx, end)+'\n';
}

// The cache helpers are new dependencies of fetchRideCoachInsight: the insight is now keyed on a
// hash of the PROMPT so a ride settles on ONE verdict instead of regenerating on every render.
// Without them here the function throws ReferenceError before it ever builds a prompt — a missing
// extraction, not a behaviour change (the same way the .zwo harness failed).
const CLOSURE = ['rideSport_','_actElevGain_','_actProfile_','_ridePrescriptionFor_','_insightSuppressDeficit_','_ciHash_','_ciMap_','_ciGet_','_ciPut_','fetchRideCoachInsight'];
let code='';
// _CI_MAX/_CI_LS/_CI_INFLIGHT share one var statement, so extracting the first takes all three.
for(const v of ['_CV_BASE_INTENTS','_CV_DEFICIT_RE','_CV_STEADY_RE','_CI_MAX']) code+=extractVar(v);
for(const f of CLOSURE) code+=extract(f);

// ---- harness: capture the prompt instead of calling the proxy ----
let lastPrompt=null;
const sandbox = {
  st:{ ftp:190, maxHR:172 },
  SESSION_DEFS:{ z2:{name:'Endurance', type:'ride', note:'sit in zone 2'} },
  normDate:(d)=>d,
  blockPlanFor_:()=>({ sessions:[{ intent:'z2', rx:{ targets:{ powerLo:150, powerHi:180, zone:'Z2' } } }] }),
  fetch:(_u,opt)=>{ lastPrompt=JSON.parse(opt.body).messages[0].content; return Promise.resolve({ json:()=>Promise.resolve({content:[{text:'Headline here\n- a bullet\nRecommendation: none'}]}) }); },
  AbortController:function(){ this.signal={}; this.abort=()=>{}; },
  setTimeout:()=>0, clearTimeout:()=>{},
};
const fn = new Function(...Object.keys(sandbox), code + '\n;return {_actElevGain_,_actProfile_,_insightSuppressDeficit_,fetchRideCoachInsight,_ciHash_,_CI_INFLIGHT};');
const M = fn(...Object.values(sandbox));

// Concurrent renders of the same prompt now collapse onto one request, and a settled verdict is
// cached. Both are keyed on the prompt hash, so a test that asks for the SAME prompt twice would
// otherwise get no second call. Clear the in-flight map per capture; the cache itself is already
// inert here because localStorage does not exist in this sandbox.
const promptFor = (r) => {
  lastPrompt=null;
  Object.keys(M._CI_INFLIGHT).forEach(k=>{ delete M._CI_INFLIGHT[k]; });
  M.fetchRideCoachInsight(r, ()=>{});
  if(lastPrompt==null) throw new Error('no prompt captured');
  return lastPrompt;
};

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
const has = (s,sub)=>s.indexOf(sub)>=0;

// ---- fixture: the real 2026-07-29 activity, verbatim from /data/rides ----
// No elev, no elevation, no total_elevation_gain. maxElev 791 is the ROUTE HIGH POINT.
// The 28-point stream ranges 764..791 and sums to 37ft of actual climbing.
const TRAIL_RUN = {
  name:'Gaines - PHT Trail Run', date:'2026-07-29', sportType:'Run',
  distance:3.3, duration:'0:35:56', pace:'11:03',
  avgPwr:244.5, np:245, avgHR:141, maxHR:152, tss:100, ifPct:129, maxElev:791,
  chartEle:[766,768,770,772,773,774,776,775,778,777,780,781,782,783,785,786,787,788,789,790,791,779,784,771,767,765,764,769],
};
const REAL_RIDE = { name:'Afternoon Ride', date:'2025-10-09', sportType:'Ride', type:'Ride',
  distance:31.1, duration:'1:52:53', elev:797, maxElev:797, avgPwr:132, np:162, avgHR:138, tss:121 };

console.log('\n=== _actElevGain_: gain is climbing, never max altitude ===');
check('derives 37ft of real climbing from the stream', M._actElevGain_(TRAIL_RUN), 37);
check('never reports maxElev as gain', M._actElevGain_(TRAIL_RUN)===791, false);
check('maxElev alone, no stream -> null (unknown), not 791 and not 0', M._actElevGain_({maxElev:791}), null);
check('nothing at all -> null, NOT 0', M._actElevGain_({}), null);
check('prefers the r.elev summary field', M._actElevGain_({elev:797, chartEle:[100,200]}), 797);
check('reads the runs-library r.elevation shape', M._actElevGain_({elevation:804}), 804);
check('reads total_elevation_gain', M._actElevGain_({total_elevation_gain:250}), 250);
check('an explicit recorded 0 stays 0 (indoor)', M._actElevGain_({elev:0}), 0);
// positive deltas only: 10->20 is +10, 20->15 is a descent, 15->25 is +10 => 20ft climbed
check('an explicit 0 is refined by a stream that disagrees', M._actElevGain_({elev:0, chartEle:[10,20,15,25]}), 20);

console.log('\n=== _actProfile_: st.rides is not all rides ===');
check('Run -> run / not cycling power', [M._actProfile_(TRAIL_RUN).noun, M._actProfile_(TRAIL_RUN).cyclingPower], ['run', false]);
check('Run -> running coach', M._actProfile_(TRAIL_RUN).persona, 'running coach');
check('Ride -> ride / cycling power', [M._actProfile_(REAL_RIDE).noun, M._actProfile_(REAL_RIDE).cyclingPower], ['ride', true]);
check('VirtualRide is still cycling', M._actProfile_({sportType:'VirtualRide'}).cyclingPower, true);
check('TrailRun resolves to run', M._actProfile_({sportType:'TrailRun'}).noun, 'run');
check('WeightTraining -> strength session', M._actProfile_({sportType:'WeightTraining'}).noun, 'strength session');
check('Walk -> walk, not ride', M._actProfile_({sportType:'Walk'}).noun, 'walk');
check('falls back to type when sportType is absent', M._actProfile_({type:'Ride'}).cyclingPower, true);
check('unknown sport never claims to be a ride', M._actProfile_({sportType:'Pickleball'}).cyclingPower, false);

console.log('\n=== the run prompt (the reported bug) ===');
const pRun = promptFor(TRAIL_RUN);
check('calls it a Run', has(pRun,'Run: 3.3 miles'), true);
check('never opens with "Ride:"', has(pRun,'Ride: 3.3'), false);
check('uses a running coach persona', has(pRun,'running coach'), true);
check('never a cycling coach', has(pRun,'cycling coach'), false);
check('states the real 37ft of gain', has(pRun,'Elevation gain: 37ft'), true);
check('NEVER asserts "Elevation gain: 0ft"', has(pRun,'Elevation gain: 0ft'), false);
check('labels 791ft as altitude, not climbing', has(pRun,'altitude, not climbing'), true);
check('forbids comparing run watts to cycling FTP', has(pRun,'NOT comparable to a cycling FTP'), true);
check('does not hand the model an FTP band to judge against', has(pRun,'FTP: 190W'), false);
check('passes pace, the metric that matters for a run', has(pRun,'Pace: 11:03'), true);
check('forbids terrain adjectives without a number', has(pRun,'Do not call the terrain flat'), true);
check('a cycling power prescription never grades a run', has(pRun,'Prescription:'), false);
// The activity card is now a BRIEF summary — the "Recommendation: No prescription on file for this
// run" closing line moved to Dr. Smurkel's full debrief on the Plan page, so this can no longer
// anchor on it. The intent it guarded is unchanged: the no-prescription branch must call a run a
// run. Anchor on the instruction that still carries the noun.
check('the no-prescription branch says run, not ride', has(pRun,'completed run'), true);
check('the activity card asks for a SHORT summary, not the full treatment', has(pRun,'EXACTLY 2 short'), true);
check('...and does not ask for next-session advice here', has(pRun,'Recommendation: '), false);

console.log('\n=== elevation genuinely unrecorded ===');
const pNoElev = promptFor({sportType:'Run', distance:5, duration:'0:40:00'});
check('says not recorded', has(pNoElev,'Elevation gain: not recorded'), true);
check('still never says 0ft', has(pNoElev,'Elevation gain: 0ft'), false);

console.log('\n=== rides are unchanged ===');
const pRide = promptFor(REAL_RIDE);
check('still a ride', has(pRide,'Ride: 31.1 miles'), true);
check('still gets the FTP frame', has(pRide,'FTP: 190W'), true);
check('rides DO reach the prescription branch', has(pRide,'Prescription: Endurance'), true);
check('the anti-fabrication rule applies to rides too', has(pRide,'Describe ONLY what the data above states'), true);
check('gain comes from r.elev', has(pRide,'Elevation gain: 797ft'), true);

console.log('\n=== output filter keeps the sport ===');
const NL=String.fromCharCode(10);
check('deficit headline on a run degrades to "Run logged as recorded."',
  M._insightSuppressDeficit_('Left power on the table'+NL+'- a bullet', true, null, 'run').split(NL)[0],
  'Run logged as recorded.');
check('and to "Ride logged as recorded." for a ride',
  M._insightSuppressDeficit_('Left power on the table'+NL+'- a bullet', true, null, 'ride').split(NL)[0],
  'Ride logged as recorded.');

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'coach-insight: all checks passed'+X));
process.exit(fails?1:0);
