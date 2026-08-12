// My Foods / My Meals.
//
// THE PROPERTY UNDER TEST: a saved meal stores a REFERENCE and a QUANTITY, never macros. Correct a
// food once and every meal containing it is correct immediately.
//
// It used to store both. A meal item read {n:'Egg Whole x2', cal:140, p:12} - quantity baked into
// the name, numbers pre-multiplied - so correcting Egg Whole fixed nothing that used it. Same
// duplicate-source failure as the food search, one layer down.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const NL = String.fromCharCode(10);

const st = {};
const DEFAULT_MY_FOODS = [{ n: 'Egg Whole', cal: 70, p: 6, c: 0, f: 5, srv: '1 large' }];
const DEFAULT_MY_MEALS = [];
let idn = 0;
const M = new Function('st', 'DEFAULT_MY_FOODS', 'DEFAULT_MY_MEALS', 'genEntryId_', 'sv', asServed(
  exFn('mfNewId_') + exFn('mmNewId_') + exFn('mfSrvText_') + exFn('mfNorm_') +
  exFn('getMyFoods') + exFn('getMyMeals') + exFn('mfById_') +
  exFn('mealItems_') + exFn('mealTotals_') + exFn('migrateMyFoodsMeals_') + NL +
  'return { mfNewId_, mfSrvText_, mfNorm_, getMyFoods, getMyMeals, mfById_, mealItems_, mealTotals_, migrateMyFoodsMeals_ };'
))(st, DEFAULT_MY_FOODS, DEFAULT_MY_MEALS, () => 'id' + (++idn), () => {});

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== correcting ONE food fixes every meal that uses it ===' + X);
{
  st.myFoods = [
    { id: 'mf:egg', n: 'Egg Whole', srvQty: 1, srvUnit: 'large', cal: 70, p: 6, c: 0, f: 5 },
    { id: 'mf:owyn', n: 'OWYN Elite Protein Shake, Chocolate, 32g', srvQty: 1, srvUnit: 'bottle', cal: 300, p: 32, c: 12, f: 9, fiber: 6, sodium: 380 }
  ];
  st.myMeals = [
    { id: 'mm:b', name: 'Standard Breakfast', meal: 'breakfast', items: [{ fid: 'mf:egg', qty: 2 }, { fid: 'mf:owyn', qty: 1 }] },
    { id: 'mm:r', name: 'Post-Ride Recovery', meal: 'postworkout', items: [{ fid: 'mf:owyn', qty: 2 }] }
  ];
  eq('breakfast totals from references', M.mealTotals_(st.myMeals[0]), { cal: 440, p: 44, c: 12, f: 19, fiber: 6, sodium: 380, missing: 0 });
  eq('recovery totals scale with qty', M.mealTotals_(st.myMeals[1]), { cal: 600, p: 64, c: 24, f: 18, fiber: 12, sodium: 760, missing: 0 });

  // THE point. One edit, no meal touched.
  st.myFoods[1].cal = 310; st.myFoods[1].p = 33;
  eq('...breakfast picks the correction up with no re-save', M.mealTotals_(st.myMeals[0]).cal, 450);
  eq('...and so does recovery, doubled', M.mealTotals_(st.myMeals[1]).cal, 620);
  eq('...protein too', M.mealTotals_(st.myMeals[1]).p, 66);
  ok('no macros are stored on the meal itself',
     Object.keys(st.myMeals[0].items[0]).every((k) => ['fid', 'qty', 'nameAtSave'].includes(k)));
}

