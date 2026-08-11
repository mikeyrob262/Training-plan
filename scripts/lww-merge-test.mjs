// Settings-style scalars must be last-write-wins, not max-wins.
//
// mergeState_ resolves two numbers with Math.max. Correct for a clock or a migration
// counter; wrong for every user-set value, which it makes ONE-WAY. FTP could be raised and
// never lowered: typing 183 over 190 merged back to 190 and pushed it. Both directions were
// blocked (the 5s poll merges remote into local; fbPush merges remote into local BEFORE the
// PUT), so there was no route through the UI either.
//
// The load-bearing case is the STALE DEVICE: a browser holding an old FTP in localStorage
// must not be able to push it back up over a legitimately lower value. That is the last
// section here, and it simulates the full poll -> merge -> push cycle rather than a single
// merge call.
//
// Run: node scripts/lww-merge-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exVar(n){ const i=src.indexOf('var '+n+' ='); const j=(i<0)?src.indexOf('var '+n+'='):i; if(j<0) throw new Error('missing var '+n);
  // spans to the line whose bracket depth returns to 0
  let k=j, d=0, started=false;
  for(;k<src.length;k++){ const c=src[k]; if(c==='['||c==='{'){d++;started=true;} else if(c===']'||c==='}'){d--;} else if(c===';'&&(!started||d===0)) break; }
  return src.slice(j, k+1)+'\n';
}

let code = exVar('_LWW_TOP') + exVar('_LWW_SUB') + 'var _lwwShadow_ = null;\nvar st = {};\n';
// _LWW_ARRAYS and its helpers were NOT in this harness, so the array branch of mergeStateRoot_
// threw and fell into the catch on every run - the settings-array behaviour was never actually
// exercised here, only the scalar paths above it.
code += exVar('_LWW_ARRAYS');
for (const f of ['_lwwPaths_','_lwwGet_','_lwwSet_','mergeStateRoot_','_lwwSnapshot_','_lwwTouch_',
                 'mergeState_','isPlainObj_','arrayToIndexObject_','mergeArrays_',
                 '_arrKeyOf_','_arrIsDead_','_lwwMergeArray_','mergeItemFast_','lightFingerprint_',
                 'itemsMatch_','rideKey','_isSession_','normDate']) code += ex(f);
const M = new Function(code +
  ';return {mergeState_,mergeStateRoot_,_lwwTouch_,_lwwPaths_,setSt:function(v){st=v;},getSt:function(){return st;}};')();

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

console.log('\n=== the reported bug: FTP could not be lowered ===');
const older = 1000, newer = 2000;
check('remote 183 is newer than local 190 -> 183 wins',
  M.mergeStateRoot_({ ftp:190, lastUpdate:older }, { ftp:183, lastUpdate:newer }).ftp, 183);
check('local 183 is newer than remote 190 -> 183 still wins',
  M.mergeStateRoot_({ ftp:183, lastUpdate:newer }, { ftp:190, lastUpdate:older }).ftp, 183);
check('the contaminated 230 no longer sticks',
  M.mergeStateRoot_({ ftp:230, lastUpdate:older }, { ftp:183, lastUpdate:newer }).ftp, 183);
check('raising still works (it was never the broken direction)',
  M.mergeStateRoot_({ ftp:183, lastUpdate:older }, { ftp:200, lastUpdate:newer }).ftp, 200);
check('a tie keeps the local edit', M.mergeStateRoot_({ ftp:183, lastUpdate:500 }, { ftp:190, lastUpdate:500 }).ftp, 183);

console.log('\n=== plain mergeState_ is UNCHANGED (it still merges ride items) ===');
check('numbers outside the allowlist still take max', M.mergeState_({ elev:100 }, { elev:250 }).elev, 250);
check('and max still applies inside ride items', M.mergeState_({ peak20:210 }, { peak20:240 }).peak20, 240);
check('mergeState_ alone still cannot lower ftp (proving the fix is in the wrapper)',
  M.mergeState_({ ftp:230 }, { ftp:183 }).ftp, 230);

console.log('\n=== every allowlisted field, lowered ===');
const LOW = { ftp:183, weight:'159', maxHR:168, restingHR:48, vo2max:44, calBaseline:2000,
              protBaseline:150, yearlyMileageGoal:4000, wxTempF:61, stravaAthleteId:9353779,
              goalTargets:{ annualMi:4000, ctl:55, ftpW:190, weeklyMi:80, weightLb:145, wkg:2.9 },
              settings:{ lastCTL:41.2, lastATL:30.1, lastTSB:-12.7 }, lastUpdate:newer };
const HIGH = { ftp:190, weight:'160', maxHR:172, restingHR:55, vo2max:48, calBaseline:2200,
               protBaseline:160, yearlyMileageGoal:5000, wxTempF:98, stravaAthleteId:9353779,
               goalTargets:{ annualMi:5000, ctl:65, ftpW:200, weeklyMi:100, weightLb:150, wkg:3.14 },
               settings:{ lastCTL:58.3, lastATL:86.2, lastTSB:-5.4 }, lastUpdate:older };
