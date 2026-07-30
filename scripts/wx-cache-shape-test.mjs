// Every consumer of wxCache_ must UNWRAP it.
//
// wxFetch_ stores {data, fetchedAt} in each slot - a wrapper, not the payload. Segment Attack read
// wxCache_.weather.current instead of wxCache_.weather.data.current, which is undefined, so the
// card said "Weather unavailable" on every visit while the Weather page worked perfectly. Nothing
// threw and nothing logged: the fetch always succeeded, the unwrap never happened.
//
// That is the failure this file exists to make impossible to reintroduce. It is a SHAPE bug, and
// shape bugs in a silently-optional field are invisible until someone reads the screen.
//
// Run: node scripts/wx-cache-shape-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const lines = src.split(/\r?\n/);

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

console.log('\n=== the cache stores a WRAPPER, and the contract is written down ===');
check('slot shape is {data, fetchedAt}', /wxCache_\[slot\]=\{data:j, fetchedAt:Date\.now\(\)\}/.test(src), true);
check('and the declaration says so', /var wxCache_=\{ weather:null, aqi:null \};\s*\/\/ each slot: \{data, fetchedAt\}/.test(src), true);

console.log('\n=== no consumer reads a payload field straight off the slot ===');
// Any wxCache_.weather.<field> where field is not data/fetchedAt is reading through the wrapper.
const bad = [];
lines.forEach((L, i) => {
  if (/^\s*\/\//.test(L)) return;
  const m = L.match(/wxCache_\.(weather|aqi)\.(\w+)/g);
  if (!m) return;
  m.forEach((hit) => {
    const field = hit.split('.')[2];
    if (field !== 'data' && field !== 'fetchedAt') bad.push('worker.js:' + (i + 1) + '  ' + hit);
  });
});
check('zero direct payload reads', bad, []);
if (bad.length) bad.forEach((b) => console.log('    ' + R + b + X));

// The specific pattern that broke: `var cur=(wx&&wx.current)`.
console.log('\n=== the exact bug pattern is gone ===');
check('no (wx && wx.current) unwrap-skipping read', /\(wx&&wx\.current\)\?wx\.current/.test(src), false);
const unwrapped = (src.match(/\(wx&&wx\.data&&wx\.data\.current\)\?wx\.data\.current/g) || []).length;
check('both Segment Attack consumers unwrap properly', unwrapped, 2);

console.log('\n=== the fetch kicker retries on failure and repaints any tab ===');
const kick = src.slice(src.indexOf('function _trjKickWeather_('),
                       src.indexOf('function aiRenderTrajectory_('));
check('a failed fetch clears the latch so it can retry', /if\(!\(r && r\.data\)\) _trjWxAsked=false;/.test(kick), true);
check('...and a thrown fetch does too', /\.catch\(function\(\)\{ _trjWxAsked=false; \}\)/.test(kick), true);
check('the "already have it" test requires the PAYLOAD, not just the slot',
  /wxCache_\.weather && wxCache_\.weather\.data\) return;/.test(kick), true);
check('the repaint is no longer trajectory-only', /_aiTab==='trajectory' && _aiMount/.test(kick), false);
check('it repaints whatever tab is mounted', /if\(_aiMount && typeof aiRenderOverview_==='function'\) aiRenderOverview_\(_aiMount\)/.test(kick), true);

console.log('\n=== every surface that READS weather also ASKS for it ===');
// Reading the cache without ever kicking a fill leaves a cold session permanently empty.
['aiRenderSegAttack_','_saEvalAll_'].forEach((fn) => {
  const i = src.indexOf('function ' + fn + '(');
  const body = src.slice(i, i + 2200);
  check(fn + ' kicks the fetch when the cache is cold', /_trjKickWeather_\(\)/.test(body), true);
});

console.log('\n=== behavioural: the unwrap actually yields the payload ===');
// Mirror wxFetch_'s store step, then run both access forms against it.
const payload = { current: { windspeed_10m: 12, winddirection_10m: 272, temperature_2m: 87 } };
const slot = { data: payload, fetchedAt: Date.now() };
check('the OLD access is undefined (this was the bug)', slot.current, undefined);
check('the NEW access finds the wind', (slot && slot.data && slot.data.current) ? slot.data.current.windspeed_10m : null, 12);
// A failed fetch leaves {data:null} — truthy slot, no payload.
const failed = { data: null, fetchedAt: 0 };
check('a failed fetch leaves a truthy slot with no payload', [!!failed, !!failed.data], [true, false]);
check('...so a slot-only guard would wrongly report a hit', !!failed, true);
console.log('  ' + Y + '(that is why the kicker now tests wxCache_.weather.data, not wxCache_.weather)' + X);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'wx-cache-shape: all checks passed'+X));
process.exit(fails ? 1 : 0);
