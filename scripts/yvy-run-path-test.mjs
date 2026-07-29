// You vs. You — run path + metric-coverage copy.
//
// Reported as "the Run filter shows 1 activity instead of the full 2,201-run history". The path
// was NOT the problem: getRuns serves 2,201 snapshot + live tail and the page had them in scope
// ("Sample: 2,202 runs"). What was broken was the SENTENCE explaining coverage. _yvyFieldWindow_
// returns two very different numbers — how many months CARRY a field (rankableMonths) vs how many
// sit inside the dense like-for-like window (inWindow) — and the UI quoted only the second while
// asserting the first as its cause: "1 of your 147 completed rankable run-months; earlier runs do
// not carry it." For pace that was false in both halves: 146 of 147 run-months carry pace.
//
// The copy functions are EXTRACTED, never reimplemented. A first version of this test rebuilt the
// sentence locally and passed against three mutations that left the shipped sentence wrong.
//
// Run: node scripts/yvy-run-path-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
function extractVar(name){ const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name); return src.slice(i, src.indexOf('\n', i))+'\n'; }

let code='';
for(const v of ['_YVY_MON','_YVY_RANK_MIN','_YVY_EVEN_PCT','_YVY_BASE','_YVY_GOOD','_YVY_DOWN']) code+=extractVar(v);
for(const f of ['_yvyYM_','_yvyDom_','_yvyAddMonth_','_yvyCalMonths_','_yvyMonLabel_','_yvyMonShort_',
                '_yvyFieldWindow_','_actElevGain_','_yvyElev_','_yvyBand_','_yvyFmtPace_','_yvyPct_',
                '_durSec_','_yvyPaceV_','_yvyCadV_','_yvyHrV_','_yvyAvgPwr_','_yvyNp_','_yvyTssV_',
                '_yvyPhys_','_yvyPhysKpi_','_yvyPhysRow_']) code+=extract(f);
const M=new Function('STORE_V2_RANKABLE_MIN',
  code+'\n;return {_yvyFieldWindow_,_yvyElev_,_yvyMonLabel_,_yvyPhys_,_yvyPhysRow_};')(4);

const txt = h => String(h).replace(/<[^>]+>/g,' ').replace(/&mdash;/g,'—').replace(/&middot;/g,'·')
  .replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

// ---- fixture reproducing the real run library's shape ----
// Dense monthly running 2013-01..2024-12 (144 months, 6 runs each), then the move to cycling:
// a sub-gate March 2025, ONE dense month (Aug 2025), and nothing since. That gap is what collapses
// the window walk to a single month while leaving ~145 months carrying the field.
function mkRuns(){
  const out=[];
  const push=(ym,n,extra)=>{ for(let i=1;i<=n;i++) out.push(Object.assign({date:ym+'-'+String(i).padStart(2,'0'), distance:5, movingSecs:2700, avgHR:150}, extra||{})); };
  for(let y=2013;y<=2024;y++) for(let m=1;m<=12;m++){
    const ym=y+'-'+String(m).padStart(2,'0');
    push(ym, 6, y>=2019?{cadence:170}:null);   // cadence starts 2019 — a REAL coverage gap
  }
  push('2025-03', 2, {cadence:170});
  push('2025-08', 6, {cadence:170});
  // ...and the single current-month run the real library has (Jul 2026). The coverage notes are
  // gated on the current month carrying the metric, so without it nothing renders to assert on —
  // which is also why the real page only shows these lines at all in a month with a run in it.
  out.push({date:'2026-07-29', distance:3.3, movingSecs:2156, avgHR:141, cadence:166});
  return out;
}
const RUNS=mkRuns();
// A continuously-dense cycling history, for the ride-path regression checks.
const CONT=[]; for(let y=2024;y<=2026;y++) for(let m=1;m<=12;m++){ const ym=y+'-'+String(m).padStart(2,'0');
  if(ym>'2026-06') continue; for(let i=1;i<=6;i++) CONT.push({date:ym+'-'+String(i).padStart(2,'0'), distance:20, movingSecs:3600, avgPwr:180, np:200, tss:60, avgHR:140}); }

const pace=r=>{ const mi=+r.distance||0, s=+r.movingSecs||0; return (mi>0.2&&s>60)?s/mi:null; };
const cad =r=>(r.cadence!=null?+r.cadence:null);

console.log('\n=== the two numbers _yvyFieldWindow_ returns are NOT the same number ===');
const wPace=M._yvyFieldWindow_(RUNS, pace, '2026-06');
const wCad =M._yvyFieldWindow_(RUNS, cad,  '2026-06');
check('pace is carried by 145 rankable months', wPace.rankableMonths, 145);
check('...but the dense window holds only 1', wPace.inWindow, 1);
check('the window anchors on the last dense month', wPace.start, '2025-08');
check('pace is carried from the very first rankable month', wPace.firstCarried, '2013-01');
check('cadence is carried by far fewer months', wCad.rankableMonths, 73);
check('cadence genuinely starts later — a REAL coverage gap', wCad.firstCarried, '2019-01');

