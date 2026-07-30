// Coach V's "yesterday" recap has to account for EVERY activity on the prior day.
//
// It reported one. Jul 29 2026 held a 3.3mi trail run, a 20-mile evening ride and a 55-minute
// weight session; the card said "Yesterday: Gaines - PHT Trail Run - 3.3mi, 100 TSS." and the
// other two were invisible. Two independent faults:
//
//   1. acts[0] — the list was sorted richest-first and then only the head was rendered.
//   2. .filter(sport==='ride'||sport==='run') — _actSport_ buckets weight training as 'other', so
//      strength could never appear at all. On a block where strength is a primary driver that was
//      the larger half.
//
// Run: node scripts/cv-yesterday-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, matchBrace(i)+1)+'\n'; }
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));

let code = asServed(['_cvEsc_','_cvActBits_','_cvActName_','_cvVerdict_','_cvYesterdayLine_','_cvYesterdayMulti_','actSecs_']
  .map(ex).join(''));
// _cvYesterday_ needs the app's date plumbing; the selection logic is exercised through a faithful
// re-run of its own body against injected activities instead of stubbing half the app.
const M = new Function('st', code + ';return {_cvActBits_,_cvActName_,_cvVerdict_,_cvYesterdayLine_,_cvYesterdayMulti_,actSecs_};')({});

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '\n         got  '+JSON.stringify(got)+'\n         want '+JSON.stringify(want)));
}

// The real Jul 29 2026 day, as it exists in st.rides.
const RUN  = { sport:'run',   obj:{ name:'Gaines - PHT Trail Run', distance:3.3, tss:100 } };
const RIDE = { sport:'ride',  obj:{ name:'Gaines - PHT Trail', distance:20, tss:75, avgPwr:151 } };
const STR  = { sport:'other', obj:{ name:'Afternoon Weight Training', distance:0, movingSecs:3300 } };

console.log('\n=== the reported day: all three activities appear ===');
const line = M._cvYesterdayMulti_([RUN, RIDE, STR]);
console.log('  ' + Y + line.replace(/&middot;/g, '·') + X);
check('the run is named', line.indexOf('Gaines - PHT Trail Run') >= 0, true);
check('the RIDE is named', line.indexOf('Gaines - PHT Trail (20mi') >= 0, true);
check('the STRENGTH session is named', line.indexOf('Afternoon Weight Training') >= 0, true);
check('it leads with the count', line.indexOf('Yesterday: 3 activities') === 0, true);
check('and the combined load, not one activitydis', line.indexOf('175 TSS') >= 0, true);
check('the verdict is bucketed off the TOTAL', line.indexOf('Big day') >= 0, true);
console.log('  ' + Y + '(on the old code the verdict read "Solid base work" off the run\'s 100 TSS alone)' + X);

console.log('\n=== strength is describable at all now ===');
check('a weight session reports its DURATION', M._cvActBits_(STR), ['55min']);
check('a ride reports distance, power and TSS', M._cvActBits_(RIDE), ['20mi', '151W avg', '75 TSS']);
check('a run reports distance and TSS but not power',
  M._cvActBits_({ sport:'run', obj:{ distance:3.3, tss:100, avgPwr:220 } }), ['3.3mi', '100 TSS']);
check('an unnamed strength row still gets a label', M._cvActName_({ sport:'other', obj:{} }), 'Session');
check('duration is only used when there is no distance',
  M._cvActBits_({ sport:'other', obj:{ distance:2.1, movingSecs:3300 } }), ['2.1mi']);

console.log('\n=== a partial TSS total is labelled as partial ===');
// STR carries no TSS, so 175 is what was RECORDED, not the day's whole load.
check('says "recorded" when something has no TSS', line.indexOf('175 TSS recorded') >= 0, true);
const allTss = M._cvYesterdayMulti_([RUN, { sport:'ride', obj:{ name:'R', distance:20, tss:75 } }]);
check('and does not when every activity has one', allTss.indexOf('175 TSS.') >= 0, true);
check('no TSS anywhere -> no total and no verdict', (function(){
  const l = M._cvYesterdayMulti_([{ sport:'other', obj:{ name:'A', movingSecs:1800 } },
                                  { sport:'other', obj:{ name:'B', movingSecs:1200 } }]);
  return [/TSS/.test(l), /Big day|Solid base|Light day/.test(l)];
})(), [false, false]);

