// The daily mobility routine, updated 2026-08-24: 8 items, 15-17 min, in a prescribed ORDER,
// replacing a 21-item four-goal menu.
//
// Two things had to be right before the list could be swapped at all, and both are the same class
// of bug this codebase keeps paying for:
//
//   1. IDENTITY. Completion was stored as st.mob[date].done[ARRAY INDEX]. Editing the list
//      re-points every historical tick at whatever now sits at that index. Ids are slugs of the
//      name, so the record says WHAT was done, not WHERE it sat.
//
//   2. THE KEY. getMobStreak built its date key UNPADDED — '2026-8-24' — while every writer uses
//      getTodayKey(), which pads. For all of August it looked up a bucket nothing had ever
//      written and reported 0.
//
// The negative controls are the load-bearing ones: a tick left over from the OLD list must not
// count toward the new routine's progress, and it must still count as a real mobility day in the
// streak, because a day in March on which six of twenty-one were done was a real day.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// SOURCE-AGNOSTIC. No argument reads worker.js (what preflight wants); a URL reads what the Worker
// actually SERVES, which is the only thing that answers "does it work in the browser" and the one
// check that catches the served-template escape trap. Served text needs no unescaping, so asServed
// is the identity there.
//   node scripts/mobility-routine-test.mjs https://training-plan.mgrobinson07.workers.dev/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : null;
const LIVE = !!URL_;
const src = LIVE
  ? await (await fetch(URL_, { cache: 'no-store' })).text()
  : fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = LIVE ? (s) => s
  : (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'),
    (_, c) => (c === BS ? BS : c));
// Source-text assertions must look at the MOBILITY MODULE, not the whole document — served, `src`
// is a 4.7 MB page carrying bundled libraries that would match loose patterns by coincidence.
const MOB_SRC = (function(){
  const i = src.indexOf('function renderMob(');
  const j = src.indexOf('var MOB_EX');
  const from = Math.min(i < 0 ? j : i, j < 0 ? i : j);
  return from < 0 ? src : src.slice(from, Math.max(i, j) + 20000);
})();

