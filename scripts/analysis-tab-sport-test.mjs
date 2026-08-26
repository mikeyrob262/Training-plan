// THE AI ANALYSIS TAB MUST KNOW WHAT SPORT IT IS LOOKING AT.
//
// Reported on a 6.3-mile run in Central Park: the debrief compared it to a 2017 RIDE, quoted watts,
// and said "without avg or NP I can't tell you whether the same HR is now buying more or less
// watts". None of that was the model inventing things - it was the prompt.
//
// Two mechanisms, both in the prompt builder:
//   the comparison set was filtered on `avgPwr` being present, which only cycling activities carry,
//   so for a run it could return nothing but rides;
//   the activity line hardcoded "avg power ...W, NP ...W", which resolves to "?" on a run - which is
//   precisely the gap the model then reported.
//
// _actProfile_ already resolves sport correctly and is used by the ride debrief, the coach panel and
// the activity header. This surface simply never called it.
//
// What this file pins is behavioural, not cosmetic: given a RUN, the prompt must carry pace and must
// not carry watts, and the comparison set must not contain a ride. Given a RIDE, nothing changes.
//
// Run: node scripts/analysis-tab-sport-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

function body(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
  }
  return null;
}

// ---- run the REAL prompt builder against fixtures ----------------------------------------------
// Only the prompt is exercised: the fetch, the cache and the DOM are stubbed, so this measures what
// the model is told and nothing else.
function buildPrompt(activity, library) {
  const fn = body('renderRideAnalysisTab');
  if (!fn) throw new Error('renderRideAnalysisTab not found');
  // Cut the builder off at the fetch - everything after it is transport and rendering.
  const cut = fn.indexOf('var _anKey=');
  const head = fn.slice(fn.indexOf('{') + 1, cut > 0 ? cut : undefined);
  const pre = [
    body('_actProfile_'),
    body('parseDurToMin'),
    "var rideSport_=function(r){ return (r&&(r.sportType||r.type))||''; };",
    "var _smElev_=function(r){ return ((r&&r.elev)||0)+'ft'; };",
    "var _SM_PERSONA='PERSONA'; var _SM_LEAD='LEAD';",
    "var st={ rides:LIB };",
    "var body={appendChild:function(){}};",
    "var document={createElement:function(){ return { style:{}, set innerHTML(v){}, get innerHTML(){return '';} }; }};"
  ].join('\n');
  return new Function('LIB', 'r', 'idx',
    pre + '\n' + head + '\nreturn prompt;')(library, activity, -1);
}

const RUN = { date: '2023-07-18', name: 'Central Park- NYC', sportType: 'Run',
              distance: 6.3, movingSecs: 3092, avgHR: 152, cadence: 172, tss: 69, elev: 177 };
const PAST_RUN = { date: '2023-07-13', sportType: 'Run', distance: 5.1, movingSecs: 2600, avgHR: 151 };
const OLD_RIDE = { date: '2017-06-04', sportType: 'Ride', distance: 8.0, avgPwr: 148, np: 160, avgHR: 151 };
const RIDE = { date: '2024-10-26', name: 'Brookfield', sportType: 'Ride',
               distance: 28.0, avgPwr: 172, np: 186, avgHR: 149, tss: 95, elev: 900 };
const PAST_RIDE = { date: '2024-09-01', sportType: 'Ride', distance: 26.5, avgPwr: 165, avgHR: 147 };

console.log('\n' + Y + '=== a RUN is never handed watts ===' + X);
{
  const p = buildPrompt(RUN, [PAST_RUN, OLD_RIDE]);
  ok('the activity is named as a run, not a ride', /THIS RUN:/.test(p) && !/THIS RIDE:/.test(p));
  ok('pace is stated', /pace 8:11 per mile/.test(p));
  ok('...along with heart rate and cadence', /avg HR 152bpm/.test(p) && /cadence 172spm/.test(p));
  // THE REPORTED SYMPTOMS, each as its own assertion. Tested against the DATA the model is given,
  // with the fence removed first - the fence names watts, FTP and NP precisely in order to forbid
  // them, so searching the whole prompt would fail on the fix rather than on the bug.
  const fenceAt = p.indexOf('This activity is a run.');
  ok('the fence exists and is the only place power is named', fenceAt > 0);
  const data = p.slice(0, fenceAt);
  ok('NEG: no watts in the data given', !/\dW\b/.test(data) && !/avg power/.test(data));
  ok('NEG: no NP in the data given', !/\bNP\b/.test(data));
  ok('NEG: no FTP in the data given', !/\bFTP\b/.test(data));
  ok('NEG: the 2017 RIDE is not offered as a comparison', p.indexOf('2017-06-04') < 0);
  ok('the comparable RUN is', p.indexOf('2023-07-13') > 0);
  ok('and it says power does not apply rather than that it is missing',
     /does not apply/.test(p) && /do not say you lack them/i.test(p));
}

console.log('\n' + Y + '=== a run with nothing comparable says so ===' + X);
{
  const p = buildPrompt(RUN, [OLD_RIDE]);
  ok('the empty set is stated, not left as a dangling label', /none on file at a comparable distance/.test(p));
  ok('NEG: and it still refuses to reach for the ride', p.indexOf('2017-06-04') < 0);
}

console.log('\n' + Y + '=== a RIDE is unchanged ===' + X);
{
  const p = buildPrompt(RIDE, [PAST_RIDE, PAST_RUN]);
  ok('still labelled THIS RIDE', /THIS RIDE:/.test(p));
  ok('still carries power and NP', /avg power 172W/.test(p) && /NP 186W/.test(p));
  ok('the comparable ride is offered', p.indexOf('2024-09-01') > 0);
  ok('NEG: a RUN is not offered as a comparison for a ride', p.indexOf('2023-07-13') < 0);
  ok('NEG: no run-only fence leaks into the cycling prompt', !/does not apply/.test(p));
}

console.log('\n' + Y + '=== the distance window is proportional for runs ===' + X);
{
  // A flat 5-mile window is most of a 6-mile run, so "similar distance" meant almost anything.
  const FAR = { date: '2023-06-01', sportType: 'Run', distance: 2.0, movingSecs: 1000, avgHR: 145 };
  const NEAR = { date: '2023-06-02', sportType: 'Run', distance: 5.8, movingSecs: 2900, avgHR: 150 };
  const p = buildPrompt(RUN, [FAR, NEAR]);
  ok('a 5.8mi run counts as similar to a 6.3mi run', p.indexOf('2023-06-02') > 0);
  ok('NEG: a 2.0mi run does not', p.indexOf('2023-06-01') < 0);
}

console.log('\n' + Y + '=== the sport is resolved through the shared resolver ===' + X);
{
  const fn = body('renderRideAnalysisTab');
  ok('it calls _actProfile_ rather than guessing', fn.indexOf('_actProfile_(r)') > 0);
  ok('...and the loading line names the sport too', /Analyzing this '\s*\+\s*String\(_profEarly\.noun/.test(fn));
  ok('NEG: the comparison set is no longer gated on avgPwr for every sport',
     !/Math\.abs\(ride\.distance-r\.distance\)<5 && ride\.avgPwr/.test(fn));
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'analysis tab sport: all checks passed' + X));
process.exit(fails ? 1 : 0);
