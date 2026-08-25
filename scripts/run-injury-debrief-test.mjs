// AN INJURY DEBRIEF THAT REACHES ANOTHER PAGE IS A BUG, AND A SUGGESTION IT INVENTED IS WORSE.
//
// Two separate promises are pinned here:
//
//   ISOLATION. This was built Run-page-local on purpose, after a shared-code refactor earlier in the
//     same session silently changed the Dashboard. It composes its own prompt and makes its own
//     request; it reads _SM_PERSONA, a constant, so the voice matches, and it touches nothing else.
//     fetchSmurkelReply_ - which also serves the ride debrief and the pre-ride surfaces - must be
//     byte-identical to what it was before this work.
//
//   FAILING CLOSED. Dr. Smurkel is asked to end with one machine-readable line so a proposal can be
//     a button rather than prose the athlete has to translate. Everything about that parse must
//     refuse rather than guess: no line, an unknown token, trailing words, or a minute count outside
//     a sane band all mean NO suggestion is offered. A number guessed out of prose would be exactly
//     the fabricated authority this app keeps removing.
//
// Run: node scripts/run-injury-debrief-test.mjs
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
function body(s, n) {
  const i = s.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = s.indexOf('{', i); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return s.slice(i, j + 1).replace(/\r\n/g, '\n'); }
  }
  return null;
}

console.log('\n' + Y + '=== it does not touch the shared chat engine ===' + X);
{
  const BASELINE = '9a64e43';
  let base = null;
  try { base = execFileSync('git', ['show', BASELINE + ':worker.js'], { cwd: ROOT, maxBuffer: 64*1024*1024 }).toString('utf8'); } catch (e) {}
  if (!base) console.log('  ' + Y + 'SKIP' + X + '  baseline not reachable');
  else {
    // fetchSmurkelReply_ serves the ride debrief and the pre-ride surfaces. Not this page's to edit.
    ok('fetchSmurkelReply_ is byte-identical to the baseline',
       body(base, 'fetchSmurkelReply_') === body(src, 'fetchSmurkelReply_'));
    ok('_smurkelFacts_ is untouched too', body(base, '_smurkelFacts_') === body(src, '_smurkelFacts_'));
    const pi = src.indexOf('var _SM_PERSONA='), pj = src.indexOf('var _SM_FORMAT');
    const bi = base.indexOf('var _SM_PERSONA='), bj = base.indexOf('var _SM_FORMAT');
    ok('_SM_PERSONA itself is unchanged - it is read, not edited',
       src.slice(pi, pj).replace(/\r\n/g, '\n') === base.slice(bi, bj).replace(/\r\n/g, '\n'));
  }
  const ask = body(src, '_runInjAsk_'), prompt = body(src, '_runInjPrompt_');
  ok('the debrief composes its OWN prompt', !!prompt && prompt.indexOf('_SM_PERSONA') > 0);
  ok('...and makes its OWN request', !!ask && ask.indexOf('fetch(') > 0);
  ok('NEG: it never calls the shared engine', ask.indexOf('fetchSmurkelReply_') < 0 && prompt.indexOf('fetchSmurkelReply_') < 0);
  ok('NEG: nor borrows the ride-debrief format block',
     prompt.indexOf('_SM_FORMAT_CHAT') < 0 && prompt.indexOf('_SM_FORMAT_LONG') < 0);
  // The model matches the rest of the app rather than being quietly upgraded for one surface.
  const m = src.match(/var _RUN_INJ_MODEL='([^']+)'/);
  ok('the model matches the app\'s other Smurkel calls', !!m && src.indexOf("model:'" + m[1] + "'") > 0);
}

