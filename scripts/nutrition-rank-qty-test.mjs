// Food-search ranking (generic over branded) and fractional portions.
//
// The interesting failure for ranking is NOT "does a generic ever come first" - it is that a
// generic must not out-rank an EXACT branded match the athlete typed by name. The interesting
// failure for quantities is that a half portion must survive the round trip: be enterable, be
// visible on the row, and scale every macro, including back up again.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exv(name){ const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name);
  return src.slice(i, src.indexOf('\n', i))+'\n'; }

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(label,cond)=>{ if(!cond)fails++; console.log('  '+(cond?G+'PASS'+X:R+'FAIL'+X)+'  '+label); };

const H = new Function(asServed(exv('_NL_GENERIC_BONUS')+ex('_nlNorm_')+ex('_nlRelevance_')+ex('_nlIsGenericTier_')+ex('_nlRankFoods_')
  +ex('_nlQtyStr_')+ex('_nlQtyLabelHtml_')+ex('_nlQtyLabel_'))
  +';return {_nlNorm_,_nlRelevance_,_nlIsGenericTier_,_nlRankFoods_,_nlQtyStr_,_nlQtyLabel_,_nlQtyLabelHtml_};')();

console.log('\n'+C+'=== generic beats branded when the match is comparable ==='+X);
const cheeseRows = [
  { n:"Culver's Beef Pot Roast Sandwich - Culver's", generic:false, dataType:'Local' },
  { n:'Cheeseburger - Five Guys', generic:false, dataType:'Local' },
  { n:'Cheese, cheddar', generic:true, dataType:'SR Legacy' },
  { n:'CHEESE - Wegmans', generic:false, dataType:'Branded' }
];
check('a generic ingredient surfaces above branded rows that merely match',
  H._nlRankFoods_(cheeseRows, 'cheese')[0].n, 'Cheese, cheddar');
// FOUND ON LIVE DATA, not in a fixture: the proxy marks an unbranded LOCAL row generic, which is
// true of prepared items like "Cheese Pizza Slice" and "Milk Chocolate". Taking the flag at face
// value tied them with "Cheese, cheddar" at 95 apiece and the local row won on source order.
const withLocalPrepared = [
  { n:'Cheese Pizza Slice', generic:true, dataType:'Local' },
  { n:'Cheese, cheddar', generic:true, dataType:'SR Legacy' }
];
check('an unbranded LOCAL prepared item does not earn the ingredient bonus',
  H._nlRankFoods_(withLocalPrepared, 'cheese')[0].n, 'Cheese, cheddar');
check('...because the bonus is tier-based', H._nlIsGenericTier_({generic:true, dataType:'Local'}), false);
check('Foundation earns it', H._nlIsGenericTier_({generic:true, dataType:'Foundation'}), true);
check('SR Legacy earns it', H._nlIsGenericTier_({generic:true, dataType:'SR Legacy'}), true);
check('Branded never earns it', H._nlIsGenericTier_({generic:true, dataType:'Branded'}), false);

console.log('\n'+C+'=== ...but never above an exact branded match the athlete typed ==='+X);
const qpRows = [
  { n:'Beef, ground, raw', generic:true, dataType:'SR Legacy' },
  { n:'Quarter Pounder with Cheese - McDonald’s', generic:false, dataType:'Local' },
  { n:'Quarter Pounder', generic:false, dataType:'Local' }
];
check('an exact-name branded hit still wins', H._nlRankFoods_(qpRows, 'quarter pounder')[0].n, 'Quarter Pounder');
ok('...and the weak generic does not jump it',
   H._nlRankFoods_(qpRows, 'quarter pounder').findIndex(x => x.n === 'Beef, ground, raw') > 0);
// The bonus is worth about one relevance band, not a free pass.
ok('the generic bonus is smaller than the gap between an exact and a partial match',
   H._nlRelevance_('Quarter Pounder', 'quarter pounder') - H._nlRelevance_('Beef, ground, raw', 'quarter pounder') > 15);

console.log('\n'+C+'=== the sort is stable and total ==='+X);
const tie = [{n:'Cheese A',generic:true},{n:'Cheese B',generic:true},{n:'Cheese C',generic:true}];
check('equal scores keep source order', H._nlRankFoods_(tie,'cheese').map(x=>x.n), ['Cheese A','Cheese B','Cheese C']);
check('nothing is dropped', H._nlRankFoods_(cheeseRows,'cheese').length, cheeseRows.length);
check('an empty list is fine', H._nlRankFoods_([], 'x'), []);
check('a null list is fine', H._nlRankFoods_(null, 'x'), []);
ok('rows with no generic flag are ranked, not crashed on',
   H._nlRankFoods_([{n:'Milk'},{n:'Milk, whole',generic:true}],'milk').length===2);

