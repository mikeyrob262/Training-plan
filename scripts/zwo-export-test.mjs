// .zwo export — Zwift custom workout built from the Coach V / session prescription.
//
// Zwift stores power as a FRACTION of FTP (1.0 = FTP), so every number here is watts/FTP off the
// FTP in force for that date. The file must reproduce the prescription, not a plausible workout:
// a "4x4 min, 3 min recovery" VO2 that exports as one 45-minute block at 100% FTP is not a
// rideable session, and that is exactly what shipped — _structIntervals_ was served with its
// regex escapes eaten (see scripts/served-escape-test.mjs), never matched, and every interval
// session silently fell through to the continuous branch.
//
// Two session shapes reach the builder and nest differently:
//   st.plan       (session-detail sheet) -> { type, intent, name, targets, block:{ struct } }
//   blockPlanFor_ (Coach V card)         -> { intent, struct, rx:{ type, name, targets } }
// Reading only the first is why the Coach V card produced nothing.
//
// Run: node scripts/zwo-export-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
function extractVar(name){ const i=src.indexOf('var '+name+'='); if(i<0) throw new Error('var not found: '+name); return src.slice(i, src.indexOf('\n', i))+'\n'; }

// These functions carry regex escapes, and the whole point of this area is that the served copy is
// not the source copy. Testing the raw source would test a regex the browser never runs: source
// /\\d+/ is CORRECT only because the template literal consumes one backslash level on the way out.
// So apply that same transformation here and test what actually ships.
//   untagged template literal:  \\ -> \    and any other \X -> X
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));

// _ZWO_INTERVAL_INTENTS + _zwoStructFor_ are new dependencies of _zwoFor_: an interval session whose
// structure cannot be resolved must now REFUSE rather than flatten into one block at the band
// midpoint. Without them here _zwoFor_ throws inside its own try/catch and silently returns null,
// which is how this harness failed — a missing extraction, not a behaviour change.
let code = extractVar('_ZWO_WARM_SEC') + extractVar('_ZWO_INTERVAL_INTENTS');
for (const f of ['_structIntervals_','_zwoEsc_','_zwoPwr_','_zwoSession_','_zwoStructFor_','_zwoFor_']) code += extract(f);
code = asServed(code);
const M = new Function('st','ftpOn_','blockPlanFor_','_planSessionFromDef_',
  code + '\n;return {_structIntervals_,_zwoSession_,_zwoFor_,_zwoPwr_};')(
  { ftp:190 }, () => 190, () => ({ phaseLabel:'Base build', weekInPhase:1 }), () => null);

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
const T = { powerLo:181, powerHi:200, ftp:190, durationMin:45, zone:'Z5' };   // real VO2 targets
const TH = { powerLo:162, powerHi:181, ftp:190, durationMin:75, zone:'Z4' };  // real threshold targets

console.log('\n=== the parser that was silently dead ===');
check('4x4 min, 3 min recovery', M._structIntervals_('4x4 min, 3 min recovery, flat'), {n:4, workMin:4, recMin:3});
check('3x12 min, 5 min recovery', M._structIntervals_('3x12 min, 5 min recovery'), {n:3, workMin:12, recMin:5});
check('2x20 min (no stated recovery)', M._structIntervals_('2x20 min'), {n:2, workMin:20, recMin:null});
check('a progression struct still yields its base', M._structIntervals_('4x4 progressing to 5x4'), {n:4, workMin:4, recMin:null});
check('a continuous struct is not an interval set', M._structIntervals_('60-90 min'), null);

console.log('\n=== both session shapes normalise to the same thing ===');
const stPlan = { type:'ride', intent:'vo2', name:'VO2', targets:T, block:{ struct:'4x4 min, 3 min recovery, flat' } };
const coachV = { intent:'vo2', struct:'4x4 min, 3 min recovery, flat', rx:{ type:'ride', name:'VO2', targets:T } };
check('st.plan shape resolves', [M._zwoSession_(stPlan).type, M._zwoSession_(stPlan).struct], ['ride','4x4 min, 3 min recovery, flat']);
check('blockPlanFor_ shape resolves', [M._zwoSession_(coachV).type, M._zwoSession_(coachV).struct], ['ride','4x4 min, 3 min recovery, flat']);
const a=M._zwoFor_(stPlan,'2026-07-28'), b=M._zwoFor_(coachV,'2026-07-28');
check('and produce byte-identical files', a.xml===b.xml, true);

