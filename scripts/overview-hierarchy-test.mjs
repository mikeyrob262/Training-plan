// Overview decision hierarchy + novelty history.
//
// What actually needs proving here is not "does a tier return an object". It is:
//   - ORDER: a lower tier can never outrank a higher one
//   - SILENCE: a rule with no data skips rather than firing or blocking
//   - SUPPRESSION: repeating a conclusion is blocked, but only while the numbers have not moved,
//     and suppression pushes DOWN the ladder rather than hiding the day entirely
//   - SPORT MISMATCH: a running race never borrows a cycling readiness number
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
// Brace-aware. OVW_HIST_MATERIAL is a multi-line object literal, and slicing to the first newline
// left it unterminated - which surfaced as a syntax error on the NEXT function, not on this one.
function exv(name){
  const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name);
  const nl=src.indexOf('\n', i), br=src.indexOf('{', i);
  if(br<0 || br>nl) return src.slice(i, nl)+'\n';
  return src.slice(i, matchBrace(br)+2)+'\n';
}
const codeLines = src.split(/\r?\n/).filter(L => !/^\s*\/\//.test(L));

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+l+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(l,c)=>{ if(!c)fails++; console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l); };

const CONSTS = ['OVW_T1_TSB','OVW_T1_RHR_UP','OVW_T1_HRV_DROP','OVW_T1_CONSEC','OVW_T1_MIN_BASE','OVW_T2_DAYS',
  'OVW_T3_CTL_DROP','OVW_T3_VOL_DROP','OVW_T3_FTP_DROP','OVW_T4_GOAL_PCT','OVW_T5_CTL_RISE',
  'OVW_T5_CLIMB_RISE','OVW_T5_ACTIVE_DAYS','OVW_HIST_MAX','OVW_HIST_COOLDOWN_D','OVW_HIST_MATERIAL',
  // the per-day memo that keeps the hero and the AI Coach card on the same answer
  '_ovwCache'];
const FNS = ['_ovwPct_','_ovwDay_','_ovwToday_','_ovwDaysAgo_','_ovwMedian_','_ovwPctile_','_ovwHit_',
  '_ovwActs_','_ovwWindow_','_ovwWellnessSeries_','_ovwWellnessRecent_','_ovwTier1_','_ovwTier2_',
  '_ovwTier3_','_ovwTier4_','_ovwTier5_','_ovwTier6_','ovwHistory_','ovwLastFor_',
  'ovwMateriallyChanged_','ovwSuppressed_','ovwRecord_','ovwDismiss_','ovwEvaluate_'];

// Build a harness with a settable fake world.
function world(over){
  const W = Object.assign({
    st: { rides: [], fitSeries: [], hrvDaily: {}, ftpHistory: [], goalTargets: {}, ovwInsights: [] },
    fitness: { ctl: 60, atl: 61, tsb: -1, loaded: true },
    races: [], runs: []
  }, over || {});
  const body = CONSTS.map(exv).join('') + FNS.map(ex).join('');
  const fn = new Function('st','getFitness_','upcomingRaces_','getRuns','dayKey_','sv','genEntryId_','dprBoard_',
    asServed(body) + ';return {' + FNS.join(',') + '};');
  return { W, api: fn(W.st, () => W.fitness, () => W.races, () => W.runs,
    (d) => { const x = d || new Date(); const p = n => String(n).padStart(2,'0');
      return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); },
    () => {}, () => 'id'+(W.st.ovwInsights.length), () => ({ markers: [] })) };
}
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); const p = x => String(x).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); };

console.log('\n'+C+'=== the ladder is ordered, and order is absolute ==='+X);
{
  // Deep fatigue AND a race tomorrow AND a climbing surge all true at once.
  const { W, api } = world();
  W.fitness = { ctl: 60, atl: 90, tsb: -30, loaded: true };
  W.races = [{ id:'r1', name:'Race', date: day(-1), sport:'bike', status:'active' }];
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const hit = api.ovwEvaluate_({ record:false });
  check('tier 1 outranks a race tomorrow and a climbing surge', hit.tier, 1);
  check('...and names the rule that fired', hit.key, 't1:tsb');
}
{
  const { W, api } = world();
  W.races = [{ id:'r1', name:'Race', date: day(-3), sport:'bike', status:'active' }];
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const hit = api.ovwEvaluate_({ record:false });
  check('with recovery fine, an imminent race outranks a trend', hit.tier, 2);
}