console.log('\n'+C+'=== fractional quantities are visible ==='+X);
// The old test was _qty>1, which hid every fraction: a half portion looked identical to a whole one.
check('a half portion is shown', H._nlQtyLabel_('Pizza Slice', 0.5), 'Pizza Slice ×0.5');
check('exactly one is NOT annotated', H._nlQtyLabel_('Pizza Slice', 1), 'Pizza Slice');
check('a whole number is not shown as 2.0', H._nlQtyLabel_('Pizza Slice', 2), 'Pizza Slice ×2');
check('quarters survive', H._nlQtyStr_(0.25), '0.25');
check('a missing quantity is treated as one', H._nlQtyLabel_('Pizza Slice', undefined), 'Pizza Slice');
check('zero or negative never renders a quantity', H._nlQtyLabel_('Pizza Slice', 0), 'Pizza Slice');
// Desktop builds HTML and uses the entity; the two renderers must agree on the rule.
check('the desktop variant uses the entity', H._nlQtyLabelHtml_('Pizza Slice', 0.5), 'Pizza Slice &times;0.5');
check('...and hides x1 the same way', H._nlQtyLabelHtml_('Pizza Slice', 1), 'Pizza Slice');

console.log('\n'+C+'=== the stepper can reach, and leave, a half ==='+X);
// Run the real nutStepFood_ with stubs, so the arithmetic is tested rather than the regex.
function runStep(startQty, macros, deltas){
  let item = Object.assign({ id:'x1', n:'Pizza Slice', _baseName:'Pizza Slice', _qty:startQty }, macros);
  const day = { meals: { lunch: [item] } };
  let removed = false;
  const fn = new Function('getNDay','nutrDate','nutResolveIdx_','_nlName_','genEntryId_','sv','nutRefresh',
    asServed(ex('nutStepFood_'))+';return nutStepFood_;')(
    () => day, '2026-08-09',
    () => (day.meals.lunch[0] && !day.meals.lunch[0].deleted) ? 0 : -1,
    (x) => String(x==null?'':x).trim() || 'Food',
    () => 'gen', () => {}, () => {});
  deltas.forEach(d => fn('lunch','x1',d));
  const out = day.meals.lunch[0];
  return out.deleted ? null : out;
}
const M = { cal:280, p:12, c:36, f:10, fiber:2, satFat:5, sodium:640, sugar:4 };
check('1 steps DOWN to a half rather than being deleted', runStep(1, M, [-1])._qty, 0.5);
check('...and the macros halve', (r=>[r.cal,r.p,r.c,r.f])(runStep(1,M,[-1])), [140,6,18,5]);
check('a half steps back UP to one', runStep(0.5, {cal:140,p:6,c:18,f:5}, [1])._qty, 1);
check('...restoring the macros', (r=>[r.cal,r.p,r.c,r.f])(runStep(0.5,{cal:140,p:6,c:18,f:5},[1])), [280,12,36,10]);
check('a half stepped down again is removed', runStep(0.5, {cal:140,p:6,c:18,f:5}, [-1]), null);
check('2 steps down in whole units', runStep(2, {cal:560,p:24,c:72,f:20}, [-1])._qty, 1);
check('a full round trip 1 -> 0.5 -> 1 keeps the quantity', runStep(1, M, [-1,1])._qty, 1);
check('every macro scales, not just calories',
  (r=>[r.fiber,r.satFat,r.sodium,r.sugar])(runStep(1,M,[-1])), [1,2.5,320,2]);
check('stepping up from 1 goes to 2, not 1.5', runStep(1, M, [1])._qty, 2);

console.log('\n'+C+'=== wired in, both renderers ==='+X);
const codeLines = src.split(/\r?\n/).filter(L => !/^\s*\/\//.test(L));
// Ranking moved from _nlRankFoods_(results) to _nlRankPool_(local, results) when the local-first
// short circuit was removed: local and USDA are now scored together in ONE pool, so a loose
// local hit can no longer outrank - or suppress - a better USDA one. See food-search-test.mjs.
ok('the search results are ranked before rendering', /results = _nlRankPool_\(local, results, q\)/.test(src));
ok('...and local is ranked too, not just concatenated', /_nlRankPool_\(local, \[\], q\)/.test(src));
ok('the tier fields are carried through, not dropped',
   /dataType: f\.dataType\|\|null/.test(src) && /generic: \(f\.generic===true\)/.test(src));
ok('no renderer still hides a fraction behind _qty>1',
   !codeLines.some(L => /_qty>1/.test(L)));
ok('the mobile row uses the shared label', /_nlQtyLabel_\(item\.n, item\._qty\)/.test(src));
ok('the desktop row uses the shared label', /_nlQtyLabelHtml_\(it\._baseName\|\|it\.n, it\._qty\)/.test(src));
ok('the quantity input accepts fractions', /qtyInput\.step = '0\.5'/.test(src) && /qtyInput\.min = '0\.1'/.test(src));
ok('the add path scales by the parsed float', /var q = parseFloat\(qi\.value\)\|\|1/.test(src));

console.log(fails ? '\n'+R+'nutrition rank/qty: '+fails+' FAILED'+X+'\n' : '\n'+G+'nutrition rank/qty: all checks passed'+X+'\n');
process.exit(fails?1:0);
