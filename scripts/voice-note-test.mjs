// Voice-note ride tags. The whole design turns on ONE constraint: no audio is ever stored. st
// already serialises to ~13.5 MB and localStorage sits near 3.55 MB of a ~5 MB quota, which has
// silently failed saves in this app before. So these assertions guard the constraint, not just the
// feature - a future edit that starts keeping a Blob would pass a naive "does it record" test.
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
const NL = String.fromCharCode(10);
const noComments = (t) => t.split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);

const st = { rides: [] };
const M = new Function('st', asServed(
  'function rideKey(r){ return "k:"+r.date+"_"+(r.stravaId||""); }' + NL +
  'function sv(){ st.__saved = (st.__saved||0)+1; }' + NL +
  exFn('_vnSave_') + exFn('_vnRideByKey_') +
  ';return { _vnSave_, _vnRideByKey_ };'
))(st);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== NO AUDIO IS STORED - the constraint the design exists for ===' + X);
{
  const mod = noComments(exFn('_vnStart_') + exFn('_vnFinish_') + exFn('_vnSave_') + exFn('_vnRowHTML_'));
  ok('nothing constructs a Blob', !/new Blob/.test(mod));
  ok('nothing uses MediaRecorder', !/MediaRecorder/.test(mod));
  ok('no base64 audio is built', !/toDataURL|readAsDataURL|btoa\(/.test(mod));
  ok('no audio is written to the ride', !/\.audio\s*=|audioBlob|\.wav|\.mp3|\.webm/.test(mod));
  ok('transcription is on-device Web Speech', /SpeechRecognition/.test(noComments(exFn('_vnStart_'))));
  ok('...and the transcript is what gets saved', /ride\.note=t/.test(noComments(exFn('_vnSave_'))));
}

console.log('\n' + Y + '=== the note survives a cross-device merge ===' + X);
{
  // A note written on the phone has to beat a laptop copy that has none. That needs BOTH the edit
  // stamp and a place on the per-field allowlist - the fix from the rides merge work.
  ok("'note' is on RIDE_LWW_FIELDS_", /var RIDE_LWW_FIELDS_=\['name','note'/.test(src));
  st.rides.length = 0;
  const ride = { date: '2026-08-11', stravaId: '1', name: 'Zwift' };
  st.rides.push(ride);
  M._vnSave_(ride, '  legs felt heavy today  ');
  eq('the transcript is trimmed', ride.note, 'legs felt heavy today');
  ok('an edit stamp is set, or the merge cannot order it', ride.editedAt > 0);
  eq('...and the per-field mask names the field', ride._edited.note, 1);
  ok('it persists', st.__saved > 0);
}
{
  const ride = { date: '2026-08-11', stravaId: '2', note: 'old' };
  st.rides.length = 0; st.rides.push(ride);
  M._vnSave_(ride, '');
  ok('clearing REMOVES the field rather than storing an empty string', !('note' in ride));
  eq('...and still stamps, so the deletion travels', ride._edited.note, 1);
}
{
  st.rides.length = 0;
  st.rides.push({ date: '2026-08-11', stravaId: '9', note: 'mine' });
  st.rides.push({ date: '2026-08-11', stravaId: '8', note: 'other', deleted: true });
  eq('lookup finds the live ride by key', M._vnRideByKey_('k:2026-08-11_9').note, 'mine');
  eq('...and never a deleted one', M._vnRideByKey_('k:2026-08-11_8'), null);
}

console.log('\n' + Y + '=== Dr Smurkel receives it, fenced ===' + X);
{
  const facts = exFn('_smurkelFacts_');
  ok('the note is passed to the debrief', /ATHLETE NOTE/.test(facts));
  ok('...quoted verbatim from the ride', /C\.ride && C\.ride\.note/.test(facts));
  ok('...and outranks the numbers on subjective claims', /OUTRANKS the numbers/.test(facts));
  ok('...with an explicit no-inventing fence', /invent detail it does not contain/.test(facts));
  ok('...and no diagnosing from it', /do NOT diagnose/.test(facts));
  // A quote mark inside the note would break out of the quoted string in the prompt.
  ok('embedded quotes are neutralised', /replace\(\/"\/g/.test(facts));
}

console.log('\n' + Y + '=== degrades honestly where speech is unavailable ===' + X);
{
  const row = noComments(exFn('_vnRowHTML_'));
  ok('the button reads Add note when speech is unsupported', /_vnSupported_\(\)\?'Voice note':'Add note'/.test(row));
  ok('typing is always offered, not only as a fallback', /_vnType_/.test(row));
  const start = noComments(exFn('_vnStart_'));
  ok('an unsupported browser routes to typing instead of failing on tap', /if\(!_vnSupported_\(\)\)\{ _vnType_/.test(start));
  ok('a blocked microphone says so in words', /Microphone blocked/.test(exFn('_vnStart_')));
  ok('the row is mounted in the ride detail', /_vnRowHTML_\(r\)/.test(src));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'voice notes: all checks passed' + X));
process.exit(fails ? 1 : 0);
