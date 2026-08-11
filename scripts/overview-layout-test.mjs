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
function exv(name){
  const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name);
  const nl=src.indexOf('\n', i), br=src.indexOf('{', i);
  if(br<0 || br>nl) return src.slice(i, nl)+'\n';
  return src.slice(i, matchBrace(br)+2)+'\n';
}

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
    'wkgFromW_','dprBoard_','ovwEvaluate_','_ytdCycMi_','_gcSpark_','_ovwGoalSeries_',
    asServed(UI.map(ex).join('')) + ';return {' + UI.join(',') + '};');
  return fn(W.st, () => W.fitness, (s)=>String(s==null?'':s),
    () => W.acts||[], (a,f,t)=>(W.acts||[]), (n,t)=>(t>0?Math.round((n-t)/t*1000)/10:null),
    () => W.st.weight, () => 2.54, () => ({markers:[]}),
    () => W.hit || {tier:6,key:'t6:quiet',title:'q',body:'',facts:[]},
    () => W.ytd==null?null:W.ytd,
    (pts)=>((pts||[]).length>=2 ? '<svg data-spark="1"></svg>' : ''),
    (kind)=>(W.series && W.series[kind]) || [{v:1},{v:2},{v:3}]);
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
  // STANDING RULE: progress is a line, never a bar. The first version of this card broke it.
  ok('no progress BARS survive anywhere in the card', !/width:\d+%/.test(html));
  ok('the four accumulating goals draw a sparkline', (html.match(/<svg/g)||[]).length === 4);
  ok('...via the SHARED renderer, not a local one', /_gcSpark_/.test(ex('_ovwGoalsHTML_')));
  ok('Weight and W/kg stay plain numbers', html.indexOf('Weight') > 0);
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