const lowered = M.mergeStateRoot_(LOW, HIGH);
for (const k of ['ftp','maxHR','restingHR','vo2max','calBaseline','protBaseline','yearlyMileageGoal','wxTempF'])
  check('top-level ' + k, lowered[k], LOW[k]);
check('weight (a STRING, so it never hit max - covered anyway)', lowered.weight, '159');
for (const k of Object.keys(LOW.goalTargets)) check('goalTargets.' + k, lowered.goalTargets[k], LOW.goalTargets[k]);
for (const k of Object.keys(LOW.settings)) check('settings.' + k, lowered.settings[k], LOW.settings[k]);
console.log('  ' + Y + 'note: restingHR and lastTSB are cases where DOWN is the improvement,' + X);
console.log('  ' + Y + 'so max-merge made the good direction unrepresentable.' + X);

console.log('\n=== fields deliberately left on max ===');
check('lastUpdate stays max (it is the clock this mechanism reads)',
  M.mergeStateRoot_({ lastUpdate:older }, { lastUpdate:newer }).lastUpdate, newer);
check('_planMig never runs backwards', M.mergeStateRoot_({ _planMig:2, lastUpdate:newer }, { _planMig:1, lastUpdate:older })._planMig, 2);
check('fitSeriesAt stays max', M.mergeStateRoot_({ fitSeriesAt:9, lastUpdate:newer }, { fitSeriesAt:11, lastUpdate:older }).fitSeriesAt, 11);
check('athleteStats totals stay max',
  M.mergeStateRoot_({ athleteStats:{rideCount:600}, lastUpdate:newer }, { athleteStats:{rideCount:610}, lastUpdate:older }).athleteStats.rideCount, 610);

console.log('\n=== present-vs-absent is never a contest (cannot blank a value) ===');
check('remote lacks ftp -> local kept', M.mergeStateRoot_({ ftp:183, lastUpdate:older }, { lastUpdate:newer }).ftp, 183);
check('local lacks ftp -> remote kept', M.mergeStateRoot_({ lastUpdate:newer }, { ftp:183, lastUpdate:older }).ftp, 183);
check('remote null does not erase', M.mergeStateRoot_({ ftp:183, lastUpdate:older }, { ftp:null, lastUpdate:newer }).ftp, 183);
check('remote empty string does not erase', M.mergeStateRoot_({ ftp:183, lastUpdate:older }, { ftp:'', lastUpdate:newer }).ftp, 183);
check('neither side has it -> stays absent', M.mergeStateRoot_({ lastUpdate:older }, { lastUpdate:newer }).ftp, undefined);
check('missing clocks on both sides still merges', M.mergeStateRoot_({ ftp:183 }, { ftp:190 }).ftp, 183);

console.log('\n=== _lwwTouch_: a LOCAL edit advances the clock, an adopted value does not ===');
M.setSt({ ftp:190, goalTargets:{ ctl:65 } });
M._lwwTouch_();                                    // seed the shadow
check('no change -> no touch', M._lwwTouch_(), false);
M.getSt().ftp = 183;
check('a local FTP edit -> touch', M._lwwTouch_(), true);
check('and it is consumed once', M._lwwTouch_(), false);
M.getSt().goalTargets.ctl = 55;
check('a nested goal edit -> touch', M._lwwTouch_(), true);
M.getSt().rides = [1,2,3];
check('a non-allowlisted change -> no touch', M._lwwTouch_(), false);

console.log('\n=== THE REAL PROOF: a stale device cannot push an old FTP back up ===');
// Full cycle, the way the app runs it:
//   cloud legitimately set to 183 at t=3000
//   a browser has been sitting on ftp 190 in localStorage since t=1000
//   it wakes, polls (applyFirebaseData), then saves (fbPush merges remote first, then PUTs)
let cloud = { ftp:190, lastUpdate:1000 };
console.log('  t=1000  both sides at 190');
cloud = { ftp:183, lastUpdate:3000 };
console.log('  t=3000  FTP legitimately corrected to 183 in the cloud');
let stale = { ftp:190, lastUpdate:1000 };
console.log('  t=3000  stale tab still holds ftp=190, lastUpdate=1000');

// 1. the 5s poll: applyFirebaseData -> mergeStateRoot_(st, remote)
stale = M.mergeStateRoot_(stale, cloud);
check('after the poll the stale tab shows 183', stale.ftp, 183);

// 2. the tab then saves: fbPush re-reads remote, merges, PUTs with a fresh clock
let merged = M.mergeStateRoot_(stale, cloud);
let pushed = Object.assign({}, merged, { lastUpdate: 4000 });
check('and what it PUSHES is 183, not 190', pushed.ftp, 183);
cloud = pushed;
check('so the cloud still reads 183 afterwards', cloud.ftp, 183);

