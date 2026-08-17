// A PLAN SESSION'S ID DESCRIBES WHAT IT IS, NEVER WHERE IT SAT.
//
// A Sunday was carrying ~13 live sessions where it should hold about 2, and the day editor opened on
// contradictory garbage - "Session: Other / Intent: Z2 endurance" one time, "Session: Rest" the next.
// One cause, and it was a single line:
//
//   s.id = 'plan-' + key + '-' + day.sessions.length;
//
// POSITIONAL. And day.sessions INCLUDES TOMBSTONES, because a removal here is a tombstone and never
// a splice. So every generator run read a length its own previous tombstone had just grown, minted a
// brand-new id, and appended another row. itemsMatch_ matches by id ONLY - "two entries with
// different ids are different entries even when their content is identical" - so they never collapse.
//
// Across devices it is worse: two devices with different tombstone counts assign the SAME positional
// id to DIFFERENT sessions, which merge field-wise into one hybrid row. A type from one generation
// and an intent from another is exactly what the editor was showing.
//
// This file proves the old scheme grows and the new one does not, using the real functions.
//
// Run: node scripts/plan-dupe-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

console.log('\n' + Y + '=== the positional id is gone ===' + X);
ok('NEG: no id is minted from array length', !/s\.id='plan-'\+key\+'-'\+day\.sessions\.length/.test(src));
ok('a generated id is derived from type + intent', /s\.id='plan-'\+key\+'-'\+\(s\.type\|\|'x'\)\+'-'\+\(s\.intent\|\|'x'\)/.test(src));
ok('...with a slot index only for a genuine repeat', /\(slotIdx>0\?\('-'\+slotIdx\):''\)/.test(src));
ok('the generator supplies that index from its own iteration', /planUpsertSession_\(key, s, \['type','name','intent','status'\], 'gen', idx\)/.test(src));
ok('...counted per identity, not per day', /var sk=\(s\.type\|\|'x'\)\+'\|'\+\(s\.intent\|\|'x'\);/.test(src));

console.log('\n' + Y + '=== repeated generation stops growing the day ===' + X);
{
  // The REAL upsert, driven the way generateBlockPlan_ drives it: tombstone the replaceable rows,
  // then re-add the block's slots.
  const stub = {
    normDate: (d) => d,
    planDay_: (k, make) => day,
    _planCoherce_: (x) => x,
    normalizeSession_: (x) => x,
    validateSession_: () => [],
    markPlanEdited_: (s, f) => { (s._edited = s._edited || {}); (f||[]).forEach((x)=>s._edited[x]=1); s.editedAt = 1; return s; }
  };
  let day;
  const names = Object.keys(stub);
  const upsert = new Function(...names, asServed(exFn('planUpsertSession_') + 'return planUpsertSession_;'))(...names.map((n)=>stub[n]));
  function generation(slots){
    day.sessions.forEach((s) => { if (s.source === 'gen' && !s.deleted && s.status !== 'completed') s.deleted = true; });
    const seen = {};
    slots.forEach((sl) => {
      const s = { type: sl.type, intent: sl.intent, name: sl.name, status: 'planned' };
      const k = s.type + '|' + s.intent; const idx = seen[k] || 0; seen[k] = idx + 1;
      upsert('2026-08-23', s, ['type','name','intent','status'], 'gen', idx);
    });
  }
  const SUNDAY = [{ type:'run', intent:'easyRun', name:'Easy Run' }];
  day = { sessions: [] };
  for (let i = 0; i < 7; i++) generation(SUNDAY);
  eq('seven generator runs leave ONE row, not seven', day.sessions.length, 1);
  eq('...and it is live', day.sessions.filter((s)=>!s.deleted).length, 1);
  eq('...at a stable, derived id', day.sessions[0].id, 'plan-2026-08-23-run-easyRun');

  // A day with two sessions of DIFFERENT identity keeps both, forever.
  const FRIDAY = [{ type:'ride', intent:'z2', name:'Z2 Endurance' }, { type:'strength', intent:'strengthA', name:'Strength A' }];
  day = { sessions: [] };
  for (let i = 0; i < 5; i++) generation(FRIDAY);
  eq('two distinct sessions stay two rows across five runs', day.sessions.length, 2);
  eq('...with derived ids', day.sessions.map((s)=>s.id).sort(),
     ['plan-2026-08-23-ride-z2', 'plan-2026-08-23-strength-strengthA']);

  // A genuine repeat of ONE identity still gets distinct ids, and still does not grow.
  const TWO_STRENGTH = [{ type:'strength', intent:'strengthA', name:'A' }, { type:'strength', intent:'strengthA', name:'A' }];
  day = { sessions: [] };
  for (let i = 0; i < 4; i++) generation(TWO_STRENGTH);
  eq('a repeated identity keeps two rows, not eight', day.sessions.length, 2);
  eq('...disambiguated by slot index', day.sessions.map((s)=>s.id),
     ['plan-2026-08-23-strength-strengthA', 'plan-2026-08-23-strength-strengthA-1']);

  // CROSS-DEVICE: the same slot on two devices must resolve to the SAME id, or the merge keeps both.
  let dayA, dayB;
  day = dayA = { sessions: [] }; generation(SUNDAY);
  day = dayB = { sessions: [] }; generation(SUNDAY);
  eq('two devices generating the same day agree on the id', dayA.sessions[0].id, dayB.sessions[0].id);
  // ...and a USER session is never derived, so it cannot collide with a generated slot.
  day = { sessions: [] };
  const u = upsert('2026-08-23', { type:'run', intent:'easyRun', name:'My own run' }, null, 'user');
  ok('a user session gets its own non-derived id', /^plan-2026-08-23-u\d+/.test(u.id));
  ok('...which cannot collide with the generated one', u.id !== 'plan-2026-08-23-run-easyRun');
}

