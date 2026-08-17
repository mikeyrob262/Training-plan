// A COACHING SURFACE MAY NOT NAME A SESSION THE PLAN DOES NOT HOLD.
//
// Reported as "Do This Next asserts tomorrow's easy run for a day with nothing scheduled". The audit
// found the opposite of the reported cause, and both halves are worth keeping written down:
//
//   NOT fabrication. The block genuinely prescribes it. _trainingBlock_ P1 (2026-07-24..2026-08-21)
//   defines week[6] = easyRun, Aug 16 2026 is a Sunday inside P1, so blockPlanFor_ returns easyRun
//   and _smurkelFacts_ handed the model "TOMORROW on the plan: easyRun". It reported a real fact.
//   The disagreement is between the block and whatever surface shows a Mon-Sat week.
//
//   BUT two real defects sat next to it, and this file pins those:
//
//   1. THE LINE COULD VANISH. 'TOMORROW on the plan' was gated on C.tomorrow being truthy. When
//      blockPlanFor_ returns null - any date outside the block - the line was DROPPED, so the model
//      was told nothing about tomorrow while the prompt still demanded a next instruction. A missing
//      line reads as not-applicable and gets filled in. Empty-array was already handled; only null
//      went silent, and null is the case that happens the day the block ends.
//
//   2. THE LEGACY WEEK STORE WAS FEEDING PROMPTS. ws(w) reads st.plans[...].weeks['w'+N] - keyed by
//      week-number x day-index, NOT by date. Three prompt builders used it as a fallback for today's
//      workout and two built their entire UPCOMING list from it alone. A week-index store cannot be
//      reconciled against a calendar day and survives block amendments that moved the session, so a
//      name nobody scheduled could reach a coaching prompt as fact.
//
// Run: node scripts/plan-source-test.mjs
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

console.log('\n' + Y + '=== one resolver, and it never reads the week-index store ===' + X);
ok('_promptPlannedFor_ exists', /function _promptPlannedFor_\(dateKey\)/.test(src));
ok('...it reads st.plan first', /getPlannedWorkoutForDate\(dateKey\)/.test(exFn('_promptPlannedFor_')));
// Delegates to blockPlannedForDate_ rather than re-reading blockPlanFor_ itself: two copies of
// "resolve the block for a date" is exactly how the prompts and the Calendar drifted apart.
ok('...then falls back to the block, through the shared resolver', /blockPlannedForDate_\(dateKey\)/.test(exFn('_promptPlannedFor_')));
ok('...and there is only ONE block resolver', /function blockPlannedForDate_\(dateStr\)/.test(src));
ok('...and never touches ws()', !/\bws\(/.test(exFn('_promptPlannedFor_').replace(/\/\/[^\n]*/g, '')));
// The regression itself: no prompt builder may read the week store for a prescription again.
ok('NO builder reads weekData.wo', !/weekData\.wo/.test(src));
ok('NO builder reads weekData.swaps', !/weekData\.swaps/.test(src));
ok('...and the dead ws(cw) reads are gone with them', !/weekData\s*=\s*ws\(cw\)/.test(src));

console.log('\n' + Y + '=== the resolver, exercised ===' + X);
{
  const mk = (planName, blockIntents) => {
    const stub = {
      getPlannedWorkoutForDate: () => (planName ? { name: planName } : null),
      blockPlanFor_: () => (blockIntents ? { sessions: blockIntents.map((i) => ({ intent: i, rx: null })) } : null),
      _tbDK_: (d) => d.toISOString().slice(0, 10)
    };
    const DEFS = { easyRun: { name: 'Easy Run' }, z2: { name: 'Z2 Endurance' }, strengthA: { name: 'Strength A' } };
    const names = Object.keys(stub);
    // Both real functions are pulled in - the resolver AND the block adapter it now delegates to -
    // so this exercises the actual delegation rather than a stub standing in for half of it.
    return new Function('SESSION_DEFS', ...names,
      asServed(exFn('blockPlannedForDate_') + exFn('_promptPlannedFor_') + 'return _promptPlannedFor_;'))
      (DEFS, ...names.map((n) => stub[n]));
  };
  eq('st.plan wins when it has a record', mk('Threshold', ['easyRun'])('2026-08-16'), 'Threshold');
  eq('the block answers when st.plan is empty', mk(null, ['easyRun'])('2026-08-16'), 'Easy Run');
  eq('...resolving intents to real names, not variables', mk(null, ['z2', 'strengthA'])('2026-08-16'), 'Z2 Endurance, Strength A');
  eq('null when NEITHER source has anything', mk(null, [])('2026-08-16'), null);
  eq('...and null when the date is outside the block entirely', mk(null, null)('2027-01-01'), null);
  eq('no date, no answer', mk('Threshold', ['easyRun'])(''), null);
}

console.log('\n' + Y + '=== the TOMORROW line is always stated, never dropped ===' + X);
{
  const facts = exFn('_smurkelFacts_');
  ok('the line is pushed unconditionally', /L\.push\('TOMORROW on the plan: '\+_tmrTxt\+'\.'\);/.test(facts));
  ok('NEG: it is no longer gated on truthiness', !/if\(C\.tomorrow\) L\.push\('TOMORROW/.test(facts));
  ok('null says so explicitly', /outside the current training block/.test(facts));
  ok('empty says nothing is scheduled', /_tmrTxt='nothing scheduled'/.test(facts));
  ok('...and intents resolve to real names', /SESSION_DEFS\[x\]/.test(facts));
  // Three branches, three distinct strings - a shared string would collapse two real states into one.
  const branches = (facts.match(/_tmrTxt=/g) || []).length;
  eq('exactly three distinct states', branches, 3);
}

console.log('\n' + Y + '=== the debrief may not invent tomorrow ===' + X);
{
  const i = src.indexOf('function fetchSmurkelDebrief_(');
  const debrief = src.slice(i, src.indexOf('var key=_ciHash_(prompt);', i));
  const flat = debrief.replace(/'\s*\n?\s*\+\s*\n?\s*'/g, '').replace(/\s+/g, ' ');
  ok('tomorrow is bound to the stated line', /TOMORROW is EXACTLY what the TOMORROW line above says/.test(flat));
  ok('...never a type the facts did not name', /Never name a session type for tomorrow that line did not name/.test(flat));
  ok('...a suggestion is framed as a suggestion', /frame anything you propose AS A SUGGESTION/.test(flat));
  ok('...and the stakes are stated, since this is the headline action', /an invented session there is the most damaging thing/.test(flat));
}

console.log('\n' + Y + '=== the Sunday finding, pinned so it is not re-derived ===' + X);
// The block table is the reason the "fabricated" easy run was real. If week[6] is ever emptied, that
// must be a deliberate decision - and it has to be a DATED amendment, because these tables are read
// for past dates and editing one re-grades every Sunday already ridden.
{
  const p1 = src.slice(src.indexOf("id:'P1', label:'Base build'"), src.indexOf("id:'P2'"));
  const rows = p1.slice(p1.indexOf('week:[')).match(/\[S\([^\]]*\]/g) || [];
  eq('P1 defines all seven days', rows.length, 7);
  ok('...and Sunday (index 6) is the easy run', /S\('easyRun'/.test(rows[6] || ''));
  ok('the dated-amendment mechanism still exists for changing it', /SCHED_THU_FRI_SWAP_FROM/.test(src));
}

console.log('');
if (fails) { console.log(R + 'plan source: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'plan source: all checks passed' + X + '\n');