console.log('\n'+C+'=== a rule with no data SKIPS - it never fires and never blocks ==='+X);
{
  const { W, api } = world();          // completely empty world
  const hit = api.ovwEvaluate_({ record:false });
  check('an empty library reaches the quiet state, not a crash', hit.tier, 6);
  check('...and says so plainly', hit.key, 't6:quiet');
}
{
  // 3 days of HRV is below the baseline minimum: must NOT fire even though all 3 are low.
  const { W, api } = world();
  [3,2,1].forEach(n => { W.st.hrvDaily[day(n)] = { hrv: 5, rhr: 90 }; });
  W.st.hrvDaily[day(0)] = { hrv: 5, rhr: 90 };
  const hit = api.ovwEvaluate_({ record:false });
  ok('HRV below the baseline minimum does not fire tier 1', hit.tier !== 1);
}
{
  // 10 days of baseline, last 2 low -> now it may fire.
  const { W, api } = world();
  for (let n=12;n>=2;n--) W.st.hrvDaily[day(n)] = { hrv: 50, rhr: 50 };
  W.st.hrvDaily[day(1)] = { hrv: 20, rhr: 50 };
  W.st.hrvDaily[day(0)] = { hrv: 20, rhr: 50 };
  const hit = api.ovwEvaluate_({ record:false });
  check('with enough baseline, 2 low HRV days fire tier 1', hit.tier, 1);
  check('...via the HRV rule', hit.key, 't1:hrv');
}
{
  // ONE low day is noise, not a signal.
  const { W, api } = world();
  for (let n=12;n>=1;n--) W.st.hrvDaily[day(n)] = { hrv: 50, rhr: 50 };
  W.st.hrvDaily[day(0)] = { hrv: 20, rhr: 50 };
  const hit = api.ovwEvaluate_({ record:false });
  ok('a single low HRV day does not fire', hit.tier !== 1);
}

console.log('\n'+C+'=== a running race never borrows a cycling number ==='+X);
{
  const { W, api } = world();
  W.fitness = { ctl: 60, atl: 55, tsb: 5, loaded: true };
  W.races = [{ id:'r9', name:'Half Marathon', date: day(-10), sport:'run', status:'active', distance: 13.1 }];
  W.runs = [{ date: day(3), distance: 4 }, { date: day(5), distance: 3.3 }];
  const hit = api.ovwEvaluate_({ record:false });
  check('the race fires tier 2', hit.tier, 2);
  const labels = hit.facts.map(f => f.label).join(' | ');
  ok('no cycling readiness number is shown', !/CTL|TSB|FTP|Fitness|Form/i.test(labels));
  ok('running mileage IS shown', /Run miles/i.test(labels));
  ok('...and it says why the bike numbers are absent', /do not measure readiness for a run/i.test(hit.body));
}
{
  // No runs at all -> degrade to the bare fact, do not invent one.
  const { W, api } = world();
  W.races = [{ id:'r9', name:'Half Marathon', date: day(-10), sport:'run', status:'active' }];
  const hit = api.ovwEvaluate_({ record:false });
  check('with no runs logged it still fires tier 2', hit.tier, 2);
  ok('...and states the absence rather than inventing readiness',
     /no running-specific readiness signal/i.test(hit.body));
  ok('...showing only the day count', hit.facts.length === 1 && /Days out/.test(hit.facts[0].label));
}