console.log('\n' + Y + '=== a deleted food is FLAGGED, never silently zero ===' + X);
{
  st.myFoods = [{ id: 'mf:egg', n: 'Egg Whole', srvQty: 1, srvUnit: 'large', cal: 70, p: 6, c: 0, f: 5 }];
  st.myMeals = [{ id: 'mm:x', name: 'Broken', meal: 'lunch', items: [{ fid: 'mf:egg', qty: 1 }, { fid: 'mf:gone', qty: 1, nameAtSave: 'Deleted Thing' }] }];
  const rows = M.mealItems_(st.myMeals[0]);
  eq('the missing row is marked', rows[1].missing, true);
  eq('...its macros are null, not 0', rows[1].cal, null);
  eq('...and it keeps the name it was saved under', rows[1].name, 'Deleted Thing');
  eq('totals count the gap', M.mealTotals_(st.myMeals[0]).missing, 1);
  eq('...and do not quietly shrink to include it as zero', M.mealTotals_(st.myMeals[0]).cal, 70);
}

console.log('\n' + Y + '=== the legacy migration converts copies into references ===' + X);
{
  st.myFoods = [
    { n: 'Egg Whole', cal: 70, p: 6, c: 0, f: 5, srv: '1 large' },
    { n: 'OWYN Dark Chocolate Protein Shake', cal: 180, p: 26, c: 7, f: 5, fiber: 5, srv: '1 bottle' }
  ];
  st.myMeals = [{
    name: 'Typical Breakfast', emoji: '🍳',
    foods: [
      { n: 'Egg Whole x2', cal: 140, p: 12, c: 0, f: 10 },          // pre-multiplied copy
      { n: 'OWYN Dark Chocolate Protein Shake', cal: 180, p: 26, c: 7, f: 5, fiber: 5 },
      { n: 'Mystery Bar', cal: 200, p: 10, c: 25, f: 6 }            // no matching food
    ]
  }];
  const n = M.migrateMyFoodsMeals_();
  ok('the migration reported work', n > 0);
  const meal = st.myMeals[0];
  ok('foods[] is gone', meal.foods === undefined);
  eq('items[] replaced it', meal.items.length, 3);
  eq('"x2" became a quantity', meal.items[0].qty, 2);
  ok('...pointing at the base food', M.mfById_(meal.items[0].fid).n === 'Egg Whole');
  ok('...and the pre-multiplied copy was DISCARDED', M.mfById_(meal.items[0].fid).cal === 70);
  eq('the meal still totals the same', M.mealTotals_(meal).cal, 140 + 180 + 200);
  ok('every food gained an id', st.myFoods.every((f) => /^mf:/.test(f.id)));
  ok('the meal gained an id', /^mm:/.test(meal.id));
  eq('...and a category', meal.meal, 'breakfast');
  // The unmatched item must not be lost, and must land PER SERVING.
  const mystery = st.myFoods.filter((f) => f.n === 'Mystery Bar')[0];
  ok('an unknown food is promoted into My Foods', !!mystery);
  eq('...at per-serving values', mystery.cal, 200);
  eq('re-running the migration is a no-op', M.migrateMyFoodsMeals_(), 0);
}

console.log('\n' + Y + '=== an unmatched item with a quantity is divided back down ===' + X);
{
  st.myFoods = [];
  st.myMeals = [{ name: 'M', foods: [{ n: 'Rice Cake x4', cal: 140, p: 4, c: 28, f: 1.2 }] }];
  M.migrateMyFoodsMeals_();
  const rc = st.myFoods.filter((f) => f.n === 'Rice Cake')[0];
  ok('the base food is created without the multiplier in its name', !!rc);
  eq('...per serving, not per four', rc.cal, 35);
  eq('...carbs too', rc.c, 7);
  eq('the meal still totals what it did', M.mealTotals_(st.myMeals[0]).cal, 140);
}

