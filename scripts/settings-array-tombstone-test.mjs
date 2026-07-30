// Deleting from a settings-level array has to SURVIVE a merge.
//
// mergeState_ unions arrays and returns the non-null side when one is missing, so a removal had no
// way to travel. Clearing st.weightLog locally and pushing merged the cloud's copy straight back;
// writing null server-side lost to any client still holding entries. The console one-liner
// "st.weightLog = null; saveLocal_(); fbPush()" could not have worked either - fbPush merges remote
// in BEFORE the PUT, and null loses that merge. Four rounds of hand-cleaning proved it the hard way.
//
// Fix: the same tombstone rides already use. A removed entry stays in the array as
// {<key>, deleted:true} with the VALUE FIELD DROPPED, which is what makes it invisible to the ~11
// existing readers that already filter on the value being present and finite.
//
// Run: node scripts/settings-array-tombstone-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exVar(n){ let j=src.indexOf('var '+n+' ='); if(j<0) j=src.indexOf('var '+n+'='); if(j<0) throw new Error('missing var '+n);
  let k=j, d=0, started=false;
  for(;k<src.length;k++){ const c=src[k]; if(c==='['||c==='{'){d++;started=true;} else if(c===']'||c==='}'){d--;} else if(c===';'&&(!started||d===0)) break; }
  return src.slice(j, k+1)+'\n'; }

let code = exVar('_LWW_TOP') + exVar('_LWW_SUB') + exVar('_LWW_ARRAYS') + 'var _lwwShadow_=null; var st={};\n';
for (const f of ['_arrKeyOf_','_arrIsDead_','settingsArrLive_','settingsArrRemove_','settingsArrClear_',
                 '_lwwMergeArray_','_lwwPaths_','_lwwGet_','_lwwSet_','mergeStateRoot_','_lwwSnapshot_','_lwwTouch_',
                 'mergeState_','isPlainObj_','arrayToIndexObject_','mergeArrays_']) code += ex(f);
const M = new Function(code + ';return {settingsArrLive_,settingsArrRemove_,settingsArrClear_,_lwwMergeArray_,'
  + 'mergeStateRoot_,mergeState_,_LWW_ARRAYS,setSt:function(v){st=v;},getSt:function(){return st;}};')();

let fails = 0;
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
const FAKE = [{date:'2025-09-01',weight:175},{date:'2026-01-01',weight:165},
              {date:'2026-04-01',weight:158},{date:'2026-07-01',weight:152}];
const older = 1000, newer = 2000;

console.log('\n=== the bug: why every clear came back ===');
check('a plain null loses to a client holding entries',
  M.mergeState_({ weightLog:null }, { weightLog:FAKE }).weightLog.length, 4);
check('...and in the other direction too',
  M.mergeState_({ weightLog:FAKE }, { weightLog:null }).weightLog.length, 4);
console.log('  ' + Y + '(this is exactly why "st.weightLog=null; fbPush()" could not work:' + X);
console.log('  ' + Y + ' fbPush merges remote in BEFORE the PUT, and null loses that merge)' + X);

console.log('\n=== a tombstone travels ===');
M.setSt({ weightLog: FAKE.slice() });
check('clearing tombstones every entry', M.settingsArrClear_('weightLog'), 4);
const stoned = M.getSt().weightLog;
check('the entries stay in the array', stoned.length, 4);
check('each carries its key and the deleted flag', stoned[0], { deleted:true, date:'2025-09-01' });
check('the VALUE field is dropped', 'weight' in stoned[0], false);
check('and nothing reads as live any more', M.settingsArrLive_('weightLog').length, 0);

console.log('\n=== the merge: a deletion beats a live copy from either side ===');
const spec = M._LWW_ARRAYS.weightLog;
check('local tombstones vs remote live -> deleted wins',
  M._lwwMergeArray_(spec, stoned, FAKE, true).every((x) => x.deleted), true);
check('remote tombstones vs local live -> deleted wins',
  M._lwwMergeArray_(spec, FAKE, stoned, false).every((x) => x.deleted), true);
check('...regardless of which blob is newer',
  M._lwwMergeArray_(spec, FAKE, stoned, true).every((x) => x.deleted), true);
check('through the full root merge',
  M.mergeStateRoot_({ weightLog:stoned, lastUpdate:older }, { weightLog:FAKE, lastUpdate:newer })
    .weightLog.filter((x) => !x.deleted).length, 0);

console.log('\n=== but additions still merge — this is NOT wholesale last-write-wins ===');
const devA = [{date:'2026-07-01',weight:152},{date:'2026-07-08',weight:151}];
const devB = [{date:'2026-07-01',weight:152},{date:'2026-07-15',weight:150}];
const both = M._lwwMergeArray_(spec, devA, devB, true);
check('two devices each adding a weigh-in keep both', both.map((x) => x.date),
  ['2026-07-01','2026-07-08','2026-07-15']);
