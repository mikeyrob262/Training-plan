// Distance-PR layer: the in-ride split that replaces the banded whole-ride estimate.
//
// The thing most worth testing here is NOT that it produces a number - it is that the number is the
// BEST window inside the ride rather than the first one, and that a ride which never reaches a
// marker records nothing for it instead of a plausible-looking value. Everything executable runs in
// its SERVED form, because a \d in source is served as d and source-form testing has passed a bug
// that shipped before.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exv(name){ const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name);
  const j=src.indexOf('\n', i); return src.slice(i, j)+'\n'; }
const codeLines = src.split(/\r?\n/).filter(L => !/^\s*\/\//.test(L));

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(label,cond)=>{ if(!cond)fails++; console.log('  '+(cond?G+'PASS'+X:R+'FAIL'+X)+'  '+label); };

const H = new Function(asServed(exv('DPR_VERSION')+exv('DPR_MARKERS_KM')+ex('dprFromStreams_')+ex('dprResolution_'))
  + ';return {dprFromStreams_,dprResolution_,DPR_MARKERS_KM,DPR_VERSION};')();

console.log('\n'+C+'=== the best window in the ride, not the first ==='+X);
// 10 km at a steady 10 m/s = 1000s, EXCEPT one stretch ridden at 20 m/s. The fast stretch is in the
// middle, so a naive "first window" or "whole ride" reading would miss it entirely.
(function(){
  const dist=[], time=[];
  let d=0;
  for(let t=0;t<=3000;t++){
    const fast = (t>=1000 && t<1500);           // 500s at double speed
    d += fast ? 20 : 10;
    dist.push(d); time.push(t+1);
  }
  const m=H.dprFromStreams_(dist,time);
  // the 5km best must sit inside the fast stretch: 5000m at 20m/s = 250s
  check('5km finds the fast middle stretch, not the steady average', m['5'], 250);
  // 1km at 20m/s = 50s
  check('1km likewise', m['1'], 50);
  // 20km cannot be all-fast: 500s of fast covers 10000m, remaining 10000m at 10m/s = 1000s
  check('20km spans fast + steady and is longer than 2x the 10km', m['20'] > 2*m['10'], true);
})();

console.log('\n'+C+'=== a marker the ride never reaches records NOTHING ==='+X);
(function(){
  const dist=[], time=[];
  let d=0;
  for(let t=0;t<=600;t++){ d+=10; dist.push(d); time.push(t+1); }   // 6 km total
  const m=H.dprFromStreams_(dist,time);
  ok('5km is recorded on a 6km ride', m['5']>0);
  check('10km is absent, not zero and not an estimate', m['10'], undefined);
  check('160km is absent too', m['160'], undefined);
  check('...so the marker set holds only what was actually ridden', Object.keys(m), ['1','5']);
})();

console.log('\n'+C+'=== elapsed time, stops included ==='+X);
(function(){
  // 1 km at 10 m/s, but with a 300-second stop in the middle. Strava's time stream carries the stop
  // as a gap, so the elapsed window must include it - a distance PR is the clock, not moving time.
  // Start at 0m/0s: a window needs dist[j]-dist[i] >= 1000, so a ride whose LAST sample is exactly
  // 1000 m only spans a full km if there is a zero point to measure from.
  const dist=[0], time=[0];
  let d=0, t=0;
  for(let i=0;i<50;i++){ d+=10; dist.push(d); time.push(++t); }     // 500 m by t=50
  t+=300;                                                           // stopped at the lights
  for(let i=0;i<50;i++){ d+=10; dist.push(d); time.push(++t); }     // 1000 m by t=400
  const m=H.dprFromStreams_(dist,time);
  // Moving time would be 100s. Elapsed is 400s, and elapsed is what a distance PR means.
  check('the 1km window carries the stop, not just the moving time', m['1'], 400);
})();

console.log('\n'+C+'=== degenerate input never invents a record ==='+X);
check('no streams -> null', H.dprFromStreams_(null,null), null);
check('one point -> null', H.dprFromStreams_([0],[0]), null);
check('empty -> null', H.dprFromStreams_([],[]), null);
check('a stationary ride records nothing', H.dprFromStreams_([0,0,0,0],[1,2,3,4]), {});
// Mismatched lengths must not read past the end of the shorter array.
ok('mismatched lengths are truncated, not read past', (() => {
  const m=H.dprFromStreams_([0,1000,2000,3000,4000,5000],[1,2,3]);
  return m && typeof m==='object';
})());

console.log('\n'+C+'=== resolution is recorded, because it decides whether the number is real ==='+X);
check('1 Hz stream reports 1s spacing', H.dprResolution_([0,1,2,3,4,5,6]), 1);
check('a downsampled 200-point series reports its real spacing', H.dprResolution_([0,82,164,246,328]), 82);
check('too short to judge -> null', H.dprResolution_([0]), null);

console.log('\n'+C+'=== stored per ride, derived at read time ==='+X);
const board = ex('dprBoard_');
ok('the board is computed from the rides, not from a stored aggregate',
   !/st\.dprBest|st\.dprBoard|st\.dprRecords/.test(src));
ok('...and returns the whole progression, which Milestones needs',
   /progression:prog/.test(board));
ok('...appending only on an improvement', /best===null \|\| secs<best\.secs/.test(board));
ok('...in chronological order', /localeCompare/.test(board));
ok('the board is version-gated, so two formulas never share one board',
   /r\.dpr\.v===DPR_VERSION/.test(board));
ok('every stored dpr carries its version', /v:DPR_VERSION/.test(src));
// The denominators. A records board that cannot say what it measured over is the thing this app
// keeps getting wrong.
ok('the board reports how many rides were measured', /measuredN:/.test(board));
ok('...how many are still pending', /pendingN:/.test(board));
ok('...and how many can NEVER be measured, having no Strava id', /unfetchableN:/.test(board));
ok('...and how many reached each individual marker', /reached\+\+/.test(board));

console.log('\n'+C+'=== dpr survives storage slimming ==='+X);
// A quota event stripping dpr would silently empty the boards and cost another rate-limited
// backfill to rebuild. The protection is ENFORCED, not just documented.
ok('there is an explicit keep-list', /var STORAGE_KEEP_FIELDS_=/.test(src));
ok('...containing dpr', /STORAGE_KEEP_FIELDS_=\[[^\]]*'dpr'/.test(src));
ok('...and the slimmer honours it', /STORAGE_KEEP_FIELDS_\.indexOf\(f\)>=0\) continue/.test(ex('slimForStorage_')));
// Behaviour: even if someone adds dpr to the heavy list, slimming must not remove it.
const SLIM = new Function('STORAGE_HEAVY_FIELDS_','STORAGE_KEEP_FIELDS_',
  asServed(ex('slimForStorage_'))+';return slimForStorage_;')(
  ['lats','dpr'], ['dpr','zoneTime','temp','tempSource']);