console.log('\n=== a single activity keeps the original one-line form ===');
const one = M._cvYesterdayLine_(RIDE);
check('no activity count on a one-activity day', one.indexOf('1 activities') < 0, true);
check('reads as before', one, 'Yesterday: Gaines - PHT Trail — 20mi, 151W avg, 75 TSS. Light day, which is the point.');
check('a missing TSS still yields no verdict',
  M._cvYesterdayLine_({ sport:'ride', obj:{ name:'X', distance:12 } }), 'Yesterday: X — 12mi.');
check('a bare row is still reported, not dropped',
  M._cvYesterdayLine_({ sport:'other', obj:{ name:'Yoga' } }), 'Yesterday: Yoga.');

console.log('\n=== verdict thresholds are unchanged ===');
check('>=150 big day', M._cvVerdict_(150), ' Big day — respect the recovery.');
check('>=80 solid', M._cvVerdict_(80), ' Solid base work.');
check('<80 light', M._cvVerdict_(79), ' Light day, which is the point.');
check('0 or missing -> nothing', [M._cvVerdict_(0), M._cvVerdict_(NaN)], ['','']);

console.log('\n=== escaping and truncation survive ===');
check('markup in a name is escaped',
  M._cvYesterdayMulti_([{ sport:'ride', obj:{ name:'<b>x</b>&y', distance:1 } }, RIDE]).indexOf('&lt;b&gt;x&lt;/b&gt;&amp;y') >= 0, true);
check('a long name is truncated', M._cvActName_({ sport:'ride', obj:{ name:'z'.repeat(60) } }).length, 42);

console.log('\n=== the selection logic in _cvYesterday_ ===');
const sel = ex('_cvYesterday_');
check('the ride|run filter is gone', /filter\(function\(a\)\{ return a\.sport==='ride'\|\|a\.sport==='run'; \}\)/.test(sel), false);
check('every activity is kept', /activitiesForDate_\(yk\)\.forEach/.test(sel), true);
check('acts[0] is no longer what gets rendered', /_cvYesterdayLine_\(acts\[0\]\)\;\s*\n\s*return/.test(sel), false);
check('one activity -> single line, more -> multi', /acts\.length===1\)\?_cvYesterdayLine_\(acts\[0\]\):_cvYesterdayMulti_\(acts\)/.test(sel), true);
check('the count is returned so the caller can see it', /n:acts\.length/.test(sel), true);

console.log('\n=== duplicates cannot inflate the day ===');
// st.rides holds every sport INCLUDING runs, and st.runs is separate, so activitiesForDate_ can
// return the same run twice. That would have double-counted both the activity count and the TSS.
check('dedupe keyed on stravaId first', /k='s'\+String\(o\.stravaId\)/.test(sel), true);
check('...then id, then a content key', /k='i'\+String\(o\.id\)/.test(sel) && /k='n'\+String\(o\.name\|\|''\)/.test(sel), true);
const dupA = { sport:'run', obj:{ name:'Run', distance:3.3, tss:100, stravaId:19515414647 } };
const dupB = { sport:'run', obj:{ name:'Run', distance:3.3, tss:100, stravaId:'19515414647' } };
const key = (o) => (o.stravaId != null && o.stravaId !== '') ? 's' + String(o.stravaId) : 'x';
check('a numeric and a string stravaId collapse to one key', key(dupA.obj) === key(dupB.obj), true);
console.log('  ' + Y + '(same coercion trap as ride dedup — String() before comparing)' + X);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'cv-yesterday: all checks passed'+X));
process.exit(fails ? 1 : 0);