console.log('\n' + Y + '=== the suggestion parse fails closed ===' + X);
{
  const trim = body(src, '_runInjTrim_'), parse = body(src, '_runInjParseSuggestion_');
  ok('extracted the scanner', !!trim && !!parse);
  const P = new Function('var _RUN_INJ_MARK="SUGGESTION:";' + trim + 'return ' + parse)();
  const NL = String.fromCharCode(10);
  eq('a whole-minute target is taken', P('Ease off.' + NL + 'SUGGESTION: 30'), { text:'Ease off.', kind:'target', top:30 });
  eq('HOLD is taken', P('Stay put.' + NL + 'SUGGESTION: HOLD'), { text:'Stay put.', kind:'hold', top:null });
  eq('NONE yields no proposal', P('Tell me more.' + NL + 'SUGGESTION: NONE'), { text:'Tell me more.', kind:'none', top:null });
  ok('the marker line never reaches the athlete', P('x' + NL + 'SUGGESTION: 30').text.indexOf('SUGGESTION') < 0);
  ok('surrounding whitespace is tolerated', P('x' + NL + '   SUGGESTION:   30   ').kind === 'target');
  // NEGATIVE CONTROLS - every one of these must yield NO suggestion.
  eq('NEG: no marker at all', P('Just prose.').kind, 'none');
  eq('NEG: trailing words are not the contract', P('x' + NL + 'SUGGESTION: HOLD for now').kind, 'none');
  eq('NEG: a word it does not know', P('x' + NL + 'SUGGESTION: MAYBE').kind, 'none');
  eq('NEG: an implausibly short target', P('x' + NL + 'SUGGESTION: 3').kind, 'none');
  eq('NEG: an implausibly long one', P('x' + NL + 'SUGGESTION: 300').kind, 'none');
  eq('NEG: a number in the prose is not a suggestion', P('Try about 40 minutes.').kind, 'none');
  eq('NEG: empty input', P('').kind, 'none');
  eq('NEG: null input', P(null).kind, 'none');
  // Written as a SCAN, because this file is served inside a template literal that eats one backslash
  // level - a source \s arrives as a literal s and the pattern stops matching whitespace.
  ok('the scanner uses no regex escapes', parse.indexOf('\\s') < 0 && trim.indexOf('\\s') < 0);
  ok('...and compares whitespace by character code', trim.indexOf('charCodeAt') > 0);
}

console.log('\n' + Y + '=== the debrief is a record, and nothing it says moves the plan ===' + X);
{
  const sheet = body(src, 'runInjDebriefOpen_'), append = body(src, 'injAppendTurn_');
  ok('every turn is appended to the injury entry', !!append && append.indexOf('list[i].debrief.push') > 0);
  ok('...and bounded, so one conversation cannot grow a synced record forever', /debrief\.length>\d+/.test(append));
  ok('...with editedAt, so a correction wins the merge', append.indexOf('editedAt') > 0);
  ok('both sides of the conversation are stored', /who:\(who==='you'\?'you':'sm'\)/.test(append));
  // THE ONE RULE. A suggestion is a button; accepting writes through the same target writer the card
  // and the manual sheet use, and there is no path that applies one on its own.
  ok('accepting a target goes through the one writer', sheet.indexOf('runSetWeekdayTarget_(pending.top') > 0);
  ok('accepting a hold only changes the report status', sheet.indexOf("injSetStatus_(id,'easing')") > 0);
  ok('NEG: nothing applies a suggestion without a click',
     !/_runInjAsk_[\s\S]{0,600}runSetWeekdayTarget_/.test(sheet));
  ok('NEG: the debrief never writes st.runRungs directly', sheet.indexOf('st.runRungs') < 0);
  // He is a coach here, and the prompt has to say so - this is the claim most worth pinning.
  const prompt = body(src, '_runInjPrompt_');
  ok('the prompt forbids diagnosis', /You are a coach, not a doctor/.test(prompt));
  ok('...and asks him to send it on when it needs sending on', /physio or a scan/.test(prompt));
  ok('...and forbids inventing numbers', /Do not invent any others/.test(prompt));
  ok('the sheet says the same thing to the athlete', src.indexOf('He is a coach, ') > 0);
}

console.log('\n' + Y + '=== what he is given to reason from is measured, not invented ===' + X);
{
  const facts = body(src, '_runInjFacts_');
  ok('the athlete\'s own report leads', facts.indexOf('THE REPORT HE FILED') > 0);
  ['_runAheadFlag_', '_runShinWatch_', '_runDriftHrvBaseline_', '_rtSeries_'].forEach(fn =>
    ok('it reads ' + fn + ' rather than restating it', facts.indexOf(fn) > 0));
  ok('NEG: every read is guarded, so one missing accessor cannot blank the facts',
     (facts.match(/typeof /g) || []).length >= 4);
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'injury debrief: all checks passed' + X));
process.exit(fails ? 1 : 0);
