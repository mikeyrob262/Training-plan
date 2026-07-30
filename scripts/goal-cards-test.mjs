// Analytics goal cards: FTP / Weight / W/kg / Weekly Distance / CTL.
//
// These were five pill bars ("92% of goal") - the exact pattern the standing rule exists to remove,
// and the last of the untraced sites from the original sweep. A percentage of a goal cannot say
// whether the athlete is climbing toward it or drifting away, which is the only question the card
// is read for. Each now shows the metric's own trajectory with the goal as a dashed reference
// where it falls in range, and the goal restated as text either way.
//
// Run: node scripts/goal-cards-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exVar(n){ let j=src.indexOf('var '+n+'='); if(j<0) j=src.indexOf('var '+n+' ='); if(j<0) throw new Error('missing var '+n);
  return src.slice(j, src.indexOf('\n', j))+'\n'; }

let code = exVar('_YVY_MON');
for (const f of ['_gcYMD_','_gcMonLab_','_gcSpark_','_goalSpark_']) code += ex(f);
const M = new Function(code + ';return {_goalSpark_,_gcSpark_};')();

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
const pts = (...v) => v.map((x, i) => ({ v:x, lab:'m'+i }));

// The card block, isolated so assertions are about THIS surface and not the whole file.
// Starts at the series builders, not at `var goals=[` — the builders are the half of this change
// that proves nothing new is being derived, and slicing below them tested the wrong thing.
const blk = src.slice(src.indexOf('  var _mon=function(d){'), src.indexOf('  wrap.appendChild(rowC);'));

console.log('\n=== the five pill bars are gone ===');
check('no value-driven width fill left in the block', /width:'\+_pc\+'%/.test(blk), false);
check('no percent-of-goal badge either', /'%<\/span>'/.test(blk) && /_pc/.test(blk), false);
check('the frac field that fed them is gone', /frac:Math\.min\(1,/.test(blk), false);
check('all five now carry a series', (blk.match(/pts:_/g) || []).length, 5);
check('all five carry a numeric target', (blk.match(/target:_G\./g) || []).length, 5);
check('and route through the shared helper', /_goalSpark_\(g\.pts, g\.color, g\.target/.test(blk), true);

console.log('\n=== each series is one the app ALREADY computes ===');
check('FTP  <- the live FTP log', /_ftpHistLive_\(\)/.test(blk), true);
check('Weight <- the live weigh-in log', /settingsArrLive_\('weightLog'\)/.test(blk), true);
check('W/kg <- weigh-in series, falling back to the page series', /_gcWkgPts_\(365\)/.test(blk) && /_wt\.pts\.map/.test(blk), true);
check('Weekly distance <- Mon-Sun buckets off the same rides', /mon\.setDate\(mon\.getDate\(\)-\(dw===0\?6:dw-1\)\)/.test(blk), true);
check('CTL  <- the fitness series', /_gcFitPts_\('ctl',90\)/.test(blk), true);
check('nothing new is derived — no fresh maths in the block', /Math\.pow|Math\.sqrt|\/ *0\.\d/.test(blk), false);

console.log('\n=== the dashed goal rule draws ONLY when the goal is in range ===');
const inRange = M._goalSpark_(pts(170,178,186,195), '#a855f7', 190, {});
const above   = M._goalSpark_(pts(170,175,180,183), '#a855f7', 200, {});
const below   = M._goalSpark_(pts(190,195,200,205), '#a855f7', 150, {});
check('goal inside the plotted range -> rule drawn', /border-top:1\.5px dashed/.test(inRange), true);
check('goal above everything -> no rule', /border-top:1\.5px dashed/.test(above), false);
check('goal below everything -> no rule', /border-top:1\.5px dashed/.test(below), false);
// Position, not a fixed offset: 190 across 170..195 sits 20% down from the top.
check('the rule is positioned by value', /top:20\.0%/.test(inRange), true);
check('a lower goal in range sits further down',
  /top:60\.0%/.test(M._goalSpark_(pts(170,178,186,195), '#a855f7', 180, {})), true);

console.log('\n=== the goal is readable even when the rule is not drawn ===');
check('goal printed as text on every card', (blk.match(/goal:'Goal /g) || []).length, 5);
check('and flagged when it sits off the plotted range', /off chart/.test(blk), true);
check('the off-chart test uses the SAME range check as the rule',
  /\(g\.target>=lo && g\.target<=hi\) \? '' : ' &middot; off chart'/.test(blk), true);

console.log('\n=== honest degrade ===');
check('one point is not a trend', /Not enough history yet|Log an FTP change/.test(M._goalSpark_(pts(183), '#fff', 200, {})), true);
check('no points at all -> a sentence, not an empty box',
  /Log a few weigh-ins/.test(M._goalSpark_([], '#fff', 150, { empty:'Log a few weigh-ins and this becomes a trend.' })), true);
check('each card supplies its own empty message', (blk.match(/empty:'/g) || []).length, 5);
check('a flat series still renders rather than dividing by zero', M._goalSpark_(pts(183,183,183), '#fff', 200, {}).indexOf('<svg') >= 0, true);
check('and draws no rule when there is no range to place it in',
  /border-top:1\.5px dashed/.test(M._goalSpark_(pts(183,183,183), '#fff', 183, {})), false);

console.log('\n=== weight is lower-is-better and still works ===');
// The old bar inverted the fraction for weight. A trend line needs no special case - the number
// goes down, the line goes down, and the goal sits below it.
const wt = M._goalSpark_(pts(175,168,162,159), '#22c55e', 150, {});
check('a falling series renders', wt.indexOf('<svg') >= 0, true);
check('a goal under the whole series draws no rule', /border-top:1\.5px dashed/.test(wt), false);
check('a goal inside it does', /border-top:1\.5px dashed/.test(M._goalSpark_(pts(175,168,162,159), '#22c55e', 165, {})), true);
check('no inverted-fraction special case survives', /_G\.weightLb\/Math\.max/.test(blk), false);

console.log('\n=== the dead bar fallback on the Performance cards is gone ===');
check('barW branch removed', /card\.barW!==null\?/.test(src), false);
check('...and it really was dead: every card sets barW:null', (src.match(/barW:null/g) || []).length, 9);
check('no card sets a non-null barW', /barW:[^n]/.test(src), false);

console.log('\n=== the shared helper, not a sixth copy of the pattern ===');
check('_goalSpark_ exists once', (src.match(/function _goalSpark_\(/g) || []).length, 1);
check('it reuses _gcSpark_ rather than drawing its own line', /_gcSpark_\(pts, col,/.test(ex('_goalSpark_')), true);
check('and it is compact — no axis footer on a five-across card', /_gcSparkFoot_/.test(ex('_goalSpark_')), false);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'goal-cards: all checks passed'+X));
process.exit(fails ? 1 : 0);
