// THE CALENDAR HAS TO ASK THE BLOCK, NOT JUST READ st.plan.
//
// Reported: after the Sunday run build shipped, the Calendar still showed Sunday as "Rest Day".
// Suspected as the stale-row class fixed by migratePlanIntentsToBlock_ (61bf910). It is not that,
// and the migrate pattern would not have fixed it:
//
//   blockPlanFor_ appears NOWHERE in the calendar renderer. The Calendar read st.plan and nothing
//   else, so everything the block DERIVES rather than stores was invisible to it - the Sunday run
//   distance, the Ven-Top climb rehearsal, the A/B/C/D strength rotation. Those are resolved at read
//   time BY DESIGN, precisely so they cannot go stale; copying them into st.plan to make the Calendar
//   see them would recreate the staleness they exist to avoid.
//
// So the fix is a missing READ PATH, not a data migration. blockPlannedForDate_ returns the block in
// getPlannedWorkoutForDate's shape, and both calendar renderers fall back to it.
//
// TWO THINGS MUST STILL BEAT THE BLOCK, and they are the whole risk of this change:
//   swap===true - the one thing this codebase treats as an athlete DECISION
//   a TOMBSTONE - re-showing a deleted session from the block would undo a deletion
//
// Run: node scripts/cal-block-fallback-test.mjs
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

console.log('\n' + Y + '=== the block adapter, exercised ===' + X);
{
  const DEFS = { easyRun:{type:'run',name:'Easy Run'}, z2:{type:'ride',name:'Z2 Endurance'},
                 strengthA:{type:'strength',name:'Strength A'}, rest:{type:'rest',name:'Rest'} };
  const mk = (sessions) => new Function('SESSION_DEFS', 'blockPlanFor_',
      asServed(exFn('blockPlannedForDate_') + 'return blockPlannedForDate_;'))
    (DEFS, () => (sessions ? { sessions } : null));

  const run = mk([{ intent:'easyRun', struct:'5.0 mi easy', rx:{ name:'Easy Run', targets:{durationMin:53} }, runMi:5.0 }]);
  const r = run('2026-09-20');
  eq('the Sunday run resolves', [r.name, r.type, r.intent], ['Easy Run', 'run', 'easyRun']);
  // The struct is the interesting part - a bare minute count throws the distance away, which is the
  // entire thing the ramp exists to say.
  eq('...carrying the ramp distance, not just a duration', r.dur, '5.0 mi easy');
  eq('...and the distance is exposed', r.sessions[0].runMi, 5.0);
  ok('...marked as coming from the block', r.fromBlock === true);
  // A derived struct must survive: the climb rehearsal is the same mechanism.
  eq('a climbing Saturday keeps its rehearsal text',
     mk([{ intent:'z2', struct:'90 min · 60 min sustained climbing block', rx:{name:'Z2 Endurance',targets:{}} }])('2026-09-19').dur,
     '90 min · 60 min sustained climbing block');
  eq('falls back to a duration when there is no struct',
     mk([{ intent:'z2', struct:'', rx:{name:'Z2 Endurance',targets:{durationMin:90}} }])('2026-09-17').dur, '90 min');
  // rest is not a workout, the same rule st.plan's reader applies.
  eq('a block rest day is not a workout', mk([{ intent:'rest', struct:'', rx:null }])('2026-09-15'), null);
  eq('no block for the date', mk(null)('2027-01-01'), null);
  eq('no date', mk([{intent:'easyRun',rx:null}])(''), null);
  eq('an unknown intent is skipped rather than guessed', mk([{ intent:'nope', rx:null }])('2026-09-20'), null);
}