console.log('\n=== VO2: the reported case ===');
const vo2=a.xml;
check('is valid-looking XML', /^<workout_file>[\s\S]*<\/workout_file>\s*$/.test(vo2), true);
check('names the author', vo2.indexOf('<author>Athlete IQ</author>')>=0, true);
check('is a bike workout', vo2.indexOf('<sportType>bike</sportType>')>=0, true);
check('has a warm-up', /<Warmup Duration='600'/.test(vo2), true);
check('4 repeats of 4 minutes', /<IntervalsT Repeat='4' OnDuration='240'/.test(vo2), true);
check('3 minutes recovery between them', /OffDuration='180'/.test(vo2), true);
check('on-power is the band midpoint as a fraction of FTP', /OnPower='1.003'/.test(vo2), true);
check('has a cool-down', /<Cooldown Duration='300'/.test(vo2), true);
check('NOT one long steady block', /<SteadyState/.test(vo2), false);
check('three blocks total', a.blocks, 3);

console.log('\n=== threshold: long efforts written out with explicit recovery ===');
const th=M._zwoFor_({ intent:'threshold', struct:'3x12 min, 5 min recovery',
  rx:{ type:'ride', name:'Threshold', targets:TH } }, '2026-08-04');
check('3 work blocks of 12 minutes', (th.xml.match(/<SteadyState Duration='720' Power='0\.903'\/>/g)||[]).length, 3);
check('2 recovery blocks of 5 minutes between them', (th.xml.match(/<SteadyState Duration='300' Power='0\.55'\/>/g)||[]).length, 2);
check('bracketed by warm-up and cool-down', [/^\s*<Warmup/m.test(th.xml), /<Cooldown/.test(th.xml)], [true,true]);
check('seven blocks total', th.blocks, 7);
check('no IntervalsT — the recovery is explicit here', /<IntervalsT/.test(th.xml), false);

console.log('\n=== continuous rides ===');
const z2=M._zwoFor_({ intent:'z2', struct:'60-90 min',
  rx:{ type:'ride', name:'Z2 Endurance', targets:{ powerLo:114, powerHi:152, ftp:190 } } }, '2026-07-30');
check('one steady block', z2.blocks, 1);
check('takes the LOW end of the stated range, not the high', /Duration='3600'/.test(z2.xml), true);
check('at the band midpoint', /Power='0\.7'/.test(z2.xml), true);

console.log('\n=== power is a FRACTION of FTP, per the .zwo spec ===');
check('190W at FTP 190 is 1.0', M._zwoPwr_(190,190), 1);
check('95W at FTP 190 is 0.5', M._zwoPwr_(95,190), 0.5);
check('rounded to 3 decimals', M._zwoPwr_(190.5,190), 1.003);
check('no FTP means no fraction', M._zwoPwr_(190,0), null);

console.log('\n=== the gate: bike sessions on a trainer only ===');
for(const t of ['run','strength','mobility','rest'])
  check(t+' produces no file', M._zwoFor_({ intent:t, struct:'4x4 min', rx:{ type:t, targets:T } }, '2026-07-28'), null);
check('a group ride has no ERG target to hold',
  M._zwoFor_({ intent:'group', struct:'120 min', rx:{ type:'ride', targets:T } }, '2026-07-25'), null);
check('a ride with no power band produces nothing',
  M._zwoFor_({ intent:'z2', struct:'60 min', rx:{ type:'ride', targets:{ ftp:190 } } }, '2026-07-30'), null);
check('a ride with no duration and no intervals produces nothing',
  M._zwoFor_({ intent:'z2', struct:'', rx:{ type:'ride', targets:{ powerLo:114, powerHi:152, ftp:190 } } }, '2026-07-30'), null);