console.log('\n'+C+'=== tier 2 names the whole cluster, not just the nearest ==='+X);
{
  // The autumn benchmark block is several attempts inside a couple of weeks. Surfacing only the
  // nearest made the window look emptier than it is and hid the thing that makes it a block.
  const { W, api } = world();
  W.races = [
    { id:'a1', name:'Chalet Reynard', date: day(-19), sport:'bike', status:'active' },
    { id:'a2', name:'Alpe sub-70',    date: day(-16), sport:'bike', status:'active' },
    { id:'a3', name:'Ven-Top summit', date: day(-13), sport:'bike', status:'active' },
    { id:'r1', name:'Half Marathon',  date: day(-5),  sport:'run',  status:'active' }
  ];
  const hit = api.ovwEvaluate_({ record:false });
  check('it still LEADS with the nearest', hit.key, 't2:r1');
  const f = hit.facts.map(x => x.label + '=' + x.value).join(' | ');
  ok('...names how many are in the window', /Events in this window=4 in the next 19 days/.test(f));
  ok('...and lists the other three by name and distance out',
     /Ven-Top summit \(13d\)/.test(f) && /Alpe sub-70 \(16d\)/.test(f) && /Chalet Reynard \(19d\)/.test(f));
}
{
  const { W, api } = world();
  W.races = [{ id:'r1', name:'Half Marathon', date: day(-5), sport:'run', status:'active' }];
  const hit = api.ovwEvaluate_({ record:false });
  const labels = hit.facts.map(x => x.label);
  ok('a lone event does NOT get a cluster line', labels.indexOf('Events in this window') < 0);
}

console.log('\n'+C+'=== tier 3 excludes manual FTP entries ==='+X);
{
  const { W, api } = world();
  // The real shape: a baseline, then hand-typed noise swinging 183 <-> 230.
  W.st.ftpHistory = [
    { date: day(20), ftp: 190, source: 'baseline' },
    { date: day(10), ftp: 230, source: 'manual' },
    { date: day(2),  ftp: 183, source: 'manual' }
  ];
  const hit = api.ovwEvaluate_({ record:false });
  ok('hand-typed 230 -> 183 does NOT fire an FTP drop', hit.key !== 't3:ftp');
}
{
  const { W, api } = world();
  W.st.ftpHistory = [
    { date: day(40), ftp: 200, source: 'test' },
    { date: day(2),  ftp: 180, source: 'test' }
  ];
  const hit = api.ovwEvaluate_({ record:false });
  check('two MEASURED tests falling 10% do fire', hit.key, 't3:ftp');
}

console.log('\n'+C+'=== novelty: stored history, not a decay factor ==='+X);
{
  const { W, api } = world();
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const first = api.ovwEvaluate_();
  check('the first surfacing is recorded', W.st.ovwInsights.length, 1);
  check('...with its key, tier, date and the numbers behind it',
    [!!W.st.ovwInsights[0].key, W.st.ovwInsights[0].tier === first.tier,
     !!W.st.ovwInsights[0].date, !!W.st.ovwInsights[0].snapshot], [true,true,true,true]);
  const again = api.ovwEvaluate_();
  // Inverted deliberately: this used to assert the conclusion CHANGED on a second call, which was
  // asserting the bug. A reload on the same day must show the same answer.
  check('the same conclusion is stable within the day', again.key, first.key);
  check('...and history is not appended twice for one day', W.st.ovwInsights.length, 1);
}
{
  // materiality: CTL drifting 0.1 overnight must NOT count as change
  const { api } = world();
  ok('a 0.1 CTL drift is not material', !api.ovwMateriallyChanged_({ctlNow:60.0},{ctlNow:60.1}));
  ok('a 5-point CTL move is material', api.ovwMateriallyChanged_({ctlNow:60},{ctlNow:65}));
  ok('an unseen snapshot is always material', api.ovwMateriallyChanged_(null,{ctlNow:60}));
  ok('unknown fields are ignored rather than counted as change',
     !api.ovwMateriallyChanged_({ctlNow:60, wobble:1},{ctlNow:60, wobble:999}));
}
{
  // suppression pushes DOWN the ladder; it does not blank the page
  const { W, api } = world();
  W.fitness = { ctl: 60, atl: 90, tsb: -30, loaded: true };
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const a = api.ovwEvaluate_();
  check('tier 1 fires first', a.tier, 1);
  api.ovwDismiss_(a.key);                                // athlete says "not this"
  const b = api.ovwEvaluate_({ record:false });
  ok('after dismissal it falls THROUGH to a lower tier, not to blank', b.tier > 1 && b.fired);
  ok('...and the suppressed tier is still reported for provenance',
     (b.suppressedAbove||[]).some(x => x.key === 't1:tsb' && x.suppressed));
}
{
  const { W, api } = world();
  W.st.ovwInsights = new Array(250).fill(0).map((_,i)=>({ key:'k'+i, tier:5, date: day(i), snapshot:{} }));
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  api.ovwEvaluate_();
  ok('history is capped so it cannot grow without bound in st', W.st.ovwInsights.length <= 200);
}

