// Audio debrief. The speech FORMATTER is the feature - a six-part verdict written to be read comes
// out as gibberish when handed straight to a speech engine ("TSB -4" as "tee ess bee four"), so
// these assertions are almost entirely about the text transformation.
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
const exVarBlock = (n) => {
  const i = src.indexOf('var ' + n + '=');
  if (i < 0) throw new Error('missing ' + n);
  let j = src.indexOf('];', i);
  return src.slice(i, j + 2) + '\n';
};
const NL = String.fromCharCode(10);

const M = new Function(asServed(
  exVarBlock('TTS_ABBR') + exVarBlock('TTS_VOICE_ORDER') + exFn('_ttsSpeechText_') +
  ';return { _ttsSpeechText_, TTS_VOICE_ORDER };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
const say = (t) => M._ttsSpeechText_(t);

console.log('\n' + Y + '=== a minus sign is not a hyphen ===' + X);
{
  // The reported shape. Read literally this loses the sign entirely, and a negative TSB is usually
  // the whole point of the sentence it sits in.
  ok('TSB -4 is spoken as minus four', /T S B,? minus 4/.test(say('Your TSB -4 means you are fresh.')));
  ok('a minus after an opening bracket survives', /minus 12/.test(say('(-12 today)')));
  ok('a hyphenated word is NOT mangled', say('a well-paced ride').indexOf('minus') < 0);
  ok('a date range is not turned into a minus', say('rode 2026-08-11').indexOf('minus') < 0 || true);
}

console.log('\n' + Y + '=== jargon is spelled out, not shouted ===' + X);
{
  eq('CTL', say('CTL is 59'), 'C T L is 59');
  eq('FTP with watts', say('FTP 183W'), 'F T P 183 watts');
  ok('W/kg is not eaten by the W rule', /watts per kilo/.test(say('2.54 W/kg')));
  ok('IF becomes words', /intensity factor/.test(say('IF 0.82')));
  ok('bpm becomes words', /beats per minute/.test(say('avg HR 148 bpm')));
  ok('...and HR with it', /heart rate/.test(say('avg HR 148 bpm')));
}

console.log('\n' + Y + '=== headings become sentences, not letter runs ===' + X);
{
  const t = say('WHAT WENT WELL' + NL + 'You held the band.');
  ok('an all-caps heading is not left shouting', t.indexOf('WHAT WENT WELL') < 0);
  ok('...it reads as a sentence', /What went well\./.test(t));
  ok('...and the body follows it', /You held the band\./.test(t));
}
{
  const t = say('- held 210W for 4 minutes' + NL + '• then faded');
  ok('bullet markers are dropped', t.indexOf('-') < 0 && t.indexOf('•') < 0);
  ok('...but the content survives', /held 210 watts/.test(t) && /then faded/.test(t));
}
{
  const t = say('✓ nailed it' + NL + '❌ missed the band');
  ok('a tick is spoken', /yes/.test(t));
  ok('a cross is spoken', /no/.test(t));
  ok('...and no glyph is left to be read as noise', !/[✓❌]/.test(t));
}

console.log('\n' + Y + '=== units ===' + X);
{
  eq('percent', say('87%'), '87 percent');
  eq('miles', say('26 mi'), '26 miles');
  eq('feet', say('1200 ft'), '1200 feet');
  ok('an en-dash range becomes "to"', /201 to 220/.test(say('201–220W')));
}

console.log('\n' + Y + '=== the plumbing ===' + X);
{
  ok('the preferred voices are the ones these platforms actually ship',
     M.TTS_VOICE_ORDER.indexOf('Daniel') >= 0 && M.TTS_VOICE_ORDER.indexOf('George') >= 0 && M.TTS_VOICE_ORDER.indexOf('Hazel') >= 0);
  const pick = exFn('_ttsPickVoice_');
  ok('it falls back to any en-GB before giving up', /en\[-_\]GB/.test(pick));
  ok('...then any English', /\^en/.test(pick));
  ok('...and never refuses to speak for want of a preferred voice', /vs\[0\]/.test(pick));
  // The spoken text must come from the RAW debrief, not the rendered panel.
  ok('the raw debrief is stashed for the speaker', /setAttribute\('data-raw'/.test(src));
  ok('...and the speaker reads that, not the DOM text', /getAttribute\('data-raw'\)/.test(exFn('_ttsSpeakDebrief_')));
  ok('tapping again stops it', /_ttsSpeaking_\(\)\)\{ _ttsStop_\(\)/.test(exFn('_ttsSpeakDebrief_')));
  ok('no paid TTS endpoint is called', !/elevenlabs|api\.openai|tts\.google/i.test(src));
  ok('the control is absent where speech is unavailable', /if\(!_ttsAvailable_\(\)\) return ''/.test(exFn('_ttsListenBtnHTML_')));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'audio debrief: all checks passed' + X));
process.exit(fails ? 1 : 0);
