// WHAT WENT RIGHT COMES FIRST — INCLUDING, ESPECIALLY, WHEN THE NEWS IS BAD.
//
// Reported ten times. Nine passes edited _SM_PERSONA and none held, and the reason is not that tone
// is hard: the surface producing the complaint - fetchRideCoachInsight, the ride-detail verdict card
// - carried NEITHER the persona NOR the conviction layer. Its format line asked for
//
//   "one short punchy headline (max 8 words) reflecting whether the ride matched its prescription"
//
// which DEMANDS a verdict in the opening line. No persona edit could out-rank a format instruction
// on a prompt that never included the persona in the first place.
//
// _SM_LEAD is an ORDERING rule and is separate from _SM_CONVICTION on purpose. Conviction governs a
// GOOD result - commit to it, do not audit it. This governs a BAD one, which is the case that kept
// failing. It is not a licence to soften: the shortfall is still stated, still with its number,
// still unhedged, and the rule says so explicitly.
//
// Verified against a GENUINE shortfall (intervals 159-171W against a correctly-stamped 194-202W
// band), not against a session whose "miss" turned out to be a data bug:
//   before: "Power fell short of Z5 band all four intervals"   (3 of 3 runs)
//   after:  "Structure held, but power missed the band"        (3 of 3 runs)
// with the miss still stated as "a shortfall of 23-35W below the Z5 floor on every interval".
//
// Run: node scripts/smurkel-lead-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
function varText(n){ const i=src.indexOf('var '+n+'='); const nl=src.indexOf('\n//',i), nv=src.indexOf('\nvar ',i);
  const e=(nl>i&&(nl<nv||nv<0))?nl:nv; return src.slice(i,e).replace(/'\s*\n?\s*\+\s*\n?\s*'/g,'').replace(/\s+/g,' '); }
const LEAD = varText('_SM_LEAD');

console.log('\n' + Y + '=== the ordering rule exists and is about ORDER ===' + X);
ok('_SM_LEAD is declared', /var _SM_LEAD=/.test(src));
ok('what went right comes first, with its figure', /Name what went RIGHT first, with the figure that proves it/.test(LEAD));
ok('...and it binds hardest when the news is bad', /This holds hardest when the news is bad/.test(LEAD));
ok('...naming what still counts on a missed session', /stopping when stopping was the right call/.test(LEAD));
ok('the shortfall is still STATED', /THEN STATE THE SHORTFALL PLAINLY/.test(LEAD));
ok('...not buried, softened, or skipped', /Do not bury it, do not soften the number, do not skip it/.test(LEAD));
ok('...and not the closing note either', /do not end on it either - close on what to do next/.test(LEAD));
ok('it says outright that this is order, never omission', /about ORDER, never omission/.test(LEAD));

console.log('\n' + Y + '=== it reaches the surface that actually judges a ride ===' + X);
function span(fn, n){ const i=src.indexOf('function '+fn+'('); return src.slice(i, i+(n||14000)); }
ok('the ride-detail verdict card carries it', /_SM_LEAD/.test(span('fetchRideCoachInsight')));
ok('the Plan-page debrief carries it', /_SM_LEAD/.test(span('fetchSmurkelDebrief_')));
ok('the ride Analysis tab carries it', /_SM_LEAD/.test(span('renderRideAnalysisTab')));
// This is the whole reason nine passes missed: the card had no persona to edit.
ok('...and that card still has no persona, which is why persona edits never reached it',
   !/_SM_PERSONA/.test(span('fetchRideCoachInsight', 9000)));

console.log('\n' + Y + '=== the format no longer demands a verdict first ===' + X);
const flat = src.replace(/'\s*\n?\s*\+\s*\n?\s*'/g, '').replace(/\s+/g, ' ');
ok('NEG: the headline no longer asks whether the ride matched its prescription',
   !/headline \(max 8 words\) reflecting whether the ride matched its prescription/.test(flat));
ok('the headline names what the ride WAS and what held up', /naming what this ride WAS and what held up in it/.test(flat));
ok('...and forbids a failure verdict there', /NEVER a verdict of failure, and never leading with a shortfall/.test(flat));
ok('bullet one is what went right, with its figure', /the FIRST names what went right with the figure that proves it/.test(flat));
ok('bullet two is the shortfall, unsoftened', /the SECOND states the shortfall against the prescription with its figure, plainly and unsoftened/.test(flat));

console.log('\n' + Y + '=== ordering and conviction stay separate concerns ===' + X);
ok('conviction still exists', /var _SM_CONVICTION=/.test(src));
ok('...and still governs the GOOD case', /DO NOT AUDIT A GOOD SESSION FOR RISK/.test(src));
ok('...while lead governs the bad one', /This holds hardest when the news is bad/.test(src));
ok('the facts floor is untouched by both', /FACTS ARE NOT PART OF THIS TRADE/.test(src));
{
  const d = span('fetchSmurkelDebrief_');
  ok('on the debrief, ordering is stated BEFORE conviction', d.indexOf('_SM_LEAD') < d.indexOf('_SM_CONVICTION'));
}

console.log('');
if (fails) { console.log(R + 'smurkel lead: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'smurkel lead: all checks passed' + X + '\n');
