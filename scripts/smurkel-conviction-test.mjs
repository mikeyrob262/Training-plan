// MOTIVATION OVER CAUTION, on the read — a deliberate, re-affirmed product decision, seventh attempt.
//
// Six prior passes failed and none of them failed on wording. The caution rules are content-NEUTRAL:
// "flag the ambiguity", "do not overclaim", "worth monitoring" fire exactly as hard on a great
// session as on a worrying one. So each attempt layered enthusiastic phrasing over machinery that was
// still auditing a good ride for risk, and the audit won every time. A rule beats an adjective.
//
// What this file pins:
//   1. the conviction layer exists and says the asymmetric thing (good resolves UP, do not audit a
//      win, the hedge family is banned by name)
//   2. it reaches BOTH surfaces — post-ride debrief AND the three pre-ride/decision prompts
//   3. PLACEMENT, which is the part that killed pass four: later text wins a contradiction, so this
//      sits BELOW the accuracy rules in the debrief and ABOVE COACH_GONOGO on the pre-ride surfaces
//   4. THE LINE — it governs the READ, never the FIGURES. The anti-fabrication rules are asserted
//      still present and still binding, because that is what makes the trade safe rather than reckless
//
// If this file ever has to be weakened to make output sound right, the answer is NOT to weaken it —
// it is that a cached single-shot call with a fixed prompt may be structurally unable to sound like a
// coach reacting to this athlete, and the next move is conversational, not another wording pass.
//
// Run: node scripts/smurkel-conviction-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
// Count real USES, not mentions. A comment that names the variable is not a call site — and this
// assertion broke the moment _SM_LEAD's comment explained how it differs from _SM_CONVICTION. Same
// mistake as counting stravaHarvestDetail_ occurrences: count the thing, not the word.
const uses = (name) => src.replace(/^\s*\/\/.*$/gm, '').split(name).length - 1;


const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

