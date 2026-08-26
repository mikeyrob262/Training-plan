// A SHORT EFFORT NEXT TO A LONG BLOCK IS NOT EVIDENCE OF A SHORTFALL.
//
// Reported on a 4x4 VO2: the last rep came back as 1:41 at 208W followed by a 13:49 block averaging
// 122W, and the debrief graded the session as a 3x4. The short rep fell outside the duration
// tolerance, was dropped, and three efforts were reported as though that were the whole session.
//
// The segmentation is Intervals.icu's, not ours - icu_intervals are power SURGES, not device laps -
// so a brief dip mid-effort can end one segment and start another. We were repeating their split as
// a finding of our own.
//
// This cannot prove the rep was completed: that needs the raw stream, and the stored streams run
// 57-129 points for a whole ride, roughly fifty seconds a sample. So the contract pinned here is the
// weaker, honest one - it must REFUSE TO GRADE rather than assert a shortfall it cannot see. The
// negative controls matter more than the positive: a genuinely short session must still not be
// dressed up as fine.
//
// Run: node scripts/interval-split-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails=0;
const ok=(l,c)=>{ if(!c) fails++; console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l); };
function body(n){ const i=src.indexOf('function '+n+'('); if(i<0) return null; let d=0;
  for(let j=src.indexOf('{',i);j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d) return src.slice(i,j+1);} } return null; }
const match=new Function('return '+body('_debriefMatch_'))();

const STEPS=[1,2,3,4].map(()=>({kind:'work', workMin:4, bandLo:201, bandHi:220}));
const W=(dur,watts)=>({type:'WORK',dur,watts,hr:150});
const REC=(dur,watts)=>({type:'RECOVERY',dur,watts,hr:130});

console.log('\n'+Y+'=== the reported session: 3 clean reps, then 1:41 beside a 13:49 block ==='+X);
{
  const all=[W(240,208),REC(180,105),W(240,210),REC(180,105),W(240,206),REC(180,105),W(101,208),REC(829,122)];
  const m=match(STEPS,{ work:all.filter(s=>s.type==='WORK'), all:all });
  ok('it refuses to grade', m.mapped===false);
  ok('...naming the split as the reason', m.reason==='split-effort');
  ok('...and carrying both segments so the reader can judge',
     m.split && m.split.shortSec===101 && m.split.nextSec===829 && m.split.nextWatts===122);
  const render=body('_debriefRender_');
  ok('the copy says it is neither a shortfall nor a completed set',
     /not a shortfall, and it is not a completed set/.test(render));
  ok('...and says where the segmentation comes from', /splits on power surges rather than on your laps/.test(render));
}

console.log('\n'+Y+'=== NEGATIVE CONTROLS: it must not excuse a session that really was short ==='+X);
{
  // Three reps and then nothing. No short WORK segment, no long block to hide a rep in.
  const all=[W(240,208),REC(180,105),W(240,210),REC(180,105),W(240,206),REC(300,95)];
  const m=match(STEPS,{ work:all.filter(s=>s.type==='WORK'), all:all });
  ok('three reps and a normal cool-down is NOT called a split', m.reason!=='split-effort');
  ok('...and is still not silently graded as a clean set', m.mapped===false);
}
{
  // A short rep followed by another SHORT recovery - no room for the rest of the effort.
  const all=[W(240,208),REC(180,105),W(240,210),REC(180,105),W(240,206),REC(180,105),W(101,208),REC(60,100)];
  const m=match(STEPS,{ work:all.filter(s=>s.type==='WORK'), all:all });
  ok('a short rep with no room after it is not called a split', m.reason!=='split-effort');
}
{
  // Two WORK segments back to back is a different question and must not be swallowed by this rule.
  const all=[W(240,208),REC(180,105),W(240,210),REC(180,105),W(240,206),REC(180,105),W(101,208),W(139,208)];
  const m=match(STEPS,{ work:all.filter(s=>s.type==='WORK'), all:all });
  ok('a WORK-WORK pair is not treated as a split effort', m.reason!=='split-effort');
}
{
  // A COMPLETE 4x4 must still grade normally - the fix must not stop the feature working.
  const all=[W(240,208),REC(180,105),W(240,210),REC(180,105),W(240,206),REC(180,105),W(242,209),REC(300,100)];
  const m=match(STEPS,{ work:all.filter(s=>s.type==='WORK'), all:all });
  ok('a clean 4x4 is still graded', m.mapped===true && m.pairs.length===4);
  ok('...with each rep scored against the band', m.pairs.every(p=>p.inBand===true));
}
{
  // Cached BEFORE the segment list existed: no `all`, so nothing can be looked at. It must say so
  // rather than fall through to grading N-1 as the session.
  const work=[W(240,208),W(240,210),W(240,206),W(101,208)];
  const m=match(STEPS,{ work:work });
  ok('with no segment list it reports unresolved', m.mapped===false && m.reason==='unresolved');
  ok('...and says how many it did see', m.near===3);
}

console.log('\n'+Y+'=== the segment list is actually captured ==='+X);
{
  const fetchFn=body('_icuFetchIntervals_');
  ok('every segment is kept, not only the WORK ones', /icu_intervals\.map\(/.test(fetchFn));
  ok('...with its type', /type:String\(v\.type/.test(fetchFn));
  ok('...and the cache is versioned so older entries are not mistaken for complete',
     /v:2, work:work, all:all/.test(fetchFn));
}
console.log('');
console.log(fails?(R+fails+' FAILED'+X):(G+'interval split: all checks passed'+X));
process.exit(fails?1:0);