const slimmed = SLIM({ rides:[{ id:1, lats:[1,2,3], dpr:{v:1,m:{'40':3600}}, zoneTime:[1] }] });
check('dpr survives even when wrongly listed as heavy', slimmed.rides[0].dpr, {v:1,m:{'40':3600}});
check('...while a genuinely heavy field is still dropped', slimmed.rides[0].lats, undefined);

console.log('\n'+C+'=== the backfill is resumable and cannot re-do finished work ==='+X);
const run = ex('runDprBackfill'), needs = ex('dprNeeds_');
ok('a ride already carrying a current-version dpr is not a candidate', /r\.dpr && r\.dpr\.v===DPR_VERSION/.test(needs));
ok('...so resume is driven by the DATA, not only by a stored cursor', /filter\(dprNeeds_\)/.test(ex('dprCandidates_')));
ok('a cursor is still stored so a run can report where it stopped', /st\.dprCursor=/.test(run));
ok('progress is saved periodically, not only at the end', /got%25===0/.test(run));
ok('the run stops on a 429 rather than burning the window', /x\.status===429/.test(run));
ok('...and on an expired token', /x\.status===401/.test(run));
ok('it says how many are left when it stops', /still to do/.test(run));
ok('only cycling rides with a Strava id are fetched', /!r\.stravaId\) return false/.test(needs));
// Every dpr must come from a fresh full-resolution fetch - mixing in the coarse stored series would
// bias every record, since a coarse ride can only ever OVER-state its best window.
ok('the fetch asks for distance and time', /keys=distance,time/.test(run));
ok('nothing is computed from the coarse stored chartDist', !/chartDist/.test(run));
ok('the source is stamped on the record', /src:'strava'/.test(run));

console.log(fails ? '\n'+R+'distance-PR: '+fails+' FAILED'+X+'\n' : '\n'+G+'distance-PR: all checks passed'+X+'\n');
process.exit(fails?1:0);