console.log('\n' + Y + '=== both renderers fall back, and neither can drift ===' + X);
{
  // Parallel renderers are a documented trap here: fixing one leaves the other showing Rest.
  const uses = (src.match(/blockPlannedForDate_\(/g) || []).length;
  ok('the adapter is called from at least three places (month, week strip, prompts)', uses >= 3);
  const month = src.slice(src.indexOf('// ---- month grid body + week rail ----'),
                          src.indexOf('// ---- month grid body + week rail ----') + 6000);
  ok('DESKTOP month grid falls back', /blockPlannedForDate_\(c\.date\)/.test(month));
  ok('MOBILE week strip falls back', /blockPlannedForDate_\(dKey\)/.test(src));
  // Order matters: the fallback must run BEFORE the rest synthesis, or a stale rest row wins.
  const restSynth = src.indexOf("planRaw={ name:'Rest', type:'rest', intent:'', sessions:[_rs] }");
  const blockFb = src.indexOf('var _bpl=blockPlannedForDate_(c.date);');
  ok('the block fallback runs BEFORE the rest synthesis', blockFb > 0 && blockFb < restSynth);
}

console.log('\n' + Y + '=== the two things that still beat the block ===' + X);
{
  ok('DESKTOP honours an explicit swap', /_decided=_raw\.some\(function\(x\)\{ return x && x\.swap===true; \}\)/.test(src));
  ok('DESKTOP honours a tombstone', /x && x\.deleted && x\.intent && typeof _planSource_==='function' && _planSource_\(x\)==='user'/.test(src));
  ok('...and only shows the block when neither applies', /if\(_bpl && !_tombed\[_bpl\.intent\]\) planRaw=_bpl;/.test(src));
  ok('MOBILE honours an explicit swap', /if\(!_rawM\.some\(function\(x\)\{ return x && x\.swap===true; \}\)\)/.test(src));
  ok('MOBILE honours a tombstone', /if\(_bM && !_tM\[_bM\.intent\]\) pw=_bM;/.test(src));

  // THE ASSERTION THAT WAS MISSING, and its absence cost every Sunday.
  //
  // The first version of this guard treated ANY tombstone as a deletion. generateBlockPlan_
  // tombstones its own replaceable rows on EVERY run - that is its clear-and-regenerate cycle, not a
  // removal - so every day it had ever touched carried generator tombstones for exactly the intents
  // the block still prescribes, and the fallback was suppressed on all of them. Aug 23, Aug 30 and
  // Sep 6 all read "Rest Day". The old test asserted the guard EXISTED and never asked what it
  // counted, which is why it passed while the feature was broken on every date that mattered.
  const both = (src.match(/_planSource_\(x\)==='user'\) _t(ombed|M)\[x\.intent\]=1;/g) || []).length;
  eq('BOTH renderers count only USER tombstones', both, 2);
  ok('NEG: neither counts a bare deleted flag any more',
     !/if\(x&&x\.deleted&&x\.intent\) _tombed\[x\.intent\]=1;/.test(src) &&
     !/if\(x&&x\.deleted&&x\.intent\) _tM\[x\.intent\]=1;/.test(src));
  // And the thing that makes the distinction necessary, asserted so it cannot quietly stop being true.
  ok('the generator does tombstone its own rows every run',
     /_planReplaceable_\(s\)\)\{ s\.deleted=true;/.test(src));
  // Exercise the predicate itself rather than trusting the regex.
  {
    const srcOf = new Function(asServed(exFn('_planSource_') + 'return _planSource_;'))();
    const isUserTomb = (x) => !!(x && x.deleted && x.intent && srcOf(x) === 'user');
    ok('a GENERATOR tombstone does not suppress the block',
       !isUserTomb({ deleted:true, intent:'easyRun', source:'gen' }));
    ok('...nor a migrated one', !isUserTomb({ deleted:true, intent:'easyRun', source:'migrated' }));
    ok('an ATHLETE tombstone still does', isUserTomb({ deleted:true, intent:'easyRun', source:'user' }));
    ok('a live generator row is not a tombstone at all', !isUserTomb({ intent:'easyRun', source:'gen' }));
  }
  // The tombstone check must read the RAW day: planSessionsForDate_ filters deleted rows out, so it
  // cannot see them, and a fallback built on it would silently resurrect every deleted session.
  ok('both read the RAW day, since planSessionsForDate_ hides tombstones',
     (src.match(/st\.plan&&st\.plan\[(c\.date|dKey)\]/g) || []).length === 2);
}

console.log('\n' + Y + '=== what must NOT have changed ===' + X);
{
  // The missed-session detector walks PAST days. Falling back to the block there would report every
  // day the block prescribes but st.plan never stored as a missed session - inventing a backlog.
  const missed = src.slice(src.indexOf("var dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];"), src.indexOf('// Notifications panel opened from the bell'));
  ok('the missed-session detector still reads st.plan only', !/blockPlannedForDate_/.test(missed));
  ok('st.plan is still preferred over the block everywhere', /getPlannedWorkoutForDate\(c\.date\)\|\|null/.test(src));
  ok('nothing writes the block into st.plan', !/st\.plan\[[^\]]*\]\.sessions\.push\(_bpl/.test(src));
}

console.log('');
if (fails) { console.log(R + 'calendar block fallback: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'calendar block fallback: all checks passed' + X + '\n');