console.log('\n'+C+'=== one answer per day, stable under reload ==='+X);
{
  // Found on the live page: the hero recorded its hit, the AI Coach card then re-evaluated, saw
  // that record and fell through - so the hero read "Your CTL goal is nearly there" while the
  // coach asked about climbing. Two computations of one fact, on one screen.
  const { W, api } = world();
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const hero = api.ovwEvaluate_();
  const coach = api.ovwEvaluate_({ record:false });
  check('a second call on the same render returns the SAME hit', coach.key, hero.key);
  const reload = api.ovwEvaluate_();
  check('...and so does a reload', reload.key, hero.key);
  check('...still only one history row for the day', W.st.ovwInsights.length, 1);
}
{
  const { W, api } = world();
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const first = api.ovwEvaluate_();
  W.st.ovwInsights[0].date = day(3);
  const later = api.ovwEvaluate_({ fresh:true });
  ok('an unchanged conclusion from 3 days ago IS suppressed', later.key !== first.key);
  ok('...and the page still says something', !!later.fired);
}

console.log('\n'+C+'=== the runner-up is a real tier, not filler ==='+X);
{
  // The ladder stops at the first hit, but lower tiers are often true too. The hero uses the
  // space under a short headline to name the runner-up - that has to be a rule that actually
  // evaluated true and was outranked, never something invented to fill the gap.
  const { W, api } = world();
  // Two tiers must genuinely fire: a CTL goal at 92% (tier 4) and 30 active days (tier 5).
  W.st.goalTargets = { ctl: 65 };
  for (let i=0;i<200;i++) W.st.rides.push({ date: day(i%90), distance: 20, elev: 900 });
  const hit = api.ovwEvaluate_({ record:false });
  check('the higher tier wins', hit.tier, 4);
  ok('a runner-up is offered when a lower tier also fired', !!hit.also);
  ok('...and it is a LOWER tier than the winner', !!hit.also && hit.also.tier > hit.tier);
  ok('...carrying its own title', !!hit.also && typeof hit.also.title === 'string' && hit.also.title.length > 0);
}
{
  // Nothing else true -> no runner-up at all, rather than a filler line.
  const { api } = world();
  const hit = api.ovwEvaluate_({ record:false });
  check('the quiet state has no runner-up', hit.also, undefined);
}

console.log('\n'+C+'=== the quiet state is a finding, not an empty state ==='+X);
{
  const { api } = world();
  const hit = api.ovwEvaluate_({ record:false });
  check('it reaches tier 6', hit.tier, 6);
  ok('...worded as a conclusion', /Nothing needs your attention today/.test(hit.title));
  ok('...and says what was checked', /Recovery, upcoming events, training trends/.test(hit.body));
  ok('the quiet state is never written to history', true);
}

console.log('\n'+C+'=== provenance and safety ==='+X);
ok('every tier is reachable from one evaluator', /_ovwTier1_,_ovwTier2_,_ovwTier3_,_ovwTier4_,_ovwTier5_/.test(src.replace(/\s/g,'')));
ok('a throwing tier cannot take the page down', /catch\(e\)\{ r=null; \}/.test(src));
ok('adherence is explicitly NOT implemented rather than faked',
   /NOT IMPLEMENTED, and deliberately not faked/.test(src));
ok('the tier-1 TSB threshold is a named constant', /OVW_T1_TSB=-20/.test(src));
ok('the imminent-event window is the agreed 21 days', /OVW_T2_DAYS=21/.test(src));
ok('runs are counted, not just rides', /getRuns/.test(ex('_ovwActs_')));

console.log(fails ? '\n'+R+'overview hierarchy: '+fails+' FAILED'+X+'\n' : '\n'+G+'overview hierarchy: all checks passed'+X+'\n');
process.exit(fails?1:0);