console.log('\n=== firstCarried is what makes "not recorded before X" a true claim ===');
const fullStart='2013-01';
check('pace: no coverage gap to blame', wPace.firstCarried>fullStart, false);
check('cadence: a coverage gap that IS real', wCad.firstCarried>fullStart, true);
check('and it can be named', M._yvyMonLabel_(wCad.firstCarried), 'Jan 2019');

console.log('\n=== a continuous history keeps a full window (the ride case must not regress) ===');
const wCont=M._yvyFieldWindow_(CONT, r=>(r.avgPwr!=null?+r.avgPwr:null), '2026-06');
check('a dense history keeps every month in the window', wCont.inWindow, wCont.rankableMonths);
check('so no window caveat is warranted', wCont.inWindow<wCont.rankableMonths, false);

console.log('\n=== an empty field still degrades honestly ===');
const wNone=M._yvyFieldWindow_(RUNS, ()=>null, '2026-06');
check('no carriers -> zero rankable, no window', [wNone.rankableMonths, wNone.inWindow, wNone.start], [0, 0, null]);

console.log('\n=== _yvyElev_ reads real climbing, not just .elev ===');
// The Jul 2026 trail run: no elev, no elevation; maxElev 791 is the route HIGH POINT, and the only
// real signal is the 28-point stream summing to 37 ft.
const TRAIL={date:'2026-07-29', distance:3.3, maxElev:791,
  chartEle:[766,768,770,772,773,774,776,775,778,777,780,781,782,783,785,786,787,788,789,790,791,779,784,771,767,765,764,769]};
check('derives 37 ft rather than reporting 0', M._yvyElev_(TRAIL), 37);
check('never reports the 791 ft route high point as climbing', M._yvyElev_(TRAIL)===791, false);
check('snapshot runs still read .elev', M._yvyElev_({elev:216}), 216);
check('the runs library still reads .elevation', M._yvyElev_({elevation:804}), 804);
check('nothing at all is 0, not NaN', M._yvyElev_({}), 0);

// ---- everything below renders through the SHIPPED _yvyPhys_ + _yvyPhysRow_ ----
const NOW=new Date(2026,6,29);
const runRow  = txt(M._yvyPhysRow_({sport:'run',  nA:'run',  nP:'runs',  monthN:'run-months',  phys:M._yvyPhys_(RUNS, NOW, 'run')}));
const rideRow = txt(M._yvyPhysRow_({sport:'ride', nA:'ride', nP:'rides', monthN:'ride-months', phys:M._yvyPhys_(CONT, NOW, 'ride')}));

console.log('\n=== the copy the SHIPPED render builds from these numbers ===');
// 145 rankable months in this fixture (144 dense 2013-2024 + Aug 2025; Mar 2025's 2 runs miss
// the 4-run gate). The point of the assertion is the LEFT number: coverage, not the window's 1.
check('pace leads with real coverage, not the window count', /carried by 145 of your 145 completed rankable run-months/.test(runRow), true);
check('pace does NOT claim the runs failed to record it', /Avg Pace[^.]*not recorded before/.test(runRow), false);
check('pace still discloses the narrow window', /ranks within Aug 2025 alone/.test(runRow), true);
check('the old false sentence is gone', runRow.indexOf('do not carry it')<0, true);
check('cadence DOES name its real start', /Avg Cadence[^.]*not recorded before Jan 2019/.test(runRow), true);
check('no sentence quotes the window count as the coverage', runRow.indexOf('1 of your 145')<0, true);
check('the KPI line leads with carriers too', /145 of 145 mo carry it/.test(runRow), true);
check('and names the window after it', /window from Aug '25/.test(runRow), true);

console.log('\n=== each sport keeps its own vocabulary ===');
check('run row is Pace & Physiology',   runRow.indexOf('Pace & Physiology')>=0, true);
check('ride row is Power & Physiology', rideRow.indexOf('Power & Physiology')>=0, true);
check('no ride noun reaches the run row', /\b(ride|rides|rode)\b/.test(runRow), false);
check('no run noun reaches the ride row', /\b(ran|runs)\b/.test(rideRow), false);
check('a fully-dense ride history earns no window caveat', rideRow.indexOf('longest continuous stretch')<0, true);

console.log('\n=== source guard: sport words in _yvyVM_ ===');
// _yvyVM_'s closure is too large to instantiate here, so the handful of user-visible sport words
// it owns are guarded at the source. Weaker than a render assertion and labelled as such — but it
// is what catches "You rode 36m more" reappearing on a run month.
const vmBody = src.slice(src.indexOf('function _yvyVM_('), matchBrace(src.indexOf('function _yvyVM_(')));
check('the sport verb is derived, not hardcoded', /_nVerb\s*=\s*\(sport===.run.\)/.test(vmBody), true);
check('the Time row uses the derived verb', /'You '\+_nVerb\+' '\+s\+' more'/.test(vmBody), true);
check('no literal "You rode" survives in the shared builder', vmBody.indexOf("'You rode '")<0, true);
check('no literal "Ride N more to catch up" survives', vmBody.indexOf("'Ride '+s+' more to catch up'")<0, true);

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'yvy-run-path: all checks passed'+X));
process.exit(fails?1:0);
