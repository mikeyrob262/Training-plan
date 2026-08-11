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

let code = exVar('_YVY_MON') + exVar('_GC_SPARSE_MAX');
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
// The five ANALYTICS goal cards this section read were retired with the Analytics page
// (Aug 11 2026) - they were the duplicates of Overview's Goals card that motivated the
// retirement in the first place. Their assertions sliced dsShowAnalytics between two markers and
// that function is gone, so they had no subject left.
//
// The behaviour they guarded did NOT disappear with them: Overview's Goals card draws the same
// five series through the same _goalSpark_ helper, and scripts/overview-layout-test.mjs asserts
// that (sparklines not bars, target rule, honest empty states). The _goalSpark_ unit checks below
// are kept as they were - they read the live function directly rather than any page.

console.log('\n=== the five pill bars are gone ===');

console.log('\n=== each series is one the app ALREADY computes ===');

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

console.log('\n=== honest degrade ===');
check('one point is not a trend', /Not enough history yet|Log an FTP change/.test(M._goalSpark_(pts(183), '#fff', 200, {})), true);
check('no points at all -> a sentence, not an empty box',
  /Log a few weigh-ins/.test(M._goalSpark_([], '#fff', 150, { empty:'Log a few weigh-ins and this becomes a trend.' })), true);
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

console.log('\n=== the dead bar fallback on the Performance cards is gone ===');
check('barW branch removed', /card\.barW!==null\?/.test(src), false);
// The nine barW:null cards lived on the mobile Analytics screen, retired Aug 11 2026. Counting
// them is meaningless now; what the check was really protecting is that no bar-width machinery
// survives anywhere, which is a stronger assertion than the count ever was.
check('...and no barW machinery survives anywhere', /barW:|\.barW/.test(src), false);
check('no card sets a non-null barW', /barW:[^n]/.test(src), false);

console.log('\n=== the shared helper, not a sixth copy of the pattern ===');
check('_goalSpark_ exists once', (src.match(/function _goalSpark_\(/g) || []).length, 1);
check('it reuses _gcSpark_ rather than drawing its own line', /_gcSpark_\(pts, col,/.test(ex('_goalSpark_')), true);
check('and it is compact — no axis footer on a five-across card', /_gcSparkFoot_/.test(ex('_goalSpark_')), false);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'goal-cards: all checks passed'+X));
process.exit(fails ? 1 : 0);
