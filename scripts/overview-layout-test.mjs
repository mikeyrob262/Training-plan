// Overview v3 layout.
//
// The assertion that matters most is the one the athlete reported: Fitness IS CTL, and the strip
// showed "Fitness (CTL) 181" beside "CTL 57" as two different metrics, with 181 actually being the
// FTP. So this checks there is exactly ONE fitness cell and that FTP is never labelled Fitness.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+l+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(l,c)=>{ if(!c)fails++; console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l); };

const UI = ['_ovwCard_','_ovwLbl_','_ovwDash_','_ovwDelta_','_ovwCurrentStateHTML_','_ovwGoalsHTML_','_ovwPerfHTML_','_ovwCoachHTML_','_ovwSignalsHTML_','_ovwHMS_'];
function render(over){
  const W = Object.assign({
    st: { ftp: 183, fitSeries: [], goalTargets: {}, rides: [], weight: 159 },
    fitness: { ctl: 60, atl: 61, tsb: -1, loaded: true, stale: false }
  }, over||{});
  const fn = new Function('st','getFitness_','aiEsc_','_ovwActs_','_ovwWindow_','_ovwPct_','stWeightLb_',
    'wkgFromW_','dprBoard_','ovwEvaluate_','_ytdCycMi_',
    asServed(UI.map(ex).join('')) + ';return {' + UI.join(',') + '};');
  return fn(W.st, () => W.fitness, (s)=>String(s==null?'':s),
    () => W.acts||[], (a,f,t)=>(W.acts||[]), (n,t)=>(t>0?Math.round((n-t)/t*1000)/10:null),
    () => W.st.weight, () => 2.54, () => ({markers:[]}),
    () => W.hit || {tier:6,key:'t6:quiet',title:'q',body:'',facts:[]},
    () => W.ytd==null?null:W.ytd);
}

console.log('\n'+C+'=== Fitness IS CTL - one cell, and FTP is not it ==='+X);
{
  const api = render({ st:{ ftp:183, fitSeries:[], goalTargets:{}, rides:[], weight:159 },
                       fitness:{ ctl:60, atl:61, tsb:-1, loaded:true } });
  const html = api._ovwCurrentStateHTML_();
  const fitCells = (html.match(/Fitness \(CTL\)/g)||[]).length;
  check('exactly one Fitness (CTL) cell', fitCells, 1);
  ok('there is no second bare CTL cell beside it', !/>CTL</.test(html));
  ok('FTP has its own cell', /FTP/.test(html));
  ok('...and FTP is never labelled Fitness', !/Fitness[^<]*FTP|FTP[^<]*Fitness \(CTL\)/.test(html));
  // the reported symptom in one assertion: 183 must not appear as the fitness value
  const fitBlock = html.slice(html.indexOf('Fitness (CTL)'), html.indexOf('Fatigue'));
  ok('the fitness cell shows CTL 60, not the FTP 183', /60/.test(fitBlock) && !/183/.test(fitBlock));
  ok('Form is present as TSB', /Form \(TSB\)/.test(html));
}
{
  // with no fitness loaded, every cell must be an em-dash, never a zero
  const api = render({ fitness:{ loaded:false } });
  const html = api._ovwCurrentStateHTML_();
  ok('unloaded fitness renders em-dashes, not zeros', /mdash/.test(html) && !/>0</.test(html));
}

console.log('\n'+C+'=== goals are the REAL goal types ==='+X);
{
  const api = render({ st:{ ftp:183, fitSeries:[], weight:159,
    goalTargets:{ annualMi:5000, weeklyMi:100, ctl:65, ftpW:200, weightLb:150, wkg:3.14 }, rides:[] },
    fitness:{ ctl:60, atl:61, tsb:-1, loaded:true }, ytd:2100 });
  const html = api._ovwGoalsHTML_();
  ['Annual mileage','Weekly mileage','Fitness (CTL)','FTP','Weight','W/kg at FTP'].forEach(n =>
    ok('renders '+n, html.indexOf(n) >= 0));
  ok('does NOT invent Century Ride', !/Century/i.test(html));
  ok('does NOT invent Everest Challenge', !/Everest/i.test(html));
  ok('shows the real FTP target of 200', /200/.test(html));
  ok('weight has no progress bar (down is progress there)',
     html.indexOf('Weight') > 0 && (html.match(/width:\d+%/g)||[]).length <= 4);
}
{
  const api = render({ st:{ ftp:183, fitSeries:[], goalTargets:{}, rides:[], weight:159 } });
  check('no goals configured renders nothing at all', api._ovwGoalsHTML_(), '');
}

