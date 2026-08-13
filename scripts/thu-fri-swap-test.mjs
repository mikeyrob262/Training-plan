// Thursday and Friday exchange their RIDE from 2026-08-13.
//
// Thursday was Z2 and Friday was Threshold in all four phases, which stacked a hard Thursday, a hard
// Friday and the Saturday group ride. The point of the change is that Friday becomes a genuine easy
// day immediately before the group ride.
//
// Two properties carry the whole thing:
//   only the RIDE moves - Friday's strength slot stays on Friday;
//   and it is DATED - the phase tables are read for past dates too, so rewriting them would change
//   what the coach believes was prescribed on every Thursday and Friday already ridden.
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
const exVar = (n) => { const m = src.match(new RegExp('^var ' + n + '[^\\n]*$', 'm')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const NL = String.fromCharCode(10);

const SESSION_DEFS = {
  z2: { type: 'ride' }, threshold: { type: 'ride' }, vo2: { type: 'ride' },
  group: { type: 'ride' }, long: { type: 'ride' }, chalet: { type: 'attempt' },
  strengthA: { type: 'strength' }, strengthB: { type: 'strength' },
  mobility: { type: 'mobility' }, easyRun: { type: 'run' }, run10k: { type: 'run' }
};
const M = new Function('SESSION_DEFS', asServed(
  exVar('SCHED_THU_FRI_SWAP_FROM') + exFn('_blockSwapThuFri_') + NL +
  'return { _blockSwapThuFri_, SCHED_THU_FRI_SWAP_FROM };'
))(SESSION_DEFS);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

// The real shape: Thu is one Z2, Fri is Threshold plus a strength slot.
const phase = { week: [
  [{ i: 'mobility' }, { i: 'easyRun' }],
  [{ i: 'strengthB', t: 'AM' }, { i: 'vo2', t: 'PM' }],
  [{ i: 'easyRun' }],
  [{ i: 'z2', s: '60-90 min' }],
  [{ i: 'threshold', s: '2x20 min' }, { i: 'strengthA' }],
  [{ i: 'group' }],
  [{ i: 'easyRun' }]
] };
const ids = (a) => (a || []).map((x) => x.i);
const THU = 3, FRI = 4;

console.log('\n' + Y + '=== from the effective date, the ride moves ===' + X);
{
  const thu = M._blockSwapThuFri_(phase, THU, '2026-08-13', phase.week[THU]);
  const fri = M._blockSwapThuFri_(phase, FRI, '2026-08-14', phase.week[FRI]);
  eq('Thursday takes the Threshold', ids(thu), ['threshold']);
  eq('Friday becomes Z2, and KEEPS its strength slot', ids(fri), ['z2', 'strengthA']);
  ok('...with the ride first, as the tables read', ids(fri)[0] === 'z2');
  eq('the struct travels with the session', thu[0].s, '2x20 min');
  eq('...both ways', fri[0].s, '60-90 min');
}

console.log('\n' + Y + '=== before the effective date, nothing changes ===' + X);
{
  eq('the Thursday before is still Z2', ids(M._blockSwapThuFri_(phase, THU, '2026-08-06', phase.week[THU])), ['z2']);
  eq('the Friday before is still Threshold + strength',
     ids(M._blockSwapThuFri_(phase, FRI, '2026-08-07', phase.week[FRI])), ['threshold', 'strengthA']);
  eq('the day before the switch is untouched',
     ids(M._blockSwapThuFri_(phase, THU, '2026-08-12', phase.week[THU])), ['z2']);
  ok('the effective date is a stated constant', /^\d{4}-\d{2}-\d{2}$/.test(M.SCHED_THU_FRI_SWAP_FROM));
}

console.log('\n' + Y + '=== no other day is touched ===' + X);
{
  [0, 1, 2, 5, 6].forEach((wd) => {
    eq('weekday ' + wd + ' unchanged',
       ids(M._blockSwapThuFri_(phase, wd, '2026-09-30', phase.week[wd])), ids(phase.week[wd]));
  });
  // Saturday is explicitly out of scope for this change.
  eq('Saturday keeps the group ride', ids(M._blockSwapThuFri_(phase, 5, '2026-10-10', phase.week[5])), ['group']);
}

console.log('\n' + Y + '=== the strength rotation is not disturbed ===' + X);
{
  const fri = M._blockSwapThuFri_(phase, FRI, '2026-09-04', phase.week[FRI]);
  ok('Friday still carries exactly one strength slot', fri.filter((x) => SESSION_DEFS[x.i].type === 'strength').length === 1);
  const thu = M._blockSwapThuFri_(phase, THU, '2026-09-03', phase.week[THU]);
  ok('Thursday gains no strength slot', thu.every((x) => SESSION_DEFS[x.i].type !== 'strength'));
  // The rotation decides WHICH group; this must not name one.
  const fn = exFn('_blockSwapThuFri_');
  ok('the swap never names a strength group', !/strengthA|strengthB|strengthC|strengthD/.test(fn));
  ok('...it selects on TYPE', /d2\.type==='ride'/.test(fn));
}

console.log('\n' + Y + '=== a one-off date entry outranks the standing change ===' + X);
{
  // p.dates[] entries are the taper days - an explicit one-off decision, not a weekly template.
  const bp = src.slice(src.indexOf('function blockPlanFor_('));
  ok('the amendment only applies to WEEK-table slots', /else if\(p\.week\)\{ slots=_blockSwapThuFri_/.test(bp));
  ok('...and a p.dates entry is taken before it', bp.indexOf("p.dates[dateKey]") < bp.indexOf('_blockSwapThuFri_'));
}

console.log('\n' + Y + '=== degenerate input is survivable ===' + X);
{
  eq('no phase -> slots unchanged', M._blockSwapThuFri_(null, THU, '2026-09-03', [{ i: 'z2' }]), [{ i: 'z2' }]);
  eq('no week table -> unchanged', M._blockSwapThuFri_({}, THU, '2026-09-03', [{ i: 'z2' }]), [{ i: 'z2' }]);
  const noRide = { week: Object.assign([], phase.week, { 4: [{ i: 'strengthA' }] }) };
  eq('nothing to exchange -> unchanged', ids(M._blockSwapThuFri_(noRide, THU, '2026-09-03', noRide.week[THU])), ['z2']);
  ok('an unknown intent does not throw',
     Array.isArray(M._blockSwapThuFri_(phase, THU, '2026-09-03', [{ i: 'nosuchthing' }])));
}


console.log('\n' + Y + '=== the stored plan is re-synced to the derive ===' + X);
{
  // Two readers, one fact. blockPlanFor_ is the block's answer; the Calendar and every
  // planSessionsForDate_ caller read STORED st.plan rows. Measured after the swap shipped:
  // Aug 13 stored z2 while the block derived threshold, and every Friday stored strengthA while
  // the rotation derived D or B. The swap was live and invisible.
  const fn = exFn('migrateBlockSessions_');
  ok('a re-sync exists', fn.length > 0);
  ok('it reads the block derive', fn.indexOf('blockPlanFor_(dk)') > 0);
  ok('...and matches sessions by TYPE', fn.indexOf('typeOf(want[i].intent)===mine') > 0);
  ok('an explicit swap is never overwritten', fn.indexOf('x.swap===true') > 0);
  ok('a completed session is never rewritten', fn.indexOf("x.status==='completed'") > 0);
  ok('it corrects intent, type and name together', /x\.intent=target\.intent/.test(fn) && /x\.type=def\.type/.test(fn));
  ok('...and clears the mask it corrects', /delete x\._edited\.intent/.test(fn));
  ok('it stays inside the block window', fn.indexOf('dk<tb.start || dk>tb.end') > 0);
  ok('it adds and removes nothing', !/sessions\.push|sessions\.splice/.test(fn));
  // The rationale sits in the header comment above the function, which exFn does not capture.
  ok('...and says why', /does not add or remove rows/.test(src));
  ok('it runs at the sync chokepoint, not only at boot',
     (src.match(/migrateBlockSessions_\(\); \}catch/g) || []).length >= 2);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'Thu/Fri swap: all checks passed' + X));
process.exit(fails ? 1 : 0);