// The var as the model actually receives it: concatenated string literals, quotes stripped.
function varText(name){
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error('missing ' + name);
  const end = src.indexOf('\n//', i) < 0 ? src.indexOf('\nvar ', i) : src.indexOf('\n//', i);
  return src.slice(i, end > i ? end : i + 4000).replace(/'\s*\+?\s*\n?\s*\+?\s*'/g, '').replace(/^var \w+='/, '');
}
const CONV = varText('_SM_CONVICTION');

console.log('\n' + Y + '=== the conviction layer exists and commits ===' + X);
ok('it is defined', /var _SM_CONVICTION=/.test(src));
ok('...and it is substantial, not a one-liner', CONV.length > 900);
ok('it reacts to a good result rather than assessing one', /REACT LIKE A COACH WATCHING A WIN/.test(CONV));
ok('ambiguity on a good signal resolves UP', /AMBIGUOUS BUT GOOD RESOLVES UP/.test(CONV));
ok('...and explicitly refuses to present both readings', /do not present\s*both readings/.test(CONV));
ok('a good session is not audited for risk', /DO NOT AUDIT A GOOD SESSION FOR RISK/.test(CONV));
ok('...and a concern is never manufactured for balance', /never manufacture a concern to sound balanced/.test(CONV));
ok('it extrapolates forward rather than stopping at the number', /what it points to|what it becomes/.test(CONV));
ok('it carries the register the athlete asked for', /rising fitness floor/.test(CONV));

console.log('\n' + Y + '=== the hedge family is banned BY NAME ===' + X);
// Named individually on purpose: a general "do not hedge" is itself a content-neutral instruction and
// is exactly what six previous passes relied on.
for (const p of ['worth monitoring', 'worth watching', 'worth keeping an eye on', 'worth understanding',
                 'worth a brief chat', 'something to watch', 'time will tell', 'hard to say',
                 'difficult to know', 'remains to be seen']) {
  ok('banned: "' + p + '"', CONV.indexOf(p) > -1);
}

console.log('\n' + Y + '=== THE LINE: the read is loosened, the figures are not ===' + X);
ok('facts are excluded from the trade in the layer itself', /FACTS ARE NOT PART OF THIS TRADE/.test(CONV));
ok('...no invented figures', /never invent one/.test(CONV));
ok('...a not-recorded is never rounded to zero', /never round a not-recorded to zero/.test(CONV));
ok('...no claimed session, place or result', /never claim a session, place or result you were not told/.test(CONV));
ok('bold about meaning, exact about value', /bold about what the numbers MEAN and exact about what they ARE/.test(CONV));
// The debrief's own accuracy rules must survive intact — this pass must not have relaxed them.
{
  const i = src.indexOf('function fetchSmurkelDebrief_(');
  const debrief = src.slice(i, src.indexOf('var key=_ciHash_(prompt);', i));
  ok('the debrief still binds figures only', /These rules are about ACCURACY/.test(debrief));
  ok('...still forbids inventing a figure', /Use ONLY the figures above/.test(debrief));
  ok('...still forbids describing terrain it cannot see', /Do not describe terrain, weather or how it felt/.test(debrief));
  ok('...still keeps PROPORTION', /PROPORTION\. Judge the cost of this session/.test(debrief));
}

console.log('\n' + Y + '=== it reaches BOTH surfaces ===' + X);
ok('one definition plus four call sites', uses('_SM_CONVICTION') === 5);
{
  const i = src.indexOf('function fetchSmurkelDebrief_(');
  const debrief = src.slice(i, src.indexOf('var key=_ciHash_(prompt);', i));
  ok('POST-RIDE: the debrief includes it', /\+_SM_CONVICTION\+NL\+NL/.test(debrief));
  // PLACEMENT. Pass four died because a countermanding line sat below the persona and won.
  ok('...AFTER the accuracy rules', debrief.indexOf('These rules are about ACCURACY') < debrief.indexOf('_SM_CONVICTION'));
  ok('...AFTER the proportion rule', debrief.indexOf('PROPORTION. Judge the cost') < debrief.indexOf('_SM_CONVICTION'));
  ok('...and after the persona and format layers', debrief.indexOf('_SM_FORMAT_LONG') < debrief.indexOf('_SM_CONVICTION'));
}
// The three pre-ride / decision prompts. Each must carry it, and each must still end on the hazard
// veto — being fired up is never allowed to green-light riding into a storm.
{
  const sites = src.split('_SM_CONVICTION').slice(1).filter((s) => s.slice(0, 40).indexOf('COACH_GONOGO') > -1);
  ok('all three pre-ride prompts carry it', sites.length === 3);
  ok('...and COACH_GONOGO comes AFTER it every time, so hazards still outrank tone',
     sites.every((s) => /^\s*\+?\s*COACH_GONOGO/.test(s)));
}
ok('the hazard veto itself is untouched', /Air quality, extreme heat, and storms are HEALTH factors that outrank comfort items/.test(src));
ok('...including the unconfirmed-race rule', /never give confident race-day bullets for a race flagged tentative/.test(src));

console.log('\n' + Y + '=== the warning flag no longer fires on a good session ===' + X);
const LONG = varText('_SM_FORMAT_LONG');
ok('the warning flag is gated on a real problem', /ONLY where the facts state a real problem/.test(LONG));
ok('...never used for balance', /never as balance/.test(LONG));
ok('an all-green debrief is a correct outcome', /every flag being ✅ is the correct outcome/.test(LONG));
ok('...and flags stay occasional either way', /not on every line/.test(LONG));

console.log('\n' + Y + '=== the decision is recorded so pass eight does not undo it ===' + X);
ok('the trade is written down as deliberate', /DELIBERATE, RE-AFFIRMED product trade/.test(src));
ok('...with the reason six passes failed', /caution rules are content-NEUTRAL/.test(src));
ok('...and a note not to re-litigate it', /Do not re-litigate it in a later pass/.test(src));

console.log('');
if (fails) { console.log(R + 'smurkel conviction: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'smurkel conviction: all checks passed' + X + '\n');