check('a null session is handled', M._zwoFor_(null,'2026-07-28'), null);

console.log('\n=== XML safety ===');
const amp=M._zwoFor_({ intent:'vo2', struct:'4x4 min', rx:{ type:'ride', name:'VO2 <hard> & "fast"', targets:T } }, '2026-07-28');
check('the name is escaped', amp.xml.indexOf('VO2 &lt;hard&gt; &amp; &quot;fast&quot;')>=0, true);
check('no raw angle bracket leaks into the name', /<name>[^<]*<hard>/.test(amp.xml), false);
check('the filename is filesystem-safe', /^[a-z0-9-]+\.zwo$/.test(amp.filename), true);

console.log('\n=== source guard: the Coach V card offers it ===');
check('Coach V builds a file for its own session', /_zwoFor_\(cv\.primary, dk\)/.test(src), true);
check('...and wires a download handler', /_zwoCoachV_\(&#39;'\+dk\+'&#39;\)/.test(src), true);
check('the handler is reachable from the DOM', /window\._zwoCoachV_\s*=/.test(src), true);
check('the fallback link targets the card that was pressed', /_zwoFallback_\(z, url, sid==='cv'\?'cv-zwo':'sd-zwo'\)/.test(src), true);


// this file's helper is check(label, got, want); ok() is the boolean shorthand used below
const ok = (label, cond) => check(label, !!cond, true);
console.log('\n' + (typeof C !== 'undefined' ? C : '') + '=== VO2 is prescribed in the VO2 zone, not threshold ===' + (typeof X !== 'undefined' ? X : ''));
{
  // Reported live: the VO2 block generated 174-192 W at FTP 183 - 95-105%, which is threshold.
  // Zwift's own 210 W was the correct figure. The band feeds the on-screen watts, the step card AND
  // the .zwo export from one place, so this is the single thing that was wrong.
  const defs = src.slice(src.indexOf('  z2:       { type:'), src.indexOf('  rest:     { type:'));
  const vo2 = /vo2:\s*\{[^}]*pctFtp:\[(\d+),(\d+)\]/.exec(defs);
  check('the VO2 def carries a band', !!(!!vo2), true);
  const lo = vo2 ? +vo2[1] : 0, hi = vo2 ? +vo2[2] : 0;
  check('VO2 low end is above threshold (' + lo + '% >= 106%)', !!(lo >= 106), true);
  check('VO2 high end is a real ceiling (' + hi + '% <= 125%)', !!(hi <= 125 && hi > lo), true);
  // The reported numbers, at the FTP that produced them.
  ok('at FTP 183 the band is ~201-220 W, not 174-192 (' + Math.round(183*lo/100) + '-' + Math.round(183*hi/100) + 'W)',
     Math.round(183*lo/100) >= 195 && Math.round(183*hi/100) <= 225);
  check("...and contains Zwift's 210 W", !!(183*lo/100 <= 210 && 210 <= 183*hi/100), true);

  // THE INVARIANT THAT WAS ACTUALLY BROKEN: the prescription and the grader must agree. The app
  // grades a ride as VO2 only at ratio >= 1.06, so a session ridden exactly to a 95-105% band came
  // back graded THRESHOLD - prescribed as one thing, scored as another.
  const gate = /if\(ratio>=([\d.]+)\) return 'vo2';/.exec(src);
  check('the grader has a VO2 ratio gate', !!(!!gate), true);
  const gateVal = gate ? +gate[1] : 0;
  ok('a ride at the BOTTOM of the prescribed band still grades as VO2 (' + (lo/100) + ' >= ' + gateVal + ')',
     lo/100 >= gateVal);

  // And it must not collide with the threshold prescription below it.
  const thr = /threshold:\s*\{[^}]*pctFtp:\[(\d+),(\d+)\]/.exec(defs);
  check('VO2 sits entirely above the threshold band', !!(!!thr && lo > +thr[2]), true);
}
console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'zwo-export: all checks passed'+X));
process.exit(fails?1:0);