function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing fn ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + BS + 's*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const exObj = (n, open, close) => {
  const m = src.match(new RegExp('var ' + n + BS + 's*='));
  const i = m ? m.index : -1;
  if (i < 0) throw new Error('missing ' + n);
  let j = src.indexOf(open, i), d = 0, k = j;
  for (; k < src.length; k++) { const c = src[k]; if (c === open) d++; else if (c === close) { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';\n';
};

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

function load(mob) {
  const body = 'var st={mob:' + JSON.stringify(mob || {}) + '};\n' +
    exObj('MOB_EX', '[', ']') + exObj('MOB_AREAS', '{', '}') + exVar('MOB_DAY_DONE_MIN') +
    exFn('_mobKey_') + exFn('mobRoutineDone_') + exFn('mobDoneCount_') + exFn('getMobStreak') +
    exFn('getTodayKey') +
    'return { st, MOB_EX, MOB_AREAS, MOB_DAY_DONE_MIN, _mobKey_, mobRoutineDone_, mobDoneCount_,' +
    ' getMobStreak, getTodayKey };';
  return new Function(asServed(body))();
}

const M = load();
const IDS = M.MOB_EX.map(e => e[4]);

console.log('\n' + Y + '=== the routine is the one that was prescribed ===' + X);
{
  eq('eight items', M.MOB_EX.length, 8);
  eq('in the prescribed order', M.MOB_EX.map(e => e[0]), [
    'Heel Walking', 'Couch Stretch', 'Kneeling Hip Flexor Stretch', 'Standing Calf Stretch',
    'Adductor Rock-Back', 'Eccentric Toe Raises', 'Tib Anterior Massage + CBD', 'Legs Up the Wall']);
  ok('the adductor rock-back is in it — the one new stretch', IDS.indexOf('adductor-rock-back') === 4);
  ok('legs up the wall is LAST — it is the recovery block, not a stretch',
    IDS[IDS.length - 1] === 'legs-up-wall');
  ok('heel walking is FIRST', IDS[0] === 'heel-walking');
  eq('every item names a target area that exists',
    M.MOB_EX.filter(e => !M.MOB_AREAS[e[3]]).map(e => e[0]), []);
  ok('both priority issues are represented',
    M.MOB_EX.some(e => e[3] === 'tib') && M.MOB_EX.some(e => e[3] === 'groin'));
  eq('three exercises target the tib anterior', M.MOB_EX.filter(e => e[3] === 'tib').length, 3);
}

console.log('\n' + Y + '=== identity is a stable id, never the array position ===' + X);
{
  eq('every item carries an id', M.MOB_EX.filter(e => !e[4]).length, 0);
  eq('the ids are unique', new Set(IDS).size, IDS.length);
  ok('ids are slugs, not numbers', IDS.every(id => /^[a-z][a-z0-9-]*$/.test(id)));
  ok('the renderer keys completion on ex[4]', /var idx=ex\[4\];/.test(MOB_SRC));
  ok('NEG: it no longer keys on the loop index', !/var done=day\.done\[i\]\|\|false/.test(MOB_SRC));
}

console.log('\n' + Y + '=== progress counts the CURRENT routine only ===' + X);
{
  const day = { done: {} };
  eq('nothing done', M.mobRoutineDone_(day), 0);
  day.done['heel-walking'] = true;
  day.done['legs-up-wall'] = true;
  eq('two of the routine', M.mobRoutineDone_(day), 2);

  // A tick from the old 21-item list, stored under a numeric index.
  const stale = { done: { 3: true, 7: true, 11: true, 'heel-walking': true } };
  eq('a leftover numeric tick is NOT progress through the new routine  [negative control]',
    M.mobRoutineDone_(stale), 1);
  ok('...but it is still a real mobility day for the streak',
    M.mobDoneCount_ && true);
  const M2 = load({ '2026-03-02': stale });
  eq('...counted as four ticks, not one', M2.mobDoneCount_('2026-03-02'), 4);

  eq('a false value is not a tick', M.mobRoutineDone_({ done: { 'heel-walking': false } }), 0);
  eq('a missing day is zero, not a throw', M.mobRoutineDone_(null), 0);
}

console.log('\n' + Y + '=== the streak reads the bucket the app actually writes ===' + X);
{
  const today = new Date();
  const pad = (n) => ('0' + n).slice(-2);
  const padded = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const unpadded = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();

  eq('_mobKey_ pads, matching getTodayKey', M._mobKey_(today), padded);
  eq('...and getTodayKey agrees', M.getTodayKey(), padded);

  const full = () => { const d = {}; IDS.forEach(i => { d[i] = true; }); return { done: d }; };
  const y = new Date(); y.setDate(y.getDate() - 1);
  const y2 = new Date(); y2.setDate(y2.getDate() - 2);
  const kd = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());

  const live = load({ [padded]: full(), [kd(y)]: full(), [kd(y2)]: full() });
  eq('three consecutive full days is a streak of three', live.getMobStreak(), 3);

  // THE BUG, reproduced: the same data written under the unpadded key is invisible.
  const bad = load({ [unpadded]: full(), [kd(y)]: full() });
  ok('an unpadded key is not found  [this is what the streak used to build]',
    bad.getMobStreak() < 2 || padded === unpadded);

  eq('an empty store is a streak of zero', load({}).getMobStreak(), 0);

  // Today incomplete must not end a streak that yesterday earned.
  const partial = { done: { 'heel-walking': true } };
  const carried = load({ [padded]: partial, [kd(y)]: full(), [kd(y2)]: full() });
  eq('today unfinished still leaves yesterday counting', carried.getMobStreak(), 2);
}

console.log('\n' + Y + '=== the completeness bar is one constant ===' + X);
{
  ok('MOB_DAY_DONE_MIN is a number', typeof M.MOB_DAY_DONE_MIN === 'number');
  ok('...and it is reachable within the routine', M.MOB_DAY_DONE_MIN <= M.MOB_EX.length);
  const hard = (MOB_SRC.match(/done>=6\b/g) || []).length;
  eq('NEG: no hand-typed 6 survives as a threshold', hard, 0);
}

console.log('\n' + Y + '=== the row body has ONE builder ===' + X);
{
  // The toggle used to rebuild the row from a second template that had already lost the tutorial
  // link, so ticking an exercise silently deleted it.
  ok('the toggle reuses infoHTML', /capInfo\.innerHTML=infoHTML\(d\);/.test(MOB_SRC));
  ok('the first paint uses it too', /info\.innerHTML=infoHTML\(done\);/.test(MOB_SRC));
  const builders = (MOB_SRC.match(/mobility stretch tutorial/g) || []).length;
  eq('the tutorial link is written in exactly one place', builders, 1);
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'mobility routine: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
