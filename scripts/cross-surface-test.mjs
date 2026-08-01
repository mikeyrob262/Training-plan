// Cross-surface agreement — the Phase 0 guard.
//
// Every bug this phase found was the same shape: ONE fact, computed two ways, disagreeing on
// screen with nothing to indicate anything was wrong. A month total of 1,593,772 TSS. Today's
// session showing tomorrow's after 8pm. Three different W/kg from three different invented
// bodyweights. None of them threw; none of them looked broken.
//
// So this file does not test features. It tests that the app still has ONE answer per fact, in
// the five categories the audit covered:
//   1. week / date identity      2. FTP, weight and goal sources
//   3. plan vs calendar agreement 4. counts, TSS and distance totals
//   5. honest failure (an em-dash, never a plausible number)
//
// Two kinds of assertion, deliberately:
//   INVARIANT — the disagreeing PATTERN is absent from the source. Cheap, and it catches the
//               reintroduction rather than the symptom.
//   BEHAVIOUR — the canonical function actually does the right thing, run in its SERVED form.
//               Source-form testing would have passed the /\d+/ bug that shipped, so everything
//               executable here goes through asServed first.
//
// Run: node scripts/cross-surface-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

// the untagged template literal's own transformation: \\ -> \ , any other \X -> X
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', D='\x1b[2m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
// count matches of a pattern OUTSIDE comment lines — a rule quoted in a comment is not a violation
const codeLines = src.split('\n').filter(L => !/^\s*\/\//.test(L));
const countCode = (re) => codeLines.reduce((n,L)=> n + ((L.match(re)||[]).length), 0);

// ── 1. WEEK / DATE IDENTITY ───────────────────────────────────────────────────────────────────
console.log('\n'+C+'=== 1. one definition of "today" and "this week" ==='+X);
// INVARIANT: no toISOString day keys. It names the UTC day, so after 20:00 EDT it is tomorrow —
// measured: the same lookup returned "Threshold, Strength A" locally and "Group Ride" via ISO.
// One documented exception: the wellness fallback in the Worker's own fetch handler. That runs
// SERVER-side with no knowledge of the athlete's timezone and its callers pass an explicit date;
// fixing it properly means plumbing a timezone through, not swapping a call. Named here so the
// exception stays a decision rather than becoming the hole the rule leaks back through.
const isoDayLines = codeLines.filter(L => /toISOString\(\)\.slice\(0,\s*10\)|toISOString\(\)\.split\('T'\)\[0\]/.test(L));
check('no toISOString day keys outside the one server-side exception',
      isoDayLines.filter(L => !/safeDay/.test(L)).length, 0);
check('the server-side exception is still exactly one line', isoDayLines.length, 1);
// BEHAVIOUR: dayKey_ names the LOCAL day even when UTC has already rolled over.
const D1 = new Function(asServed(ex('dayKey_')) + ';return dayKey_;')();
const evening = new Date(2026, 6, 31, 21, 30, 0);          // 21:30 local, whatever the host TZ is
check('dayKey_ uses local calendar parts', D1(evening), '2026-07-31');
check('dayKey_ pads month and day', D1(new Date(2026,0,5)), '2026-01-05');
check('dayKey_ handles a year boundary', D1(new Date(2025,11,31,23,59)), '2025-12-31');
// INVARIANT: headline CTL/ATL/TSB come from getFitness_, never from the tail of a page's own PMC
// array. Analytics drifted back onto its array tail and showed 57/53/+4 against 58/58/0 everywhere
// else — the same fact, a day apart, because getFitness_ prefers today's live poll and the cached
// daily series does not. This is the Jul-18 single-source rule; it has now regressed once.
const headlineFit = codeLines.filter(L => /\b(lastCTL|lastATL|lastTSB)\s*=/.test(L));
check('headline CTL/ATL/TSB are assigned somewhere', headlineFit.length>0, true);
// INVARIANT: a displayed "Current CTL" is the canonical one too. The projection seeded itself off
// the tail of the cached series while the headline above it came from getFitness_ (which prefers
// today's live poll) — the same one-day gap that had Analytics and Athlete Intelligence printing
// different TSB from the same data on the same screen-refresh.
check('the CTL projection seeds off getFitness_, not the series tail',
  /var curCTL=\(_fitProj&&_fitProj\.loaded\)\?_fitProj\.ctl/.test(src), true);
check('no projection reads the pmcData tail as current fitness',
  countCode(/var last=pmcData\.length\?pmcData\[pmcData\.length-1\]/g), 0);
check('every headline CTL/ATL/TSB assignment consults getFitness_',
      headlineFit.filter(L => !/getFitness_|_fitAn/.test(L)).map(L=>L.trim().slice(0,60)), []);
// INVARIANT: ONE block-week implementation. A second inline copy had no end bound and would have
// counted "Block Wk 47" after the block closed.
check('block week computed in exactly one place', countCode(/Math\.floor\(\s*_dd\s*\/\s*7\s*\)/g), 0);
check('_blockWeekOf_ still exists as that one place', /function _blockWeekOf_\(/.test(src), true);

// ── 2. FTP / WEIGHT / GOAL SOURCES ────────────────────────────────────────────────────────────
console.log('\n'+C+'=== 2. one FTP, one weight, goals labelled as goals ==='+X);
// INVARIANT: no per-site weight fallback. These had drifted to 160 / 162 / 162.5.
check('no invented bodyweight fallbacks', countCode(/st\.weight\s*\|\|\s*\d/g), 0);
// BEHAVIOUR: no weight -> null, never a number.
const W = new Function('st', asServed(ex('stWeightLb_')+ex('wkgFromW_')+ex('wkgStr_')) + ';return {stWeightLb_,wkgFromW_,wkgStr_};');
const wNone = W({}), wSet = W({weight:'159'});
check('no weight -> stWeightLb_ null', wNone.stWeightLb_(), null);
check('weight set -> the real number', wSet.stWeightLb_(), 159);
check('no weight -> wkgFromW_ null', wNone.wkgFromW_(183), null);
check('weight set -> a real W/kg', wSet.wkgFromW_(183), 2.54);
check('no watts -> null even with a weight', wSet.wkgFromW_(0), null);
// INVARIANT: the Goals inputs say TARGET. Profile and Goals both read "FTP (W)" one screen apart,
// which is what made a goal look like a second, disagreeing FTP.
check('goal FTP input is labelled a target', /FTP target \(W\)/.test(src), true);
check('goal weight input is labelled a target', /Weight target \(lb\)/.test(src), true);
check('no bare "FTP (W)" label left to collide', countCode(/'FTP \(W\)'|>FTP \(W\)</g), 0);

// ── 3. PLAN vs CALENDAR AGREEMENT ─────────────────────────────────────────────────────────────
console.log('\n'+C+'=== 3. the calendar can render every day the plan holds ==='+X);
// INVARIANT: no month-grid cell without a date key. Aug 1 2026 fell in July's trailing pad, and
// pad cells carried no date at all, so a real Group Ride rendered as an empty box.
check('no pad cell is built without a date', countCode(/\{\s*d\s*:[^}]*inMonth\s*:\s*false\s*\}/g), 0);
check('pad cells are built WITH a date', /inMonth:false,\s*date:_cellKey\(/.test(src), true);
// INVARIANT: cell content keys off the date, not off inMonth (which is styling only).
check('the plan chip is gated on the date, not the month', /var planRaw=\(c\.date &&/.test(src), true);
check('the week rollup counts all seven days', /wk\.forEach\(function\(c\)\{ if\(c\.date\)\{/.test(src), true);
// INVARIANT: a click target resolves to the activity that was CLICKED. Baking one handle onto the
// day cell (rideRefOf_(dl[0])) meant every card in a multi-activity day opened the first one —
// Jul 31 rendered "Weight Training" + "Zwift Threshold" and both opened the Weight Training —
// and the 3rd+ activity behind "+N more" had no route to its detail view at all.
check('no calendar cell bakes in the first activity as its handle',
  countCode(/data-idx="'\+rideRefData_\(idx\)\+'"'\):''\)\+' style="min-height/g)
  + countCode(/var idx=dl\.length\?rideRefOf_\(dl\[0\]\):-1;/g), 0);
check('activity cards carry their own handle', countCode(/data-cal="act" data-idx="'\+rideRefData_\(/g) >= 3, true);
check('"+N more" is a click target, not dead text', /data-cal="more" data-date="'\+c\.date\+'"/.test(src), true);
// BEHAVIOUR: the day-level click resolves by date and offers every activity, rather than guessing.
check('the cell branch resolves the day from ridesByDate', /a==='cell'\|\|a==='more'/.test(src), true);
check('a multi-activity day opens a picker', /if\(dayl\.length>1\)\{ calDayPick_\(dt,dayl\); \}/.test(src), true);
check('the picker lists every activity, not the first two', /list\.forEach\(function\(r,i\)\{/.test(src), true);

// ── 4. COUNTS / TSS / DISTANCE TOTALS ─────────────────────────────────────────────────────────
console.log('\n'+C+'=== 4. one TSS per ride, and totals that exclude what they cannot use ==='+X);
// INVARIANT: nothing sums the raw field. 43 live rides carry corrupt values up to 907,732.
check('no raw (r.tss||0) anywhere', countCode(/\(r\.tss\s*\|\|\s*0\)/g), 0);
// BEHAVIOUR: the guard is RATE-based. A flat 600 ceiling rejected a real 699 century.
const T = new Function(asServed('var _TSS_MAX_PER_HOUR=200,_TSS_SHORT_FLOOR=60,_TSS_NO_DURATION_MAX=600;'+ex('_durSec_')+ex('constRideTSS_')) + ';return constRideTSS_;')();
const ride=(tss,secs)=>({tss:tss, movingSecs:secs});
check('keeps a real 699 over 6h49m (the Holland 100)', T(ride(699, 24588)), 699);
check('keeps a real 642 over 4h47m',                   T(ride(642, 17208)), 642);
check('rejects 907,732 over 6h17m',                    T(ride(907732, 22612)), null);
check('rejects 685 in 48 minutes',                     T(ride(685, 2880)), null);
check('rejects 811 in 3 minutes',                      T(ride(811, 173)), null);
check('a short hard effort is not rejected for brevity', T(ride(45, 600)), 45);
check('no duration -> falls back to the flat ceiling',  T({tss:700}), null);
check('absent tss -> null, not 0',                      T({}), null);
// BEHAVIOUR: a total EXCLUDES what it cannot use and says how many it dropped, so a short total
// is never passed off as complete.
const ROLL = new Function('st', asServed(
  'var _TSS_MAX_PER_HOUR=200,_TSS_SHORT_FLOOR=60,_TSS_NO_DURATION_MAX=600;'
  + ex('_durSec_') + ex('constRideTSS_') + ex('actSecs_') + ex('rideSport_') + ex('calSportBucket_') + ex('_actElevGain_') + ex('calRollup_')
) + ';return calRollup_;')({});
const roll = ROLL([ {tss:100, distance:20, movingSecs:3600, sportType:'Ride'},
                    {tss:907732, distance:60, movingSecs:22612, sportType:'Ride'},
                    {tss:699, distance:101, movingSecs:24588, sportType:'Ride'} ]);
check('a corrupt ride contributes nothing to the total', roll.tss, 799);
check('...and its distance is still counted', roll.miles, 181);
check('...and it is reported as unscored', roll.tssUnknown, 1);
check('a clean set reports none unscored', ROLL([{tss:50, distance:10, movingSecs:1800, sportType:'Ride'}]).tssUnknown, 0);

// ── 5. HONEST FAILURE ─────────────────────────────────────────────────────────────────────────
console.log('\n'+C+'=== 5. an em-dash, never a plausible number ==='+X);
check('unknown W/kg renders an em-dash', wNone.wkgStr_(wNone.wkgFromW_(183)), '—');
check('known W/kg renders the number',   wSet.wkgStr_(wSet.wkgFromW_(183)), '2.54');
check('NaN also renders an em-dash',     wSet.wkgStr_(NaN), '—');
// INVARIANT: no .toFixed on a value that is now nullable by design — each of these shipped a crash.
// UNGUARDED means the line calls .toFixed on the identifier without also null-checking it. A
// guarded ternary on the same line is the fix, not a violation — four of these shipped as crashes
// (the dashboard tile, the Analytics goal row, dsShowDashboard's :0 default, the Weight goal row).
const NULLABLE = ['BWT','bwt','wkgNow','lastWt','wkg'];
const unguarded = [];
codeLines.forEach((L,i)=>{ NULLABLE.forEach(id=>{
  const re = new RegExp('(?<![.\\w])'+id+'\\.toFixed\\(');
  const guard = new RegExp('(?<![.\\w])'+id+'\\s*==\\s*null|(?<![.\\w])'+id+'\\s*!=\\s*null|(?<![.\\w])'+id+'\\s*\\?');
  if(re.test(L) && !guard.test(L)) unguarded.push(id+' @ line '+(i+1));
}); });
check('no unguarded .toFixed on a nullable weight/wkg', unguarded, []);
// INVARIANT: no window export wraps a call to its OWN name. This file is a classic script, so a
// top-level `function f(){}` IS window.f; `window.f = function(){ return f(); }` replaces that
// binding and the bare f inside resolves to the wrapper — unbounded recursion, RangeError on the
// first click, thrown before the real body runs. It shipped twice: the Zwift folder picker did
// nothing, and the Coach V .zwo button was silently broken the same way.
// Scanned over the comment-stripped source: the note above spells the broken form out on purpose,
// and a check that flagged its own documentation would be noise.
const selfWrap = [...codeLines.join('\n').matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*function\s*\(([^)]*)\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\s*\(/g)]
  .filter(m => m[1] === m[3]).map(m => m[1]);
check('no window export calls its own name (infinite recursion)', selfWrap, []);
// INVARIANT: every Athlete Intelligence tab degrades to its own error, not the whole page.
// Checked on the RETURNED EXPRESSION, not the line. A line-wide search passes a bare dispatch as
// long as something later on the same line happens to mention _aiSafe_ — which a mutation test
// caught this assertion doing.
const dispatches = [...src.matchAll(/if\(tab==='([a-z]+)'\)\s*return\s+([A-Za-z_$][\w$]*)/g)]
  .map(m => ({tab:m[1], callee:m[2]}));
check('every AI tab dispatch exists', dispatches.length>0, true);
check('every AI tab dispatch returns _aiSafe_ FIRST',
      dispatches.filter(d => d.callee !== '_aiSafe_').map(d => d.tab+' -> '+d.callee), []);
// INVARIANT (F7c): each surface names the library it counted, because the two legitimately differ.
// INVARIANT: no surface grades a ride on one flat curve off whole-ride IF/TSS. That formula ignores
// what the session was FOR — a recovery spin and a 4x4 VO2 came off the same curve. Execution is
// graded against the session's own targets by computeExecutionScore_, or not at all.
check('no flat whole-ride grade anywhere', countCode(/\(ifVal-0\.75\)\*40/g), 0);
check('execution is still graded against the session targets', /function computeExecutionScore_/.test(src), true);
// BEHAVIOUR: when one-click send is unavailable the athlete is told WHY, not just handed a path.
// The unsupported branch REPLACES the set-up link, so the explanation inside zwiftPickFolder_ is
// unreachable — it has to be stated here or nowhere.
check('the unsupported-browser note names the browsers that work', /One-click send needs Chrome or Edge on the desktop/.test(src), true);
check('...and still gives the manual path', /Download it and drop it in '\+_zwiftPathHint_\(\)/.test(src), true);
check('the calendar names its data source', /dataSourceNote_\('legacy'\)/.test(src), true);
check('Athlete Intelligence names its data source', /dataSourceNote_\('deduped'\)/.test(src), true);
check('and the note distinguishes the two libraries', /Rides only, from the uploaded snapshot/.test(src) && /All activity types, from your device library/.test(src), true);

// ── 6. .zwo EXPORT: an interval session must never flatten ────────────────────────────────────
console.log('\n'+C+'=== 6. a VO2/Threshold export is a STRUCTURE, or it is nothing ==='+X);
// The failure this guards shipped and was caught in Zwift, not here: a VO2 with no resolvable
// struct exported as ONE 45-minute block at the band midpoint — which for VO2 is 100% of FTP.
// Zwift rendered it as Z4 100%, a completely different and far harder session than prescribed.
const ZWO = new Function('st', asServed(
  'var _ZWO_WARM_SEC=600,_ZWO_COOL_SEC=300,_ZWO_REC_PWR=0.55;'
 +'var _ZWO_INTERVAL_INTENTS={vo2:1,threshold:1};'
 +'var SESSION_DEFS={vo2:{type:"ride",name:"VO2",durationMin:45},threshold:{type:"ride",name:"Threshold",durationMin:60},z2:{type:"ride",name:"Z2",durationMin:90}};'
 +ex('_zwoEsc_')+ex('_zwoPwr_')+ex('_structIntervals_')+ex('_zwoSession_')+ex('_zwoStructFor_')+ex('_zwoFor_'))
 +';return {_zwoFor_,_structIntervals_,_zwoStructFor_};')({ftp:183});
const mk=(intent,struct)=>({type:'ride', intent:intent, name:intent,
  targets:{powerLo:174, powerHi:192, ftp:183, durationMin:45}, block:(struct?{struct:struct}:null)});
const kinds=(z)=>{ if(!z) return null; const m=z.xml.match(/<(Warmup|SteadyState|IntervalsT|Cooldown)/g)||[]; return m.map(x=>x.slice(1)); };
const vo2ok = ZWO._zwoFor_(mk('vo2','4x4 min, 3 min recovery, flat'),'2026-08-04');
check('VO2 with a struct exports Warmup+IntervalsT+Cooldown', kinds(vo2ok), ['Warmup','IntervalsT','Cooldown']);
const thrOk = ZWO._zwoFor_(mk('threshold','2x20 min'),'2026-08-07');
check('Threshold with a struct exports discrete blocks', kinds(thrOk), ['Warmup','SteadyState','SteadyState','SteadyState','Cooldown']);
// THE BUG: no struct on the session at all. Without a block to fall back on it must REFUSE.
const vo2NoStruct = ZWO._zwoFor_(mk('vo2',''),'2026-08-02');
check('VO2 with NO resolvable structure refuses (never a flat block)', vo2NoStruct, null);
const thrNoStruct = ZWO._zwoFor_(mk('threshold',''),'2026-08-02');
check('Threshold with NO resolvable structure refuses', thrNoStruct, null);
// and a continuous intent is still allowed to be one block
const z2 = ZWO._zwoFor_(mk('z2',''),'2026-08-03');
check('a continuous Z2 still exports one steady block', kinds(z2), ['SteadyState']);
// belt and braces: no interval export may ever be a lone SteadyState
[['vo2','4x4 min, 3 min recovery, flat'],['threshold','2x20 min'],['vo2',''],['threshold','']].forEach(([i,s])=>{
  const z=ZWO._zwoFor_(mk(i,s),'2026-08-04'); const k=kinds(z);
  check('   '+i+' ('+(s||'no struct')+') is never a single flat block', !(k && k.length===1 && k[0]==='SteadyState'), true);
});

// ── 7. A SESSION IS GRADED ON THE WORK IT PRESCRIBED ──────────────────────────────────────────
console.log('\n'+C+'=== 7. the weekly checks grade work intervals, not whole-ride averages ==='+X);
// INVARIANT: identity ("was this the session?") and grading ("was it executed?") read the SAME
// laps. Two matchers would eventually disagree about one ride and nothing would surface it.
check('one lap matcher, shared', /function _blockLapPowers_/.test(src)
  && /function _blockLapsHit_\(r, struct, targets\)\{\s*var lp=_blockLapPowers_/.test(src.replace(/\n/g,'')), true);
check('the weekly checks consult the interval measurement', countCode(/_blockWorkMeasure_\(/g) >= 1, true);
check('VO2 no longer grades on route elevation as its primary test',
  /cond:vo2M\?\('work intervals reaching '\+vo2M\.lo\+'W'\)/.test(src), true);
check('threshold grades the intervals against the band', /cond:thrM\?\('work intervals in the '/.test(src), true);
// INVARIANT: the degrade is LABELLED. Falling back to a whole-ride average is allowed; passing it
// off as an interval measurement is not.
check('the whole-ride fallback names itself in the UI string', countCode(/whole ride - (no interval data|continuous prescription)/g), 2);
check('the elevation fallback names itself too', /elevation proxy - no interval data/.test(src), true);
// INVARIANT: the miss copy is computed, not asserted. Interval grading fails BELOW a floor; the
// old row said "over the cap" unconditionally.
check('no hardcoded "over the cap" verdict', countCode(/— over the cap/g), 0);
check('the row states the reason the check computed', /\(c\.miss\|\|'outside the prescription'\)/.test(src), true);

// INVARIANT: the LLM path gets the same treatment as the rule-based one. The coach prompt used to
// receive only the whole-ride average, so a 2x20 whose work laps ran 167/166W inside a 156-174W band
// was reported to the model as 140.8W and came back "Threshold Target Missed". Same dilution,
// different path.
// INVARIANT: a session the athlete CLAIMED overrides the block template. blockPlanFor_ read the
// template only — p.dates[] is written nowhere but the block definition — so every user swap was
// invisible to _ridePrescriptionFor_ and the coach graded the ride that was replaced.
check('blockPlanFor_ honours a user-owned session', /_claimed\(s\)/.test(src), true);
// INVARIANT: ownership is read from the EDIT MASK, not from `source`. source is metadata and is not
// a masked field, so a cross-device merge lets the remote 'gen' copy win — the Aug 1 swap came back
// stamped source:'gen' with _edited:{intent,...} intact, and gating on source alone silently
// reverted it: st.plan said 'fuhgeddaboudit' while the coach graded the group ride.
// Two weaker gates were tried and both were wrong: source is metadata that a merge overwrites, and
// the _edited mask is residue on most sessions — it overrode 24 of 41 block days and turned Jul 31's
// prescribed Threshold into a Z2. Only an explicit, purpose-built flag can mean "the athlete chose
// this", and it must be in the edited-field list so a merge cannot drop it.
check('...via an explicit swap flag, not inferred metadata', /s\.swap===true/.test(src), true);
check('the swap writes that flag', /intent:defKey, name:def\.name, swap:true/.test(src), true);
check('...and protects it through a merge', /\['type','intent','name','status','swap'\]/.test(src), true);
check('ownership is NOT inferred from the edit mask', countCode(/s\._edited && s\._edited\.intent/g), 0);
check('...and the override is scoped to ride/attempt intents',
  /d2\.type==='ride'\|\|d2\.type==='attempt'/.test(src), true);
check('...and reports that it came from the athlete, not the template', /via='user'/.test(src), true);
// INVARIANT: every coach surface speaks as Dr. Smurkel, in second person, and none of them asserts
// a missing elevation as zero. (r.elev||0) is the construct that made the model report "flat
// terrain, zero elevation gain" on a trail run that climbed 37ft.
// INVARIANT: Ask Coach gets history AND keeps the anti-fabrication rules. _smurkelFacts_ is facts
// only — it contains no rules — so swapping the telemetry block for it would silently drop "never
// substitute zero", the terrain rule and the sport-naming rule, which are exactly what produced the
// honest "the data here cannot tell me why" answer instead of an invented comparison.
// INVARIANT: the ride-detail Weather panel does not fabricate. It used to fetch LIVE current
// conditions at the ride's coordinates for EVERY ride — right only by accident for today's, and
// wrong two ways otherwise: an indoor ride has no real coordinates, and a past ride got today's
// weather at its own location.
// ── CALENDAR YEAR VIEW ────────────────────────────────────────────────────────────────────────
// INVARIANT: the year aggregate is built off the SAME ridesByDate map every other Calendar view
// reads, so a month chapter can never disagree with the week/month totals for the same days.
// INVARIANT: the year/favourite helpers are TOP-LEVEL. They were first inserted against an anchor
// that turned out to be indented INSIDE dsShowCalendar, so calYearHTML_ worked from within that one
// function while openDesktopRideDetail could not see favStarHTML_ and the mobile year panel could
// not see calYearHTML_ — a scoping bug that renders as a silently missing control, not an error.
// Column 0 does NOT mean top-level: the original bug had every one of these written at column 0
// while lexically inside dsShowCalendar, which is invisible to a grep and to an indentation check.
// What actually distinguishes them is POSITION — a helper that other surfaces call has to be
// defined before dsShowCalendar opens, not somewhere within it.
const srcLines = src.split(String.fromCharCode(10));
const lineOf = (needle) => srcLines.findIndex(L => L.startsWith(needle));
const calStart = lineOf('function dsShowCalendar(');
// INVARIANT: ONE momentum computation. Two that can disagree is the taperVerdict_-class bug.
// INVARIANT: ONE consistency number. The Coach Grade and the month stats ring must not disagree.
// INVARIANT: ONE initials computation. The sidebar derived them live from st.profile.name while
// the Settings card shipped a static "MR" that nothing recomputed, so "Mikey" rendered as M in one
// slot and MR in the other — the same fact with two answers.
check('there is exactly one initials helper', countCode(/function _profileInitials_/g), 1);
check('no static MR default is left to disagree',
  codeLines.filter(L => L.indexOf('data-fallback-initials="MR"') >= 0).length, 0);
check('Settings derives its fallback from the shared helper',
  src.indexOf('data-fallback-initials="' + "'+((typeof _profileInitials_") > 0, true);
check('there is exactly one consistency helper', countCode(/function _monthConsistency_/g), 1);
check('the month stats strip reads it', /var _mc=_monthConsistency_\(viewYear, viewMonth/.test(src), true);
// INVARIANT: the Coach Grade formula is STATED and its weights live in one place.
check('the grade weights are declared once', countCode(/var _CG_W=/g), 1);
check('the letter mapping is stated, no curve', /s>=90\?.A.:s>=80\?.B.:s>=70\?.C.:s>=60\?.D.:.F./.test(src), true);
check('the breakdown is tappable', src.indexOf('data-cal="cgrade"') > 0, true);
check('a component with no data is dropped, not zeroed', /partial:\(wSum</.test(src), true);
check('...and a partial grade says so', /Weighted over the components that had data/.test(src), true);
check('moving AWAY from a goal scores below neutral', /if\(moved<=0\) return Math\.max\(0, 0\.5\+moved\*2\)/.test(src), true);
check('execution-adherence grades via _blockWeekAssess_', /var a=_blockWeekAssess_\(all, ftp, mid\)/.test(src), true);
// INVARIANT: you cannot fail to execute a plan that did not exist. _blockWeekAssess_ grades ANY
// week (it classifies by ratio with no prescription on file), so March 2026 scored exec 0% against
// a block that did not open until Jul 24 and the month graded F.
check('weeks the block does not cover are not graded', /if\(!_cov\) continue;/.test(src), true);
check('there is exactly one momentum verdict', countCode(/function _momentumVerdict_/g), 1);
check('the AI card reads it rather than recomputing', countCode(/ramp>=2\?\[.Improving./g), 0);
// INVARIANT: every highlight is computed or explicitly absent, and an absent one is not clickable.
check('highlights fall back to an em-dash', countCode(/val:'&mdash;'/g) >= 4, true);
check('an absent highlight has no month to open', /clickable=!!h\.ym/.test(src), true);
// INVARIANT: the year insight reuses the shared persona and prompt-hash cache.
check('the year insight speaks as Dr. Smurkel', /var prompt=_SM_PERSONA\+NL\+NL[\s\S]{0,400}athlete year to date/.test(src), true);
check('...and is cached like the others', /var key=_ciHash_\(prompt\), hit=_ciGet_\(key\)/.test(src), true);
check('...and is told a future month is not an empty month', /never treat a month that has not started/.test(src), true);
// INVARIANT: This Week reuses weekLoadMonSun_, not a second week sum.
check('This Week reads weekLoadMonSun_', /wl=\(typeof weekLoadMonSun_==='function'\)/.test(src), true);
check('dsShowCalendar is found', calStart > 0, true);
check('the shared calendar helpers are defined OUTSIDE dsShowCalendar',
  ['calYearHTML_','_favKey_','favStarHTML_','_calByDate_','_yearMonthAgg_','_chapterLabel_']
    .filter(n => { const at = lineOf('function ' + n + '('); return at < 0 || at > calStart; }), []);
check('ONE date-bucket builder for both calendar surfaces', countCode(/function _calByDate_/g), 1);
check('mobile mounts the SAME year renderer as desktop', /yearPanel\.innerHTML=calYearHTML_\(calYear/.test(src), true);
check('the old independent mobile year aggregator is gone', countCode(/var maxMi=Math\.max\.apply\(null,moMiles\)/g), 0);
check('the star renders on BOTH detail surfaces', countCode(/favStarHTML_\(r,'(ds|mb)-fav-star'\)/g), 2);
check('...and is wired on both', countCode(/favStarWire_\(r,'(ds|mb)-fav-star'\)/g), 2);
// INVARIANT: the Year view keeps reading the DEVICE library. Two dry runs established that
// swapping to the snapshot breaks TSS coverage (48 of 130 records) so chapter labels and day bars
// would be computed from nothing, and that unioning the two inflates 16% over Strava. The page
// states the shortfall instead of silently under-reporting OR silently over-reporting.
check('the year aggregate still reads the device library', /calYearHTML_\(viewYear, ridesByDate, now\)/.test(src), true);
check('the snapshot total is comparison-only', countCode(/_yearSnapshotTotal_\(/g) >= 1, true);
check('...and is never fed to the aggregate', countCode(/_yearMonthAgg_\([^)]*_yearSnapshotTotal_/g), 0);
check('the shortfall is stated on the page', /sits in rides that exist only there/.test(src), true);
check('the year view reads the shared ridesByDate map', /calYearHTML_\(viewYear, ridesByDate, now\)/.test(src), true);
check('there is exactly ONE month aggregator', countCode(/function _yearMonthAgg_/g), 1);
check('year totals are summed from that same aggregate', /agg\.forEach\(function\(e\)\{ tSecs\+=e\.secs/.test(src), true);
// INVARIANT: the chapter label is DERIVED or absent — never a canned rotation of adjectives, and
// never a plausible word the data cannot support.
check('every chapter label carries the evidence for itself', countCode(/text:'[A-Za-z ]+', planned:(false|true), why:/g) >= 6, true);
check('a month with nothing logged gets no label', /if\(!e\.acts\) return null;/.test(src), true);
check('too little history to compare -> says so, not a label', /Not enough months logged this year to compare against yet/.test(src), true);
// INVARIANT: an uncomputable stat is an em-dash, never a plausible number.
check('PR count degrades to an em-dash', /prCount=null/.test(src) && /dash\(prCount\)/.test(src), true);
// INVARIANT: ONE favourite mechanism for rides AND runs.
check('one favourite key builder', countCode(/function _favKey_/g), 1);
check('...used by both the ride and run paths via one toggle', countCode(/function _favToggle_/g), 1);
check('un-starring writes false rather than deleting (merge-safe)', /m\[k\]=\(m\[k\]===true\)\?false:true/.test(src), true);
check('an indoor ride is not given outdoor conditions', /_wxIndoor=\(typeof rideIsIndoor==='function'\)&&rideIsIndoor\(r\)/.test(src), true);
check('a past ride reads the ARCHIVE, not the forecast', /archive-api\.open-meteo\.com\/v1\/archive\?latitude/.test(src), true);
check('...for the ride date, not today', /start_date='\+_wxRideDate/.test(src), true);
check('...at the ride start hour, not a day average', /sh=Math\.min\(sh, h\.temperature_2m\.length-1\)/.test(src), true);
check('the live forecast is used ONLY for today', /if\(_wxIsToday\)\{/.test(src), true);
check('Ask Coach gets an honest weather fact', /var wxFact=_rideWeatherFact_\(r\)/.test(src), true);
check('...with no live-weather fallback for a past ride', countCode(/_rideWeatherFact_[\s\S]{0,400}api\.open-meteo/g), 0);
check('Ask Coach is given week/fitness context', /weekFacts=_smurkelFacts_\(_smurkelContext_\(dk, r\)\)/.test(src), true);
check('...and similar past rides to compare against', /var histFacts=_rideHistoryComparisons_\(r\)/.test(src), true);
check('...and STILL carries the anti-fabrication rules', /\+histFacts\+NL\s*\+T\.FACTS\+NL/.test(src), true);
check('the history helper excludes the current ride by reference', /ride!==r && !ride\.deleted/.test(src), true);
check('no coach prompt claims a separate analyst voice', countCode(/You are a cycling data analyst/g), 0);
check('the Analytics tab speaks as Dr. Smurkel', /var prompt = _SM_PERSONA/.test(src), true);
check('...in second person', /never third person/.test(src), true);
check('no prompt asserts a missing elevation as zero', countCode(/elevation '\+\(r\.elev\|\|0\)/g), 0);
check('the honest elevation helper is used instead', /elevation '\+_smElev_\(r\)/.test(src), true);
// INVARIANT: a completed ride's analysis settles, like the other two coach calls.
check('the Analytics insight is cached on its prompt', /var _anKey=_ciHash_\(prompt\)/.test(src), true);
check('the coach prompt measures the work intervals', /_blockWorkMeasure_\(r, _dk, _wi\[_i\]\)/.test(src), true);
check('...and tells the model the whole-ride average is not the prescribed effort',
  /The whole-ride average above INCLUDES warm-up, recoveries and cool-down/.test(src), true);
check('...and names where the measurement came from', /the device laps.*the power stream/.test(src), true);
// INVARIANT: a colour handed to a helper as an ARGUMENT still has to be themeable. statCell renders
// color:'+color+', so a literal '#fff' at the call site was invisible to every hex->var sweep and
// left four blank cells on a white card.
check('no bare white passed into statCell', countCode(/statCell\([^)]*,'#(fff|ffffff)'/gi), 0);
// Line-based: a statCell argument list can contain its own parens (parseFloat(...), an IIFE), so a
// [^)]* character class stops short and undercounts.
check('the ride-detail stat row is themed',
  codeLines.filter(L => /statCell\(.*var\(--d-t1\)/.test(L)).length >= 4, true);

// BEHAVIOUR: the grading rule itself.
const BLK = new Function(asServed(ex('_blockWorkHit_')+ex('_blockWorkMean_'))
  +';return {_blockWorkHit_,_blockWorkMean_};')();
const m = (vals, lo, hi) => ({ vals, lo, hi, n: vals.length });
// The real Jul 23 2026 VO2 ride: 185/214/169/206W against a 174-192W band. Only ONE interval is
// strictly inside the band, but three reach the floor — that is the session, executed.
check('a VO2 set that reaches the floor 3 of 4 times passes', BLK._blockWorkHit_(m([185,214,169,206],174,192)) >= 0.5, true);
check('   ...and going OVER the top is not counted as a miss', BLK._blockWorkHit_(m([214,206,199,205],174,192)), 1);
check('a set that never reaches the floor fails', BLK._blockWorkHit_(m([140,151,138,144],174,192)) >= 0.5, false);
check('exactly half reaching the floor is a pass', BLK._blockWorkHit_(m([180,120,190,130],174,192)), 0.5);
// Threshold keeps the "without overreaching" half: the intervals must not AVERAGE above the top.
check('threshold intervals ridden at VO2 watts average over the ceiling',
  BLK._blockWorkMean_(m([200,207,200],162,181)) > 181, true);
check('threshold intervals inside the band do not', BLK._blockWorkMean_(m([168,175,171],162,181)) <= 181, true);
check('an empty measurement is 0, never a pass', BLK._blockWorkHit_(m([],174,192)), 0);
check('a null measurement is 0, never a pass', BLK._blockWorkHit_(null), 0);
check('mean of nothing is null, not 0', BLK._blockWorkMean_(m([],174,192)), null);

// BEHAVIOUR: the lap matcher must not count RECOVERY laps as work. The duration tolerance is wide
// (max(45, workSec*0.35) = 84s for a 4 min interval) and a 3 min recovery sits inside it. Counting
// hits upward hid this; a hit RATIO divides by the count, so it turned a clean session into a miss.
const LAP = new Function(asServed(ex('_structIntervals_')+ex('_blockLapPowers_')+ex('_blockLapsHit_'))
  +';return {_blockLapPowers_,_blockLapsHit_};')();
// The real Jul 28 2026 VO2 ride, verbatim: warm-up, 4x4 at 200-207W with 3 min recoveries, cool-down.
const jul28 = [[601,97],[240,200],[180,106],[240,200],[180,108],[240,207],[180,103],[240,200],[180,100],[300,83]]
  .map(([time, avgPwr]) => ({ time, avgPwr }));
const VO2T = { powerLo:174, powerHi:192 };
const got = LAP._blockLapPowers_({ laps: jul28 }, '4x4 min, 3 min recovery, flat', VO2T);
check('a 4x4 yields FOUR work intervals, not nine', got.vals.length, 4);
check('   ...and they are the work laps, in order', got.vals, [200,200,207,200]);
check('   ...so the hit ratio is 1.0, not 0.44', BLK._blockWorkHit_({vals:got.vals, lo:VO2T.powerLo}), 1);
check('   ...and identity still confirms the session', LAP._blockLapsHit_({ laps: jul28 }, '4x4 min, 3 min recovery, flat', VO2T), true);
// A struct with no stated recovery falls back to "keep the hardest n"
const noRec = LAP._blockLapPowers_({ laps: jul28 }, '4x4 min', VO2T);
check('no stated recovery still yields n intervals', noRec.vals.length, 4);
check('   ...the hardest ones', noRec.vals, [200,200,207,200]);
// A genuinely missed session must still be able to fail
const soft = [[601,97],[240,150],[180,100],[240,148],[180,102],[240,151],[180,99],[240,149],[180,101],[300,83]]
  .map(([time, avgPwr]) => ({ time, avgPwr }));
const softV = LAP._blockLapPowers_({ laps: soft }, '4x4 min, 3 min recovery, flat', VO2T);
check('a session ridden 25W under the floor still fails', BLK._blockWorkHit_({vals:softV.vals, lo:VO2T.powerLo}) >= 0.5, false);
check('   ...on four intervals, so the failure is about watts not counting', softV.vals.length, 4);

console.log('');
if(fails){ console.log(R+'cross-surface: '+fails+' check(s) failed'+X); process.exit(1); }
console.log(G+'cross-surface: all checks passed'+X);
