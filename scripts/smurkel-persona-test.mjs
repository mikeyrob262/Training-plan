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
  ok('leads with warmth on real findings', /LEAD WITH WHAT IS TRUE AND GOOD/.test(VOICE));
  ok('...with the reference phrasing to anchor it', /well-executed hilly run with smart pace/.test(VOICE));
  ok('self-corrects out loud', /CHANGE YOUR MIND OUT LOUD/.test(VOICE) && /let me revise/.test(VOICE));
  ok('...and revises rather than appending', /not bolt an addendum onto a verdict/.test(VOICE));
  ok('follows the athlete answer into a new read', /ASK REAL QUESTIONS, THEN USE THE ANSWER/.test(VOICE));
  ok('...folding it in, not recapping', /genuinely NEW read rather than a recap/.test(VOICE));
  ok('closes with real momentum', /CLOSE WITH MOMENTUM/.test(VOICE) && /14 days to the FTP retest/.test(VOICE));
  ok('...explicitly not a generic sign-off', /never a generic sign-off/.test(VOICE));
  ok('reaction is scaled to the size of the thing', /SCALE YOUR REACTION TO THE SIZE/.test(VOICE));
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
  ok('long form asks for light structure', /light structure/.test(LONG));
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

try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) {}
console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'Dr. Smurkel persona: all checks passed' + X));
process.exit(fails ? 1 : 0);
