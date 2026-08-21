// THE PROSE AND THE GRADE MUST QUOTE THE SAME BAND.
//
// The Aug 18 fix taught the GRADING path to prefer the band stamped onto the .zwo the athlete was
// actually given - "the file he was given outranks the plan he was not". It stopped there. The
// resolver that prices the PROSE, _sessionRxFor_, kept re-deriving the band from ftpOn_(date), and
// _sessionRxFor_ is what feeds Dr. Smurkel's "prescribed NNN-NNN W" sentence, Today's Plan and the
// editor prefill. So the two disagreed on exactly the days a file had been issued and FTP had since
// moved - the grader forgiving the ride, the text still accusing it.
//
// Measured on 2026-08-18 ("Zwift - VO2 Work"). SESSION_DEFS.vo2 is pctFtp [110,120]:
//
//   the file, exported while FTP was 183   ->  201-220W   (stamped as '201-220@183')
//   the prose, priced off ftpOn_(08-18)=190 ->  209-228W
//
// Both numbers were correct about their own question. Only one of them was about the workout the
// athlete actually rode. Note what is NOT the fix: ftpOn_ is right, ftpHistory is right (190 ran
// 08-02..08-19, verified in the log), and st.ftp vs ftpHistory is a deliberate split, not a missing
// single-source. Collapsing those re-breaks the date-blind grading that 611f540 fixed. The stamp is
// a narrower fact than FTP - what THIS day's file commands in ERG - and it is the only thing added.
//
// Run: node scripts/rx-stamp-prose-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== the day resolver consults the stamp ===' + X);
ok('_sessionRxFor_ asks for the stamp', /_stamp=_stampedRxFor_\(dk, ?pick\.intent\)/.test(SRC));
ok('...on the NORMALISED date, not the raw argument', /_stampedRxFor_\(dk,/.test(SRC) && !/_stampedRxFor_\(dateKey, ?pick\.intent\)/.test(SRC));
ok('...for the intent that was actually adjudicated', /_stampedRxFor_\(dk, ?pick\.intent\)/.test(SRC));
ok('...guarded, so a missing helper cannot throw the whole prescription away', /typeof _stampedRxFor_==='function'/.test(SRC));
ok('the stamp overrides both edges of the band', /if\(_stamp\)\{ ?t\.powerLo=_stamp\.lo; ?t\.powerHi=_stamp\.hi; ?\}/.test(SRC));
ok('the stamp is disclosed on the result, not applied invisibly', /stampedRx:\(_stamp\?\{ ?lo:_stamp\.lo, ?hi:_stamp\.hi, ?ftp:_stamp\.ftp ?\}:null\)/.test(SRC));

console.log('\n' + Y + '=== it is applied where it cannot be undone ===' + X);
{
  // Order is the whole correctness argument. The stamp must land AFTER the derived/plan targets
  // merge - applied before it, pick.targets would overwrite it and the bug would survive the fix -
  // and BEFORE the return that reads t.powerLo. A future edit that moves either boundary breaks it
  // silently, because the band would still be A band and no test of the value alone would notice.
  const iMerge = SRC.indexOf('if(pick.targets) Object.keys(pick.targets)');
  const iStamp = SRC.indexOf('_stamp=_stampedRxFor_(dk, pick.intent)');
  const iRet   = SRC.indexOf('lo:(isRun?null:t.powerLo)');
  ok('the merge, the stamp and the return are all present', iMerge > 0 && iStamp > 0 && iRet > 0);
  ok('the stamp is applied AFTER the plan/def targets merge', iStamp > iMerge);
  ok('...and BEFORE the band is read out', iStamp < iRet);
}
ok('a run never reaches the stamp, having no watts to override', /if\(!isRun && typeof _stampedRxFor_/.test(SRC));
ok('...and watts are still suppressed for runs at the return', /lo:\(isRun\?null:t\.powerLo\), ?hi:\(isRun\?null:t\.powerHi\)/.test(SRC));

console.log('\n' + Y + '=== the paths that already worked still do ===' + X);
ok('NEG: the grading path keeps its own stamp adjudication', /t2\.powerLo=_sr\.lo; ?t2\.powerHi=_sr\.hi/.test(SRC));
ok('NEG: ftpOn_ still prices the derived band - no FTP consolidation crept in', /ftp=parseInt\(ftpOn_\(dateKey\),10\)\|\|0/.test(SRC));
ok('NEG: the debrief still reads FTP from the dated log, not the current scalar', /var ftp=\(typeof ftpOn_==='function'\)\?_smNum_\(ftpOn_\(dateKey\)\)/.test(SRC));
ok('NEG: the intent adjudication still runs before the precedence ladder', SRC.indexOf('_was=_blockSessionOf_(ride') < SRC.indexOf("if(pln && (plnDone || !tpl)){ pick=pln;"));
ok('NEG: the stamp writer is unchanged - lo-hi@ftp', /var want=String\(z\.intent\), ?stamp=z\.lo\+'-'\+z\.hi\+'@'\+z\.ftp/.test(SRC));

console.log('\n' + Y + '=== the real parser, exercised ===' + X);
{
  // _stampedRxFor_ lifted out of the served source and run for real, rather than re-modelled - it is
  // a hand-rolled string parser written to dodge the template's backslash-eating, so the parse is
  // exactly the part worth testing against the genuine bytes.
  const start = src.indexOf('function _stampedRxFor_(');
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const fnText = src.slice(start, end);
  let sessions = [];
  const planSessionsForDate_ = () => sessions;
  const _stampedRxFor_ = new Function('planSessionsForDate_', fnText + '; return _stampedRxFor_;')(planSessionsForDate_);

  sessions = [{ intent:'vo2', zwoRx:'201-220@183' }];
  const hit = _stampedRxFor_('2026-08-18', 'vo2');
  ok('the Aug 18 stamp parses', !!hit);
  ok('...to the file band 201-220W', hit && hit.lo === 201 && hit.hi === 220);
  ok('...carrying the FTP the file was built at (183)', hit && hit.ftp === 183);

  ok('NEG: a day with no exported file returns null, not a band', (sessions = [{ intent:'vo2' }], _stampedRxFor_('2026-08-18','vo2') === null));
  ok('NEG: a different intent on the same day does not match', (sessions = [{ intent:'vo2', zwoRx:'201-220@183' }], _stampedRxFor_('2026-08-18','threshold') === null));
  ok('NEG: a deleted row is ignored', (sessions = [{ intent:'vo2', zwoRx:'201-220@183', deleted:true }], _stampedRxFor_('2026-08-18','vo2') === null));
  ok('NEG: a malformed stamp is refused rather than half-read', (sessions = [{ intent:'vo2', zwoRx:'201220183' }], _stampedRxFor_('2026-08-18','vo2') === null));
  ok('NEG: an inverted band is refused', (sessions = [{ intent:'vo2', zwoRx:'220-201@183' }], _stampedRxFor_('2026-08-18','vo2') === null));
  ok('NEG: no date and no intent are both refused', _stampedRxFor_('', 'vo2') === null && _stampedRxFor_('2026-08-18','') === null);
}

console.log('\n' + Y + '=== the reported session, end to end ===' + X);
{
  // The resolver band as it reaches the prose: derived from the date, then overridden by the stamp.
  const VO2 = [110, 120];
  const log = [{date:'2026-08-02', ftp:190}, {date:'2026-08-19', ftp:183}];
  const ftpOn = (d) => { const s = log.slice().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
    let e = null; for (const x of s) { if (x.date <= d) e = x; else break; } return e ? e.ftp : s[0].ftp; };
  const resolve = (d, stamp, isRun) => {
    const f = ftpOn(d);
    const t = { powerLo: Math.round(f*VO2[0]/100), powerHi: Math.round(f*VO2[1]/100) };
    if (!isRun && stamp) { t.powerLo = stamp.lo; t.powerHi = stamp.hi; }
    return { lo: isRun ? null : t.powerLo, hi: isRun ? null : t.powerHi };
  };
  const STAMP = { lo:201, hi:220, ftp:183 };

  ok('the log has 190 in force on the ride date', ftpOn('2026-08-18') === 190);
  const before = resolve('2026-08-18', null, false);
  ok('...so the un-stamped band is the reported 209-228W', before.lo === 209 && before.hi === 228);
  const after = resolve('2026-08-18', STAMP, false);
  ok('with the stamp the prose quotes the file: 201-220W', after.lo === 201 && after.hi === 220);

  // THE HONEST LIMIT. This changes which band the sentence quotes; it does not turn the session into
  // a pass. The three intervals were 195/195/200W - still under a 201W floor, now by 1-6W instead of
  // by 9-14W. The value of the fix is that the athlete is being measured against the workout he was
  // handed, so the shortfall is arguable on its merits rather than on the arithmetic.
  const ridden = [195, 195, 200];
  ok('all three still sit under the file floor - the fix removes the ERROR, not the shortfall',
     ridden.every((v) => v < after.lo));
  ok('...and the worst miss shrinks from 14W to 6W', (before.lo - 195) === 14 && (after.lo - 195) === 6);
  ok('NEG: with no file issued the date-priced band is what survives', resolve('2026-08-18', null, false).lo === 209);
  ok('NEG: a run gets no watts even when a stamp exists', resolve('2026-08-18', STAMP, true).lo === null);
  ok('prescribing today is unmoved: no stamp, current FTP', resolve('2026-08-19', null, false).lo === 201);
}

console.log('');
if (fails) { console.log(R + 'rx stamp prose: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'rx stamp prose: all checks passed' + X + '\n');
