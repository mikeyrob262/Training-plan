// Analytics Power-to-Weight card — a trajectory, not a position on a gradient.
//
// The card carried a 0-4.0 gradient pill with a marker dot. A pill says where today's number sits
// on an abstract scale; it cannot say whether the athlete is climbing toward the target or drifting
// away from it, which is the only question the card is read for. Standing rule: progress is a line.
//
// Series preference, and why there are two:
//   _gcWkgPts_  — FTP as of each weigh-in date / the weight recorded that day. The precise one.
//   wkgTrend_   — rolling best 20-min power over a 42-day window, sampled weekly. What this page
//                 already computes and already percentile-ranks ("Top 22% of your last 12 months").
// st.weightLog is empty on this athlete, so the fallback is what actually draws. The caption NAMES
// which series is on screen, because the two are different measurements.
//
// Run: node scripts/wkg-card-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
function extractVar(name){ const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name); return src.slice(i, src.indexOf('\n', i))+'\n'; }

let code = extractVar('_GC_WKG') + extractVar('_YVY_MON');
// dayKey_ is the canonical LOCAL day-key builder _gcWkgPts_ now cuts its window with (it used to
// call toISOString, which after 20:00 EDT names tomorrow and silently drops a day of weigh-ins).
for (const f of ['dayKey_','_gcYMD_','_gcMonLab_','_gcSpark_','_gcSparkFoot_','_gcTrend_','_gcWkgPts_','_goalTargets_']) code += extract(f);
const mk = (st, ftpOn) => new Function('st','ftpOn_', code + '\n;return {_gcWkgPts_,_gcTrend_,_goalTargets_,_GC_WKG};')(st, ftpOn);

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

// The card's own branch logic, mirrored so the target-rule decision is exercised directly.
function decide(pts, target){
  const v=pts.map(p=>p.v).filter(x=>x!=null);
  if(v.length<2) return { draw:false, onChart:false };
  const lo=Math.min(...v), hi=Math.max(...v);
  const tp=(hi>lo)?((target-lo)/(hi-lo)):-1;
  return { draw:true, onChart:(tp>=0&&tp<=1), top:(1-tp)*100, lo, hi };
}

console.log('\n=== the pill is gone from the Analytics hero ===');
const heroRaw = src.slice(src.indexOf('CENTER — W/kg centerpiece'), src.indexOf('RIGHT — compact 2x2 mini-stat grid'));
// Strip comment lines before asserting on CODE — the first version of this test failed on a
// comment that said the 215/151 pair was deliberately not copied.
const hero = heroRaw.split(String.fromCharCode(10)).filter(l => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
check('no 0-4.0 gradient bar', /linear-gradient\(90deg,#ef4444,#f59e0b,#22c55e,#4ade80\)/.test(hero), false);
check('no marker dot positioned by value', /left:'\+_wm/.test(hero), false);
check('no 0 / 2.0 / 4.0 tick row', /<span>2\.0<\/span>/.test(hero), false);
check('a trend line is drawn instead', /_gcTrend_\(pts, _GC_WKG/.test(hero), true);

console.log('\n=== the target is the editable goal, not a hardcode ===');
check('read from _goalTargets_', /_goalTargets_\(\):\{\}\)\.wkg/.test(hero), true);
check('no 215/151 pair copied from the Chase card', /215|151/.test(hero), false);
const M0 = mk({ weightLog:[], goalTargets:{} }, () => 190);
check('and defaults to 3.14 when unset', M0._goalTargets_().wkg, 3.14);

console.log('\n=== series preference: weigh-ins first, page series as fallback ===');
check('tries _gcWkgPts_ first', /var pts=\(typeof _gcWkgPts_==='function'\)\?_gcWkgPts_\(365\):\[\]/.test(hero), true);
check('falls back to the page W/kg series', /pts=_wt\.pts\.map/.test(hero), true);
check('the fallback only fires when the weigh-in series is empty',
  /if\(!pts\.filter\(function\(p\)\{ return p && p\.v!=null; \}\)\.length && _wt/.test(hero), true);
check('the caption names which series is drawn', /note:src\+/.test(hero), true);

console.log('\n=== _gcWkgPts_ on the live state (weigh-in log is EMPTY) ===');
const Mreal = mk({ weightLog:[], goalTargets:{} }, () => 190);
check('produces nothing to plot', Mreal._gcWkgPts_(365), []);
check('so the card must fall back, or show no chart', decide(Mreal._gcWkgPts_(365), 3.14).draw, false);

console.log('\n=== _gcWkgPts_ when weigh-ins exist ===');
const wl=[{date:'2025-09-01',weight:175},{date:'2026-01-01',weight:165},{date:'2026-04-01',weight:158},{date:'2026-07-01',weight:152}];
const M190 = mk({ weightLog:wl, goalTargets:{} }, () => 190);
check('one point per weigh-in', M190._gcWkgPts_(365).length, 4);
check('priced with the FTP in force on that date', M190._gcWkgPts_(365).map(p=>p.v), [2.39, 2.54, 2.65, 2.76]);
const M230 = mk({ weightLog:wl, goalTargets:{} }, () => 230);
check('a higher FTP moves the whole series', M230._gcWkgPts_(365).map(p=>p.v), [2.9, 3.07, 3.21, 3.34]);

console.log('\n=== the dashed target rule is drawn ONLY when 3.14 is inside the plotted range ===');
check('at FTP 190 the target sits above everything -> no rule', decide(M190._gcWkgPts_(365), 3.14).onChart, false);
const d230 = decide(M230._gcWkgPts_(365), 3.14);
check('at FTP 230 it falls inside -> rule drawn', d230.onChart, true);
check('...positioned by value, not centred', Math.round(d230.top*10)/10, 45.5);
check('the page series (2.07..2.82) also puts 3.14 out of range', decide([{v:2.07},{v:2.36},{v:2.82}], 3.14).onChart, false);

console.log('\n=== the caption never promises a line that is not there ===');
const capOn  = Mreal._gcTrend_([{v:2.9,lab:'a'},{v:3.34,lab:'b'}], '#6366f1', { H:44, note:'x &middot; dashed line is your 3.14 target' });
const capOff = Mreal._gcTrend_([{v:2.4,lab:'a'},{v:2.76,lab:'b'}], '#6366f1', { H:44, note:'x &middot; your 3.14 target is above everything on this chart' });
check('in-range caption says "dashed line"', capOn.indexOf('dashed line is your 3.14 target')>=0, true);
check('out-of-range caption says it is above the chart', capOff.indexOf('above everything on this chart')>=0, true);
check('and neither is a bar', /<rect|linear-gradient/.test(capOn+capOff), false);

console.log('\n=== honest degrade when there is nothing at all ===');
check('no weigh-ins and no page series -> a sentence, not a bar',
  /Log a few weigh-ins and this becomes a trend line toward/.test(hero), true);

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'wkg-card: all checks passed'+X));
process.exit(fails?1:0);