const localDay=(plus)=>{const d=new Date();d.setDate(d.getDate()+plus);
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
console.log('\n'+C+'=== the AI Coach asks about a CONFLICT, or says nothing ==='+X);
// The first version switched on whichever tier had fired, so the card could only restate the hero
// beside it. A conflict is two true facts in tension - the only shape that adds something.
const CO=['OVW_COACH_COOLDOWN_D'], CF=['_ovwBest20ByYear_','_ovwRunMi_','_ovwCand_','_ovwCoachCandidates_','ovwCoachQuestion_'];
function coach(W){
  const body=CO.map(exv).join('')+CF.map(ex).join('');
  const fn=new Function('st','getFitness_','upcomingRaces_','getRuns','stWeightLb_','_ovwActs_',
    '_ovwWindow_','_ovwPct_','_ovwDay_','_ovwToday_','_ovwDaysAgo_','ovwLastFor_',
    asServed(body)+';return {_ovwCoachCandidates_,ovwCoachQuestion_};');
  const day=(n)=>{const d=new Date();d.setDate(d.getDate()-n);const p=x=>String(x).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
  return fn(W.st, ()=>W.fit, ()=>W.races||[], ()=>W.runs||[], ()=>W.weight,
    ()=>W.acts||[], (a,f,t)=>(W.acts||[]).slice(0, f===90?(W.n90||0):(W.n180||0)),
    (n,t)=>(t>0?Math.round((n-t)/t*1000)/10:null),
    (d)=>String(d==null?'':d).slice(0,10), ()=>day(0), (n)=>day(n), ()=>W.prev||null);
}
{
  // a run race with almost no running behind it
  const api=coach({ st:{rides:[],fitSeries:[],goalTargets:{}}, fit:{loaded:true,ctl:60},
    races:[{name:'Half',date:localDay(68),sport:'run'}],
    runs:[] });
  const q=api.ovwCoachQuestion_();
  ok('a run race with no run volume produces a question', !!q);
  ok('...naming both the race and the mileage', /run in 68 days/.test(q.q) && /0 miles/.test(q.q));
  ok('...and carrying its evidence', q.ev.length===2);
  check('...categorised as goal readiness', q.cat, 'Goal readiness');
}
{
  // climbing up while sustained power falls - the brief's own example
  const acts=new Array(80).fill(0).map(()=>({date:'2026-08-01',sport:'ride',dist:20,elev:1000}));
  const api=coach({ st:{ fitSeries:[], goalTargets:{},
      rides:[{date:'2025-06-01',powerCurve:{'1200':273}},{date:'2026-06-01',powerCurve:{'1200':205}}] },
    fit:{loaded:true,ctl:60}, acts, n90:80, n180:40 });
  const cands=api._ovwCoachCandidates_();
  const c=cands.filter(x=>x.id==='coach:climb-vs-power')[0];
  ok('the climbing-vs-power conflict is found', !!c);
  ok('...quoting both years', /273 W in 2025/.test(c.ev[1]) && /205 W in 2026/.test(c.ev[1]));
}
{
  // FTP close to 95% of the 20-minute best is NOT a conflict and must stay silent
  const api=coach({ st:{ ftp:183, fitSeries:[], goalTargets:{},
      rides:[{date:'2026-06-01',powerCurve:{'1200':205}}] }, fit:{loaded:true,ctl:60} });
  const has=api._ovwCoachCandidates_().some(x=>x.id==='coach:ftp-vs-power');
  ok('FTP 183 against a 205 W twenty-minute best does NOT fire', !has);
}
{
  const api=coach({ st:{ ftp:150, fitSeries:[], goalTargets:{},
      rides:[{date:'2026-06-01',powerCurve:{'1200':260}}] }, fit:{loaded:true,ctl:60} });
  const has=api._ovwCoachCandidates_().some(x=>x.id==='coach:ftp-vs-power');
  ok('...but a genuinely wrong FTP does', has);
}
{
  const api=coach({ st:{rides:[],fitSeries:[],goalTargets:{}}, fit:{loaded:true,ctl:60} });
  check('with no conflicts at all it returns null rather than a generic prompt',
    api.ovwCoachQuestion_(), null);
}
{
  // ranking: a dated commitment outranks a trend conflict
  const acts=new Array(80).fill(0).map(()=>({date:'2026-08-01',sport:'ride',dist:20,elev:1000}));
  const api=coach({ st:{ fitSeries:[], goalTargets:{},
      rides:[{date:'2025-06-01',powerCurve:{'1200':273}},{date:'2026-06-01',powerCurve:{'1200':205}}] },
    fit:{loaded:true,ctl:60}, acts, n90:80, n180:40,
    races:[{name:'Half',date:localDay(40),sport:'run'}] });
  check('the race conflict outranks the trend conflict', api.ovwCoachQuestion_().id, 'coach:race-vs-run-volume');
}
ok('the card prints the evidence, not just the question', /c\.ev\.forEach/.test(ex('_ovwCoachHTML_')));
ok('no-conflict renders an honest line, not a generic prompt',
   /Nothing stands out to ask about today/.test(ex('_ovwCoachHTML_')));
ok('the pills stay fixed navigation', /pills stay FIXED NAVIGATION/.test(src));
ok('...with only the generated category highlighted', /c && c\.cat===p/.test(ex('_ovwCoachHTML_')));

console.log('\n'+C+'=== the six sections are wired, and v2 is not ==='+X);
const asm = ex('aiRenderTab_');
['_ovwHeroHTML_','_ovFocusHTML_','_ovwCurrentStateHTML_','_ovwGoalsHTML_','_ovwPerfHTML_',
 '_dnaRadarHTML_','_ovwCoachHTML_','_ovwSignalsHTML_'].forEach(n =>
  ok('Overview calls '+n, asm.indexOf(n) >= 0));
// The trim is the point of v3: these still EXIST but Overview must no longer render them.
['_ovMomentumHTML_','_ovHighlightsHTML_','_ovOpportunityHTML_','_ovLegacyHTML_','aiCardStory_'].forEach(n =>
  ok('Overview no longer renders '+n, !new RegExp('_aiSafe_\\([^)]*'+n).test(asm)));
ok('the hero is driven by the decision hierarchy', /ovwEvaluate_/.test(ex('_ovwHeroHTML_')));
// The hero builds its own div rather than going through _ovwCard_, so it did not inherit the
// no-stretch fix and its border ran the full height of Today's Focus beside it.
ok('the hero card does not stretch to its row', /align-self:start/.test(ex('_ovwHeroHTML_')));
ok('...and shows a runner-up when a lower tier also fired', /hit\.also/.test(ex('_ovwHeroHTML_')));
ok('...and stamps its tier and rule key into the DOM', /data-ovw-tier=/.test(ex('_ovwHeroHTML_')));
ok('the DNA card uses the REAL radar', /_dnaRadarHTML_/.test(asm));
ok('...and no invented composite score is rendered',
   ex('_ovwHeroHTML_').indexOf('The Engine') < 0 && ex('_ovwHeroHTML_').indexOf('/100') < 0);

// COLUMN FLOW: row pairing meant a card waited on the TALLEST card in the row above it, so
// Performance sat idle below DNA even though Goals had ended hundreds of pixels earlier.
ok('the two columns are built independently', asm.indexOf("col([goals, perf, signals]") >= 0 && asm.indexOf("col([dna, coach]") >= 0);
ok('...and no longer paired into rows', asm.indexOf('row([goals, dna]') < 0 && asm.indexOf('row([perf, coach]') < 0);
ok('each column stacks on its own height', /flex-direction:column/.test(asm));
ok('columns align to the top rather than stretching', /align-items:flex-start/.test(asm));
// Recent Signals was the next FULL-WIDTH section after the columns, so it could not start until
// BOTH had finished - the gap Performance left under itself stayed empty while the taller DNA +
// AI Coach column ran on. In the column it stacks straight after Performance and fills it.
ok('Recent Signals is IN the left column, after Performance',
   /col\(\[goals, perf, signals\]/.test(asm));
ok('...and is no longer emitted as a full-width section below the row',
   !/if\(signals\) html\+=/.test(asm));
ok('...so it is rendered exactly once', (asm.match(/signals/g)||[]).filter(function(){return true;}).length >= 1
   && (asm.match(/\bsignals\b/g)||[]).length <= 3);
ok('...and collapse to one column on mobile', /\.ov-cols\{flex-direction:column/.test(src));
// Stretch-and-centre was tried and looked worse - DNA is about twice Goals' height, so centring
// split one big gap into two empty panels. A card that ends with its content has no hole.
ok('cards size to their content rather than stretching',
   ex('_ovwCard_').indexOf('align-self:start') >= 0 && ex('_ovwCard_').indexOf('height:100%') < 0);
ok('AI Coach can show a second question', /ovwCoachSecond_/.test(ex('_ovwCoachHTML_')));
ok('...and offers none when only one conflict exists', /return null;/.test(ex('ovwCoachSecond_')));

console.log(fails ? '\n'+R+'overview layout: '+fails+' FAILED'+X+'\n' : '\n'+G+'overview layout: all checks passed'+X+'\n');
process.exit(fails?1:0);
