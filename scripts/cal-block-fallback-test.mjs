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

console.log('\n' + Y + '=== both renderers fall back, and neither CAN drift ===' + X);
{
  // THE GUARANTEE CHANGED SHAPE. This used to require the fallback to be open-coded in BOTH parallel
  // renderers and then check the two copies matched — which is a test for "the duplication is
  // currently in sync", not for "they cannot disagree". They did disagree: the mobile copy built its
  // key unpadded, so its st.plan read always missed and NEITHER of its guards ever fired, while
  // desktop honoured both. Now there is one implementation behind getPlannedWorkoutForDate and the
  // renderers simply read it, so drift is impossible by construction rather than by vigilance.
  const calls = src.split('\n').filter((l) => /blockPlannedForDate_\(/.test(l) && !/function blockPlannedForDate_/.test(l));
  eq('exactly ONE place asks the block on a surface\'s behalf', calls.length, 1);
  ok('...and it is the shared helper', /var b=blockPlannedForDate_\(dk\)/.test(calls[0] || ''));
  ok('getPlannedWorkoutForDate is what falls back', /return _plannedFromBlock_\(dateStr\)/.test(exFn('getPlannedWorkoutForDate')));
  // Both renderers must therefore READ the shared resolver. These are the reads that used to be
  // followed by a hand-rolled fallback; the fallback is inside them now.
  const month = src.slice(src.indexOf('// ---- month grid body + week rail ----'),
                          src.indexOf('// ---- month grid body + week rail ----') + 6000);
  ok('DESKTOP month grid reads the shared resolver', /getPlannedWorkoutForDate\(c\.date\)/.test(month));
  ok('MOBILE week strip reads the shared resolver', /getPlannedWorkoutForDate\(dKey\)/.test(src));
  ok('NEG: DESKTOP no longer open-codes it', !/var _bpl=blockPlannedForDate_\(c\.date\)/.test(src));
  ok('NEG: MOBILE no longer open-codes it', !/var _bM=blockPlannedForDate_\(dKey\)/.test(src));
  // Order still matters: the block answer must be in hand BEFORE the rest synthesis, or a stale rest
  // row wins the day. It now arrives with planRaw itself.
  const restSynth = src.indexOf("planRaw={ name:'Rest', type:'rest', intent:'', sessions:[_rs] }");
  const planRead = src.indexOf('getPlannedWorkoutForDate(c.date)');
  ok('the block answer is in hand BEFORE the rest synthesis', planRead > 0 && planRead < restSynth);
}

console.log('\n' + Y + '=== the two things that still beat the block ===' + X);
{
  const helper = exFn('_plannedFromBlock_');
  ok('the shared helper honours an explicit swap', /raw\.some\(function\(x\)\{ return x && x\.swap===true; \}\)/.test(helper));
  ok('...and a tombstone', /x && x\.deleted && x\.intent && typeof _planSource_==='function' && _planSource_\(x\)==='user'/.test(helper));
  ok('...and only shows the block when neither applies', /return \(b && !tomb\[b\.intent\]\) \? b : null;/.test(helper));
  // The guards now apply to EVERY surface, including the prompt path, which never had them.
  ok('the prompt path no longer bypasses them', !/blockPlannedForDate_/.test(exFn('_promptPlannedFor_').replace(/\/\/[^\n]*/g, '')));

  // THE ASSERTION THAT WAS MISSING, and its absence cost every Sunday.
  //
  // The first version of this guard treated ANY tombstone as a deletion. generateBlockPlan_
  // tombstones its own replaceable rows on EVERY run - that is its clear-and-regenerate cycle, not a
  // removal - so every day it had ever touched carried generator tombstones for exactly the intents
  // the block still prescribes, and the fallback was suppressed on all of them. Aug 23, Aug 30 and
  // Sep 6 all read "Rest Day". The old test asserted the guard EXISTED and never asked what it
  // counted, which is why it passed while the feature was broken on every date that mattered.
  const both = (src.match(/_planSource_\(x\)==='user'\) tomb\[x\.intent\]=1;/g) || []).length;
  eq('only USER tombstones count, in the one place that counts them', both, 1);
  ok('NEG: no bare deleted flag anywhere',
     !/if\(x&&x\.deleted&&x\.intent\) _tombed\[x\.intent\]=1;/.test(src) &&
     !/if\(x&&x\.deleted&&x\.intent\) _tM\[x\.intent\]=1;/.test(src) &&
     !/if\(x&&x\.deleted&&x\.intent\) tomb\[x\.intent\]=1;/.test(src));
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
  // The tombstone check must read the RAW day: planSessionsForDate_ filters deleted rows out, so it
  // cannot see them, and a fallback built on it would silently resurrect every deleted session.
  ok('it reads the RAW day, since planSessionsForDate_ hides tombstones', /var dd=st\.plan&&st\.plan\[dk\]/.test(helper));
  // AND IT NORMALISES THE KEY FIRST. This is what was actually broken on mobile: dKey was built
  // unpadded (y+'-'+(m+1)+'-'+d), so st.plan['2026-8-16'] was undefined, raw came back empty and both
  // guards silently no-opped. A guard that cannot see its input is not a guard.
  ok('...after normalising it, so the raw read cannot miss', /var dk=\(typeof normDate==='function'\)\?normDate\(dateStr\)/.test(helper));
}

console.log('\n' + Y + '=== what must NOT have changed ===' + X);
{
  // The missed-session detector walks PAST days. Falling back to the block there would report every
  // day the block prescribes but st.plan never stored as a missed session - inventing a backlog.
  const missed = src.slice(src.indexOf("var dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];"), src.indexOf('// Notifications panel opened from the bell'));
  ok('the missed-session detector still reads st.plan only', !/blockPlannedForDate_/.test(missed));
  // AND THAT GREP IS NO LONGER SUFFICIENT, which is the point of this pair. Once the fallback moved
  // inside getPlannedWorkoutForDate, the detector inherited it WITHOUT naming it — the check above
  // stayed green while the guarantee it protects was broken. The opt-out has to be explicit, so
  // assert the opt-out itself, not the absence of a symbol.
  ok('...and now says so explicitly, since the shared resolver would otherwise supply the block',
     /if\(plan && plan\.fromBlock\) plan=null;/.test(missed));
  ok('...which is only expressible because a block answer is flagged', /fromBlock:true/.test(src));
  ok('st.plan is still preferred over the block everywhere', /getPlannedWorkoutForDate\(c\.date\)\|\|null/.test(src));
  ok('nothing writes the block into st.plan', !/st\.plan\[[^\]]*\]\.sessions\.push\(_bpl/.test(src));
}

console.log('');
if (fails) { console.log(R + 'calendar block fallback: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'calendar block fallback: all checks passed' + X + '\n');