console.log('\n'+C+'=== performance strip is honest about missing power ==='+X);
{
  const api = render({ st:{ ftp:183, fitSeries:[], goalTargets:{}, weight:159,
    rides:[{ date:'2026-06-20', distance:110.3, powerCurve:{ '300':300, '1200':273 } }] },
    fitness:{ ctl:60, atl:61, tsb:-1, loaded:true } });
  const html = api._ovwPerfHTML_();
  ok('best 5-min comes from the power curve', /300 W/.test(html));
  ok('best 20-min too', /273 W/.test(html));
  ok('longest ride is shown', /110\.3 mi/.test(html));
}
{
  const api = render({ st:{ ftp:183, fitSeries:[], goalTargets:{}, weight:159,
    rides:[{ date:'2026-06-20', distance:110.3 }] } });
  const html = api._ovwPerfHTML_();
  ok('a ride with no power curve yields an em-dash, not a zero', /mdash/.test(html) && !/0 W/.test(html));
  ok('...and says why', /no power curve yet/.test(html));
}

console.log('\n'+C+'=== the AI Coach question is derived, not generic ==='+X);
{
  const a = render({ hit:{ tier:3, key:'t3:volume', title:'', body:'', facts:[] } })._ovwCoachHTML_();
  ok('a volume drop produces a question about volume', /training less/i.test(a));
  const b = render({ hit:{ tier:5, key:'t5:climb', title:'', body:'', facts:[] } })._ovwCoachHTML_();
  ok('a climbing trend produces the climbing question', /climbing/i.test(b));
  ok('...and they are different questions', a !== b);
  const c = render({ hit:{ tier:6, key:'t6:quiet', title:'', body:'', facts:[] } })._ovwCoachHTML_();
  ok('the quiet state still offers something to ask', /focus on next/i.test(c));
}

console.log('\n'+C+'=== the six sections are wired, and v2 is not ==='+X);
const asm = ex('aiRenderTab_');
['_ovwHeroHTML_','_ovFocusHTML_','_ovwCurrentStateHTML_','_ovwGoalsHTML_','_ovwPerfHTML_',
 '_dnaRadarHTML_','_ovwCoachHTML_','_ovwSignalsHTML_'].forEach(n =>
  ok('Overview calls '+n, asm.indexOf(n) >= 0));
// The trim is the point of v3: these still EXIST but Overview must no longer render them.
['_ovMomentumHTML_','_ovHighlightsHTML_','_ovOpportunityHTML_','_ovLegacyHTML_','aiCardStory_'].forEach(n =>
  ok('Overview no longer renders '+n, !new RegExp('_aiSafe_\\([^)]*'+n).test(asm)));
ok('the old hero is no longer called', !/_aiSafe_\('Hero'/.test(asm));
ok('the hero is driven by the decision hierarchy', /ovwEvaluate_/.test(ex('_ovwHeroHTML_')));
ok('...and stamps its tier and rule key into the DOM for provenance',
   /data-ovw-tier=/.test(ex('_ovwHeroHTML_')) && /data-ovw-key=/.test(ex('_ovwHeroHTML_')));
ok('the DNA card uses the REAL 4-axis radar', /_dnaRadarHTML_/.test(asm));
ok('...and no invented composite score is rendered', !/The Engine|87\/100|\/100/.test(ex('_ovwHeroHTML_')));

console.log(fails ? '\n'+R+'overview layout: '+fails+' FAILED'+X+'\n' : '\n'+G+'overview layout: all checks passed'+X+'\n');
process.exit(fails?1:0);