// 3. the nastiest variant: the tab never polls first and pushes straight from stale state
let stale2 = { ftp:190, lastUpdate:1000 };
let direct = M.mergeStateRoot_(stale2, { ftp:183, lastUpdate:3000 });
check('a blind push from stale state ALSO yields 183', direct.ftp, 183);

// 4. under the OLD rule every one of those was 190
check('(old behaviour, for contrast)', M.mergeState_({ ftp:190 }, { ftp:183 }).ftp, 190);

console.log('\n=== and a genuine local edit still beats a stale cloud ===');
M.setSt({ ftp:183, lastUpdate:1000 });
M._lwwTouch_();
M.getSt().ftp = 175;                                  // user types 175 in Settings
if (M._lwwTouch_()) M.getSt().lastUpdate = 5000;      // saveLocal_ stamps the clock
const afterEdit = M.mergeStateRoot_(M.getSt(), { ftp:183, lastUpdate:3000 });
check('the fresh 175 survives the pre-push merge', afterEdit.ftp, 175);
console.log('  ' + Y + '(without the saveLocal_ stamp this returns 183 - the edit would vanish)' + X);
const noStamp = M.mergeStateRoot_({ ftp:175, lastUpdate:1000 }, { ftp:183, lastUpdate:3000 });
check('...confirmed: unstamped, the edit is lost', noStamp.ftp, 183);

console.log('\n'+Y+'=== a number can be LOWERED and survive the round trip ==='+X);
// THE BUG: mergeState_ resolves two numbers with Math.max, so an item field could be raised but
// never lowered. Reverting a race distance 13.1 -> 6.2 wrote cleanly, synced, and came back 13.1.
{
  const local  = { lastUpdate: 2000, races: [{ id:'r1', name:'Race', date:'2026-10-18', distance:6.2 }] };
  const remote = { lastUpdate: 1000, races: [{ id:'r1', name:'Race', date:'2026-10-18', distance:13.1 }] };
  const out = M.mergeStateRoot_(local, remote);
  check('a LOWER distance from the newer side wins', out.races[0].distance, 6.2);
}
{
  const local  = { lastUpdate: 1000, races: [{ id:'r1', name:'Race', date:'2026-10-18', distance:6.2 }] };
  const remote = { lastUpdate: 2000, races: [{ id:'r1', name:'Race', date:'2026-10-18', distance:13.1 }] };
  const out = M.mergeStateRoot_(local, remote);
  check('...and a HIGHER one still wins when IT is the newer side', out.races[0].distance, 13.1);
}
{
  const local  = { lastUpdate: 2000, races: [{ id:'r1', deleted:true, _k:'r1' }] };
  const remote = { lastUpdate: 9000, races: [{ id:'r1', name:'Race', date:'2026-10-18', distance:13.1 }] };
  const out = M.mergeStateRoot_(local, remote);
  check('a tombstone beats a live copy even from a NEWER blob', !!out.races[0].deleted, true);
}
{
  const local  = { lastUpdate: 2000, races: [{ id:'r1', name:'A', date:'2026-10-18' }] };
  const remote = { lastUpdate: 1000, races: [{ id:'r2', name:'B', date:'2026-11-07' }] };
  const out = M.mergeStateRoot_(local, remote);
  check('a race present on only one side survives', out.races.map(r=>r.id).sort(), ['r1','r2']);
}
{
  // The monotonic fields must NOT have been dragged into this - max IS correct for clocks.
  const local  = { lastUpdate: 2000, fitSeriesAt: 500, races: [] };
  const remote = { lastUpdate: 1000, fitSeriesAt: 900, races: [] };
  const out = M.mergeStateRoot_(local, remote);
  check('fitSeriesAt is still max-merged', out.fitSeriesAt, 900);
}
check('races is on the array allowlist', src.indexOf("races:{ keys:['id'] }") >= 0, true);
check('rides are deliberately NOT on it', /_LWW_ARRAYS[^;]*rides:/.test(src), false);
check('...and the reason is recorded', src.indexOf('RIDES ARE DELIBERATELY NOT HERE') >= 0, true);

console.log('\n=== the wiring is actually in place ===');
check('the 5s poll uses the root merge', /applyFirebaseData[\s\S]{0,1200}?mergeStateRoot_\(st,/.test(src), true);
check('no root sync site still calls the bare mergeState_',
  /normalizeState_\(mergeState_\(st, preNormalizeRemoteArrays_/.test(src), false);
check('all three sync sites converted', (src.match(/mergeStateRoot_\(st, preNormalizeRemoteArrays_/g)||[]).length, 3);
check('saveLocal_ stamps the clock on a local edit', /_lwwTouch_\(\)\) st\.lastUpdate = Date\.now\(\)/.test(src), true);
check('ride-item merges still use the plain mergeState_', /var merged=mergeState_\(a, b\)/.test(src), true);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'lww-merge: all checks passed'+X));
process.exit(fails ? 1 : 0);