console.log('\n' + Y + '=== serving size is a real quantity and unit, not a string ===' + X);
{
  st.myFoods = [{ n: 'Whey', cal: 130, p: 28, c: 3, f: 1, srv: '1 scoop' }, { n: 'Oats', cal: 150, p: 5, c: 27, f: 3, srv: '40g' }];
  st.myMeals = [];
  M.migrateMyFoodsMeals_();
  eq('"1 scoop" splits', [st.myFoods[0].srvQty, st.myFoods[0].srvUnit], [1, 'scoop']);
  eq('"40g" splits', [st.myFoods[1].srvQty, st.myFoods[1].srvUnit], [40, 'g']);
  eq('and renders back', M.mfSrvText_(st.myFoods[0]), '1 scoop');
  eq('...for the gram case too', M.mfSrvText_(st.myFoods[1]), '40 g');
  ok('the unit list offers concrete real-world units', /bottle/.test(src) && /scoop/.test(src));
}

console.log('\n' + Y + '=== name matching for the migration only ===' + X);
{
  eq('case and punctuation folded', M.mfNorm_('OWYN  Dark-Chocolate, 32g'), 'owyn dark chocolate 32g');
  ok('the \\s escape survived the served template', !/replace\(\/s\+\/g/.test(asServed(exFn('mfNorm_'))));
}

console.log('\n' + Y + '=== the forms collect what the spec requires ===' + X);
{
  const ed = exFn('openMyFoodEditor_');
  ok('name', /mfField_\('Name'/.test(ed));
  ok('serving is a quantity AND a unit, not a free string', /mfField_\('Serving'/.test(ed) && /MY_FOOD_UNITS/.test(ed));
  ok('...and the units offered are real-world ones', /'bottle','scoop','cup','g','oz'/.test(src));
  ok('calories', /mfField_\('Calories'/.test(ed));
  ok('protein / carbs / fat', /mfField_\('P \/ C \/ F'/.test(ed));
  ok('fiber and sodium', /mfField_\('Fiber \/ Sodium'/.test(ed));
  ok('brand note', /mfField_\('Brand'/.test(ed));
  ok('default meal category', /mfField_\('Usual meal'/.test(ed));
  // The scaling bug this record exists to end.
  ok('the form states the values are PER SERVING', /PER THIS SERVING/.test(ed));
  ok('name is required', /Give it a name specific enough/.test(ed));
  ok('serving qty is required and positive', /Serving quantity must be a number greater than zero/.test(ed));
  ok('calories are required', /Calories are required/.test(ed));

  const me = exFn('openMyMealEditor_');
  ok('meal name', /mfField_\('Name'/.test(me));
  ok('meal category', /mfField_\('Category'/.test(me));
  ok('foods are PICKED from My Foods, not retyped', /getMyFoods\(\)\.map/.test(me));
  ok('...with a quantity each', /qty:1/.test(me));
  ok('a meal cannot be saved empty', /A meal needs at least one food/.test(me));
  ok('saving stores fid+qty only - no macros', /\{ fid:it\.fid, qty:it\.qty, nameAtSave:/.test(me));
  ok('...and says why', /Storing macros here is what made a corrected food fail/.test(me));

  const add = exFn('openMealAddSheet_');
  ok('add-time review exists', add.length > 0);
  ok('...items can be dropped', /type='checkbox'/.test(add));
  ok('...quantities changed', /oninput=function\(\)\{ var v=mfNum_\(q\.value\)/.test(add));
  ok('...and the destination bucket overridden', /mfField_\('Into'/.test(add));
  ok('a missing food cannot be silently added', /cb\.disabled=!!r\.missing/.test(add));
  ok('Add All defaults to the meal\'s own category', /var b=meal\.meal\|\|curMeal/.test(exFn('renderMyMeals')));

  // Saving a logged meal must create real food records, not embed macros again.
  const sc = exFn('mfSaveCurrentMeal_');
  ok('saving a logged meal promotes entries into My Foods', /foods\.push\(hit\)/.test(sc));
  ok('...and references them', /items\.push\(\{ fid:hit\.id/.test(sc));
  ok('...reusing the source food when the entry came from one', /e\.srcFid\?mfById_\(e\.srcFid\)/.test(sc));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'My Foods / My Meals: all checks passed' + X));
process.exit(fails ? 1 : 0);