console.log('\n' + Y + '=== the rows already stored get collapsed ===' + X);
{
  const stub = {
    _planUserOwned_: (s) => s && s.source === 'user',
    markPlanEdited_: (s, f) => { (s._edited = s._edited || {}); (f||[]).forEach((x)=>s._edited[x]=1); s.editedAt = 999; return s; },
    sv: () => {},
    console: { log(){}, error(){} }
  };
  const names = Object.keys(stub);
  // The version constant has to be passed in. Leave it out and it is `undefined` inside the
  // function, the guard compares undefined === undefined on fresh state, and the heal silently
  // returns 0 having done nothing - which looks exactly like a broken heal.
  const VER = (src.match(/_PLAN_DEDUPE_V='([^']+)'/) || [])[1];
  ok('the version constant is declared', !!VER);
  function run(plan){
    const st = { plan: plan };
    const f = new Function('st', '_PLAN_DEDUPE_V', ...names,
      asServed(exFn('healPlanDuplicates_') + 'return healPlanDuplicates_;'))(st, VER, ...names.map((n)=>stub[n]));
    const n = f();
    return { n, st };
  }
  // The reported shape: one Sunday, many live copies of one session.
  const many = { sessions: Array.from({length: 13}, (_, i) => ({ id:'plan-2026-08-23-'+i, type:'run', intent:'easyRun', source:'gen', editedAt: i })) };
  let r = run({ '2026-08-23': many });
  eq('twelve of thirteen duplicates are removed', r.n, 12);
  eq('...leaving exactly one live row', many.sessions.filter((s)=>!s.deleted).length, 1);
  // The SURVIVOR keeps its own clock - it was not modified, so re-stamping it would claim an edit
  // that never happened. Only the tombstones are stamped, because a removal needs a clock to travel.
  eq('...the most recently stamped one, id intact', many.sessions.filter((s)=>!s.deleted)[0].id, 'plan-2026-08-23-12');
  eq('...and it is NOT re-stamped, having not been changed', many.sessions.filter((s)=>!s.deleted)[0].editedAt, 12);
  ok('...and the rest are TOMBSTONED, not spliced', many.sessions.length === 13 && many.sessions.filter((s)=>s.deleted).length === 12);
  ok('...each tombstone stamped so the removal travels', many.sessions.filter((s)=>s.deleted).every((s)=>s.editedAt === 999 && s._edited && s._edited.deleted));

  // An athlete-owned row outranks a generated one, even if the generated one is newer.
  const mixed = { sessions: [
    { id:'a', type:'run', intent:'easyRun', source:'gen',  editedAt: 500 },
    { id:'b', type:'run', intent:'easyRun', source:'user', editedAt: 1 }
  ]};
  run({ '2026-09-06': mixed });
  eq('the athlete-owned row survives over a newer generated one',
     mixed.sessions.filter((s)=>!s.deleted).map((s)=>s.id), ['b']);

  // A completed row carries a result and must never be collapsed away.
  const done = { sessions: [
    { id:'a', type:'ride', intent:'z2', source:'gen', editedAt: 900 },
    { id:'b', type:'ride', intent:'z2', source:'gen', editedAt: 1, status:'completed' }
  ]};
  run({ '2026-08-10': done });
  eq('a completed row outranks a newer planned duplicate',
     done.sessions.filter((s)=>!s.deleted).map((s)=>s.id), ['b']);

  // NEG: genuinely different sessions on one day are not duplicates.
  const real = { sessions: [
    { id:'a', type:'ride', intent:'z2', source:'gen', editedAt: 1 },
    { id:'b', type:'strength', intent:'strengthA', source:'gen', editedAt: 1 }
  ]};
  r = run({ '2026-08-21': real });
  eq('NEG: a ride and a strength session are left alone', r.n, 0);
  eq('...both still live', real.sessions.filter((s)=>!s.deleted).length, 2);
  // NEG: a healthy day is untouched.
  const healthy = { sessions: [{ id:'a', type:'run', intent:'easyRun', source:'gen', editedAt: 1 }] };
  eq('NEG: a single-row day is untouched', run({ '2026-08-24': healthy }).n, 0);
  // NEG: existing tombstones are not counted as duplicates of each other.
  const tombs = { sessions: [
    { id:'a', type:'run', intent:'easyRun', source:'gen', deleted:true },
    { id:'b', type:'run', intent:'easyRun', source:'gen', deleted:true },
    { id:'c', type:'run', intent:'easyRun', source:'gen' }
  ]};
  eq('NEG: tombstones are ignored, only live rows collapse', run({ '2026-08-25': tombs }).n, 0);
}

console.log('\n' + Y + '=== the heal converges and runs where it can see the merge ===' + X);
ok('version stamped, so it runs once per client', /st\._planDedupeV=_PLAN_DEDUPE_V;/.test(src));
ok('...and returns early once stamped', /if\(st\._planDedupeV===_PLAN_DEDUPE_V\) return 0;/.test(src));
{
  const heal = src.indexOf("typeof healPlanDuplicates_==='function') healPlanDuplicates_();");
  const lap = src.indexOf("typeof healStaleLaps_==='function') healStaleLaps_();");
  ok('runs in the post-pull block with the other repairs', heal > lap && heal - lap < 1200);
}
ok('tombstones rather than splices', /x\.deleted=true;\s*\n\s*if\(typeof markPlanEdited_==='function'\) markPlanEdited_\(x,\['deleted'\]\);/.test(src));
ok('NEG: nothing is spliced out of the sessions array', !/sessions\.splice\(/.test(src));

console.log('');
if (fails) { console.log(R + 'plan dupe: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'plan dupe: all checks passed' + X + '\n');