check('no duplicate for the shared date', both.length, 3);
check('order is by key, so devices cannot disagree on it',
  both.map((x) => x.date), both.map((x) => x.date).slice().sort());
console.log('  ' + Y + '(wholesale LWW would have silently dropped one device\'s new weigh-in)' + X);

console.log('\n=== a re-logged value revives its tombstone ===');
const revived = M._lwwMergeArray_(spec, [{date:'2026-07-01',weight:149}], [{date:'2026-07-01',deleted:true}], false);
check('a tombstone still wins a straight merge', revived[0].deleted, true);
check('the revive path clears the flag instead of merging', /if\(existing\)\{ existing\.weight = num; if\(existing\.deleted\) delete existing\.deleted; \}/.test(src), true);
check('and ftpRecord_ does the same for a same-day correction', /same\.deleted\) delete same\.deleted/.test(src), true);

console.log('\n=== ftpHistory gets the same treatment ===');
const FH = [{date:'2026-07-25',ftp:190,source:'baseline'},{date:'2026-07-29',ftp:183,source:'manual'}];
const FHbad = FH.concat([{date:'2026-07-30',ftp:230,source:'manual'}]);
M.setSt({ ftpHistory: FHbad.slice() });
check('one bad entry can be removed on its own',
  M.settingsArrRemove_('ftpHistory', (h) => h.ftp === 230), 1);
check('the good entries are untouched', M.settingsArrLive_('ftpHistory').map((h) => h.ftp), [190,183]);
check('and the removal survives a stale client re-pushing it',
  M.mergeStateRoot_({ ftpHistory:M.getSt().ftpHistory, lastUpdate:older },
                    { ftpHistory:FHbad, lastUpdate:newer })
    .ftpHistory.filter((h) => !h.deleted).map((h) => h.ftp), [190,183]);

console.log('\n=== readers cannot trip over a tombstone ===');
check('a tombstone has no value field, so value-filters skip it',
  [{date:'a',deleted:true},{date:'b',weight:150}].filter((w) => w && w.date && w.weight != null).length, 1);
check('ftpOn_ reads the LIVE log', /var h=_ftpHistLive_\(\); dateStr=dateStr\|\|_ftpToday_\(\);/.test(src), true);
check('ftpRecord_ compares against the newest LIVE entry', /var sorted=_ftpSort_\(_ftpHistLive_\(\)\), last=/.test(src), true);
check('ftpSyncHistory_ reconciles against live entries', /var h=_ftpHistLive_\(\);\s*\n\s*if\(!h\.length\)\{ ftpRecord_\(cur,'baseline'\); return; \}/.test(src), true);
check('_ftpHist_ stays RAW for the mutating callers', /function _ftpHist_\(\)\{[^}]*return st\.ftpHistory; \}/.test(src), true);
check('the two latest-weigh-in tiles read live entries', (src.match(/settingsArrLive_\('weightLog'\)/g) || []).length, 2);
check('no display reader still calls the raw log', /\(typeof _ftpHist_==='function'\)\?_ftpHist_\(\)/.test(src), false);

console.log('\n=== the force-push escape hatch ===');
check('a button exists', /id="force-push-btn"/.test(src), true);
check('labelled as a last resort', /Last resort\. Replaces the cloud copy outright instead of merging/.test(src), true);
check('it confirms before doing anything', /uiConfirm\('This replaces the cloud copy with this device outright/.test(src), true);
check('...as a DANGER confirm, not a casual one', /danger:true, okText:'Overwrite'/.test(src), true);
// Ordering matters: the confirm has to be able to name real counts, so the cloud read must happen
// before it. Asserted on the force-push handler alone rather than the whole file.
const fpH = src.slice(src.indexOf("fb.onclick=function(){"), src.indexOf("}, 300);\n  // Update the sync dot"));
check('the handler reads the cloud before confirming',
  fpH.indexOf('fetch(fbAuthedUrl_(tok))') >= 0 && fpH.indexOf('fetch(fbAuthedUrl_(tok))') < fpH.indexOf('uiConfirm('), true);
check('and pushes only after the confirm resolves true',
  fpH.indexOf('uiConfirm(') < fpH.indexOf('fbPush(false, true,'), true);
check('and warns when the cloud holds MORE records than this device', /WARNING: the cloud has MORE/.test(src), true);
check('only then passes the force token', /fbPush\(false, true, 'FORCE-OVERWRITE-CONFIRMED', 'settings-force-push'\)/.test(src), true);
check('nothing is overwritten if the pre-read fails', /Could not read the cloud first, so nothing was overwritten/.test(src), true);
check('the token is still what fbPush demands', /confirmToken !== 'FORCE-OVERWRITE-CONFIRMED'/.test(src), true);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'settings-array-tombstone: all checks passed'+X));
process.exit(fails ? 1 : 0);
