// Dr. Smurkel's voice. Two things are pinned here and they are different in kind.
//
// CHARACTER: the old persona told him the athlete "is Type A" and to "name the tendency", and he
// duly produced "you are a person who reads a ceiling as a target and a target as a floor, and this
// has your fingerprints on it" - a character verdict delivered about good news. That instruction is
// gone, and the register is named as banned so a future edit cannot quietly reintroduce it.
//
// SHAPE: voice goes everywhere, formatting does not. The old single blob carried "walk the ride in
// short named sections with plain headers" into five call sites, four of which then say "no section
// headings". The prompt argued with itself at every short surface.
//
// Both are asserted on the SERVED text, not on worker.js. The app is one template literal, so an
// escape can survive review, parse cleanly, and still reach the model as something else.
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.persona-build');
execSync(`npx wrangler deploy --dry-run --outdir "${OUT}"`, { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
const mod = await import(pathToFileURL(path.join(OUT, 'worker.js')).href);
const res = await mod.default.fetch(new Request('http://localhost/'), {}, { waitUntil() {}, passThroughOnException() {} });
const html = await res.text();
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

// Pull each prompt constant out of the SERVED html by evaluating its own declaration.
function served(name) {
  const i = html.indexOf('var ' + name + '=');
  if (i < 0) throw new Error('missing ' + name + ' in served html');
  const j = html.indexOf("';", i);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + html.slice(i + ('var ' + name + '=').length, j + 1))();
}
const VOICE = served('_SM_PERSONA');
const LONG = served('_SM_FORMAT_LONG');
const CHAT = served('_SM_FORMAT_CHAT');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

console.log('\n' + Y + '=== the clinical register is gone, and named so it cannot come back ===' + X);
{
  ok('the "Type A" character brief is deleted', !/Type A/i.test(VOICE));
  ok('...along with the instruction to name their tendency', !/name it and\s*tell them to ignore it/i.test(VOICE));
  ok('psychoanalysis is banned outright', /NEVER PSYCHOANALYSE THEM/.test(VOICE));
  ok('the exact flagged sentence is quoted as the anti-example',
     VOICE.includes('you are a person who reads a ceiling as a target'));
  ok('...and its whole family with it',
     /that is who you are/.test(VOICE) && /you are the kind of athlete who/.test(VOICE) && /classic you/.test(VOICE));
  ok('the quotes around the anti-example survived the template literal', /banned: "you are a person/.test(VOICE));
}

console.log('\n' + Y + '=== the five character notes from the brief are all present ===' + X);
{
  ok('leads with warmth on real findings', /WARMTH IS WHO YOU ARE/.test(VOICE));
  ok('...as identity, not a concession bolted to the end', /NOT A CONCESSION YOU MAKE/.test(VOICE));
  ok('...with the reference phrasing to anchor it', /well-executed hilly run with smart pace/.test(VOICE));
  ok('self-corrects out loud', /CHANGE YOUR MIND OUT LOUD/.test(VOICE) && /let me revise/.test(VOICE));
  ok('...and revises rather than appending', /not bolt an addendum onto a verdict/.test(VOICE));
  ok('follows the athlete answer into a new read', /ASK REAL QUESTIONS, THEN USE THE ANSWER/.test(VOICE));
  ok('...folding it in, not recapping', /genuinely NEW read rather than a recap/.test(VOICE));
  ok('closes with real momentum', /CLOSE WITH MOMENTUM/.test(VOICE) && /14 days to the FTP retest/.test(VOICE));
  ok('...explicitly not a generic sign-off', /never a generic sign-off/.test(VOICE));
  ok('reaction is scaled to the size of the thing', /SCALE YOUR REACTION TO THE SIZE/.test(VOICE));
  ok('...and asks for real clarifying questions by example', /which leg\?/i.test(VOICE));
}

// The fourth pass failed with every one of those notes already present. What was missing was a
// character to imitate rather than a list of rules to satisfy, and a section for warmth to live in.
console.log('\n' + Y + '=== he is a person, not a compliance target ===' + X);
{
  ok('opens on who he is and how he feels about the athlete', /glad to see them/.test(VOICE));
  ok('...with a concrete setting, not an abstraction', /car park/.test(VOICE));
  ok('...and is allowed to be funny', /allowed to be funny/.test(VOICE));
  ok('credits the good decision the athlete already made',
     /NAME THE GOOD DECISION THEY ALREADY MADE/.test(VOICE));
  ok('...called out as the line a report always misses', /a report always leaves out/.test(VOICE));
  // The old ban list included the softeners of ordinary speech. Banning "seems" and "appears to" is
  // itself a push toward clinical prose - the target was analytical non-commitment, never softness.
  ok('the hedge ban no longer bans human speech',
     !/"seems"/.test(VOICE) && !/"appears to"/.test(VOICE) && !/"somewhat"/.test(VOICE));
  ok('...and it still bans hiding', /BANNED, because every one is a way of not committing/.test(VOICE));
  ok('...explicitly permitting a coach to sound like one', /not a ban on sounding human/.test(VOICE));
}

console.log('\n' + Y + '=== voice carries NO formatting - that was the self-contradiction ===' + X);
{
  ok('no section-header instruction in the voice core', !/named sections|plain headers/i.test(VOICE));
  ok('no table instruction in the voice core', !/table/i.test(VOICE));
  ok('no emoji instruction in the voice core', !/emoji/i.test(VOICE));
  ok('the anti-hedging ban stayed - it is voice, not format', /BANNED, because every one is a way of not committing/.test(VOICE));
  ok('the anti-fabrication rule stayed', /Only ever use the numbers you are given/.test(VOICE));
  ok('...including the no-inventing-places clause', /do not name a place, a segment or a result you were not told/.test(VOICE));
}

console.log('\n' + Y + '=== format layers say what the brief asked, where there is room for it ===' + X);
{
  ok('long form asks for room to breathe', /let it breathe/.test(LONG) && /short sections/.test(LONG));
  // The layer must not name sections of its own. The debrief call site already names six, in order,
  // with what each must contain - a second list one layer up is the same self-contradiction the
  // voice/format split exists to remove.
  ok('...and defers the section list to the call site', /do not invent your own/.test(LONG));
  ok('...proposing no headings of its own', !/The Bigger Picture|What Stood Out/.test(LONG));
  ok('...tables for direct comparisons', /markdown table whenever you are comparing things/.test(LONG));
  ok('...and says WHY, so it is a rule not a decoration', /reads in one glance/.test(LONG));
  ok('the check and warning flags survived as real characters',
     LONG.includes('✅') && LONG.includes('⚠'));
  ok('...as did the occasional target/smile', LONG.includes('\u{1F3AF}') || LONG.includes('\u{1F604}'));
  ok('flags are occasional, not per line', /not on every line/.test(LONG));
  ok('chat form forbids headings', /no headings and no section names/.test(CHAT));
  ok('...but still allows a table for a comparison question', /compact\s+markdown table/.test(CHAT));
}

console.log('\n' + Y + '=== every surface gets voice; only the right ones get shape ===' + X);
{
  const sites = [...src.matchAll(/var prompt\s*=\s*_SM_PERSONA([^\n]*)/g)].map((m) => m[1]);
  ok('all five Smurkel call sites still carry the voice', sites.length === 5);
  ok('exactly one surface gets the long format', sites.filter((t) => /_SM_FORMAT_LONG/.test(t)).length === 1);
  ok('two conversational surfaces get the chat format', sites.filter((t) => /_SM_FORMAT_CHAT/.test(t)).length === 2);
  ok('the year insight takes voice only (it is 2-3 sentences)',
     sites.filter((t) => !/_SM_FORMAT_/.test(t)).length === 2);
  // The contradiction that prompted the split: a site that bans headings must not be handed a
  // prompt demanding them.
  const reply = src.slice(src.indexOf('function fetchSmurkelReply_('), src.indexOf('function fetchSmurkelReply_(') + 3000);
  ok('Ask Coach no longer bans all markdown while being asked for tables',
     /No section headings and no asterisk-bolding/.test(reply) && !/Plain text, no markdown asterisks/.test(reply));
}

// THE BUG THAT SURVIVED THREE REWRITES OF THE VOICE. The voice/format split fixed the prompt arguing
// with itself about SHAPE. Nobody checked the same seam for TONE: the debrief call site opened its
// rule list with "Rules that override any instinct to be encouraging", sitting below the persona in
// the same prompt and therefore winning. A warm persona cannot survive a call site that instructs
// the model to override warmth - so the call site is asserted here, not just the persona.
console.log('\n' + Y + '=== no call site countermands the voice ===' + X);
{
  const i = src.indexOf('function fetchSmurkelDebrief_(');
  const debrief = src.slice(i, src.indexOf('var key=_ciHash_(prompt);', i));

  ok('the encouragement override is GONE', !/override any instinct to be encouraging/.test(debrief));
  ok('...replaced by a rule that binds figures, not warmth', /never bind the warmth/.test(debrief));
  ok('no surface tells him to harden his tone', !/Do not soften it/.test(debrief));
  ok('...the HR ceiling rule now guards the FIGURE instead', /Never fudge the figure/.test(debrief));

  // Section 2 was literally called "The Verdict". A section named Verdict gets a verdict written
  // into it however warm the persona is, and there was nowhere for affirmation to go at all.
  ok('the mandated structure no longer opens on a "Verdict"', !/The Verdict/.test(debrief));
  ok('...it opens on a Headline that leads with what went right',
     /The Headline/.test(debrief) && /Lead with what went right/.test(debrief));
  ok('...and warmth has a section of its own, from the reference character',
     /The Smart Move You Already Made/.test(debrief));
  ok('...which is skipped only when there is genuinely no good call to name',
     /not because the session was ordinary/.test(debrief));

  // The renderer draws "**Name**" and "## Name" as headings but leaves mid-sentence asterisks as
  // literal text, so a flat "no asterisk-bolding" banned the one bold form that actually works.
  ok('bold is allowed where the renderer supports it', !/No asterisk-bolding\./.test(debrief));
  ok('...and refused where it would print literal asterisks', /Never bold inside a sentence/.test(debrief));
}

console.log('\n' + Y + '=== the panel can actually DRAW what the prompt asks for ===' + X);
{
  // Asking for a table is worthless if the renderer prints pipes. This runs the SERVED
  // _smurkelHTML_ over a real generated debrief - captured from the deployed app - rather than a
  // fixture written to pass.
  const i = html.indexOf('function _smurkelHTML_(');
  let d = 0, k = html.indexOf('{', i), end = k;
  for (; end < html.length; end++) { const c = html[end]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  // eslint-disable-next-line no-new-func
  const render = new Function('_cvEsc_', 'return ' + html.slice(i, end + 1) + '; ')(
    (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const real = [
    '## Morning Run — easy miles banked',
    '',
    '**The Verdict**',
    '',
    'This was a well-executed easy run.',
    '',
    '---',
    '',
    '**What Moved**',
    '',
    '| Metric | Aug 10 | Aug 12 | Change |',
    '|---|---|---|---|',
    '| Avg HR | 143 bpm | 140 bpm | −3 bpm |',
    '| TSS | 52 | 50 | −2 |',
    '',
    '✅ HR down, pace steady — that is adaptation showing up.',
    '⚠️ Duration was roughly double what was prescribed.',
    '- a bullet still renders as a bullet'
  ].join('\n');
  const out = render(real);

  ok('a markdown table becomes a real table', /<table[\s>]/.test(out));
  ok('...with a header row', /<th[\s>]/.test(out) && />Metric</.test(out));
  ok('...and one row per data line', (out.match(/<tr>/g) || []).length === 3);
  ok('...the |---| separator is dropped, not drawn', !/---/.test(out));
  ok('...and no literal pipes survive', out.indexOf('|') < 0);
  ok('...it scrolls rather than widening the panel', /overflow-x:auto/.test(out));
  ok('a horizontal rule becomes a divider, not an empty bullet', /height:1px/.test(out));
  ok('a title-case "**What Moved**" is drawn as a heading', /text-transform:uppercase[^>]*>What Moved</.test(out));
  ok('...as is a "## " heading', /text-transform:uppercase[^>]*>Morning Run/.test(out));
  ok('the check flag is styled', /&#10003;/.test(out));
  ok('the warning flag is styled too', /&#9888;/.test(out));
  ok('bullets still render as bullets', /&middot;/.test(out));
  ok('prose is still prose', />This was a well-executed easy run\.</.test(out));
}

try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) {}
console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'Dr. Smurkel persona: all checks passed' + X));
process.exit(fails ? 1 : 0);
