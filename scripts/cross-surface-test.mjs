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
check('the calendar names its data source', /dataSourceNote_\('legacy'\)/.test(src), true);
check('Athlete Intelligence names its data source', /dataSourceNote_\('deduped'\)/.test(src), true);
check('and the note distinguishes the two libraries', /Rides only, from the uploaded snapshot/.test(src) && /All activity types, from your device library/.test(src), true);

console.log('');
if(fails){ console.log(R+'cross-surface: '+fails+' check(s) failed'+X); process.exit(1); }
console.log(G+'cross-surface: all checks passed'+X);
