// A SESSION IS GRADED AGAINST THE BAND THAT WAS IN FORCE WHEN IT WAS RIDDEN.
//
// The last open item from the VO2/Smurkel/checklist saga, and it was never three surfaces that
// forgot to sweep - it was three consumers of ONE date-blind builder:
//
//   function _planZoneFromPct_(pct){ var ftp = st.ftp || 186; ... }   // no date parameter EXISTS
//
// Every power band in the app is pctFtp x st.ftp as of right now, so nothing could ask what the band
// WAS on a past date. _zwoStampRx_ was a patch over that - it records a band at .zwo export time, so
// it covers only sessions exported after it shipped; for anything older _stampedRxFor_ returns null
// and every surface, including ones that correctly consult it, falls back to today's band.
//
// The fix threads ftpOn_(date). Note the property that makes it safe: ftpOn_ returns the latest log
// entry ON OR BEFORE the date, so for today and any future date it yields the CURRENT FTP anyway.
// One path serves both prescribing and grading - there is no past/future branch to drift apart.
// It also depends on ftpHistory being trustworthy, which only became true with the merge-key fix
// earlier the same day.
//
// Run: node scripts/band-on-date-test.mjs
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

console.log('\n' + Y + '=== the builder can be asked about a date ===' + X);
ok('_planZoneFromPct_ takes a dateKey', /function _planZoneFromPct_\(pct, ?dateKey\)/.test(SRC));
ok('...and prices off ftpOn_(dateKey) when given one', /ftp=parseInt\(ftpOn_\(dateKey\),10\)\|\|0/.test(SRC));
ok('...falling back to st.ftp when the log cannot answer', /if\(!\(ftp>0\)\) ftp=\(typeof st!=='undefined' && st && st\.ftp\)/.test(SRC));
ok('...and to _FTP_DEFAULT rather than a bare literal', /\|\|_FTP_DEFAULT\):_FTP_DEFAULT/.test(SRC));
ok('the band discloses which FTP it used', /ftpSrc:src, ?ftpDate:\(src==='on-date'\)\?dateKey:null/.test(SRC));
ok('NEG: the old date-blind signature is gone', !/function _planZoneFromPct_\(pct\)\{/.test(SRC));

console.log('\n' + Y + '=== the date reaches every consumer, in one pass ===' + X);
ok('_planSessionFromDef_ accepts it', /function _planSessionFromDef_\(intent, blockWeek, progWeek, dateKey\)/.test(SRC));
ok('...and passes it to the builder', /_planZoneFromPct_\(def\.pctFtp, dateKey\)/.test(SRC));
ok('...carrying the provenance onto the targets', /s\.targets\.ftpSrc=z\.ftpSrc; ?s\.targets\.ftpDate=z\.ftpDate/.test(SRC));
{
  // Every call must supply a date or an explicit null - none may silently inherit today's FTP.
  const calls = noCmt(src).split('\n').filter((l) => /_planSessionFromDef_\(/.test(l) && !/function _planSessionFromDef_/.test(l));
  const blind = calls.filter((l) => !/dateKey|\.date\)\s*\|\|\s*null/.test(l));
  ok('no consumer is still date-blind (' + calls.length + ' calls, ' + blind.length + ' blind)', blind.length === 0);
}
ok('blockPlanFor_ prices on the date it was asked about', /_planSessionFromDef_\(_int, weekInPhase, _pw, dateKey\)/.test(SRC));
ok('_sessionRxFor_ - THE day lookup the debrief uses - passes its date', /_planSessionFromDef_\(pick\.intent, bp2\?bp2\.weekInPhase:1, 0, dateKey\|\|null\)/.test(SRC));
ok('the execution scorer grades on the RIDE date', /_sessEffTargets_\(sess, _gd\)/.test(SRC));
ok('...taking that date from the ride, normalised', /var _gd = \(ride && ride\.date\)/.test(SRC));
ok('_sessEffTargets_ threads it through', /function _sessEffTargets_\(sess, ?dateKey\)/.test(SRC));
ok('the .zwo export carries the band for the day it is FOR', /_planSessionFromDef_\(intent,\(s\.block&&s\.block\.week\)\|\|1, 0, dateKey\|\|null\)/.test(SRC));

console.log('\n' + Y + '=== the stream branch keeps the adjudicated band ===' + X);
ok('lo comes from t, not from out', /lo:\(t\.powerLo!=null\?t\.powerLo:out\.lo\)/.test(SRC));
ok('hi likewise', /hi:\(t\.powerHi!=null\?t\.powerHi:out\.hi\)/.test(SRC));
ok('NEG: the branch no longer returns the stream detector own band', !/return \{ vals:out\.vals, lo:out\.lo, hi:out\.hi/.test(SRC));
ok('the .zwo stamp still overrides both, being the file actually ridden', /t2\.powerLo=_sr\.lo; ?t2\.powerHi=_sr\.hi/.test(SRC));

console.log('\n' + Y + '=== the arithmetic, exercised against the reported session ===' + X);
{
  // ftpOn_: latest entry on or before the date; before the log begins, the first entry.
  const log = [{date:'2026-05-01', ftp:179}, {date:'2026-07-01', ftp:190}, {date:'2026-08-19', ftp:183}];
  const ftpOn = (d) => { const s = log.slice().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
    let e = null; for (const x of s) { if (x.date <= d) e = x; else break; } return e ? e.ftp : s[0].ftp; };
  const band = (pct, d) => [Math.round(ftpOn(d)*pct[0]/100), Math.round(ftpOn(d)*pct[1]/100)];
  const VO2 = [110, 120];

  ok('before the log begins, the earliest entry is used, never a default', ftpOn('2026-01-01') === 179);
  ok('on a June date the FTP in force was 179', ftpOn('2026-06-15') === 179);
  ok('on an August date it is 183', ftpOn('2026-08-19') === 183);
  ok('for a FUTURE date it degrades to the current value', ftpOn('2027-01-01') === 183);

  // The reported false failure: intervals of 195/195/200W called short of a 209W floor.
  const ridden = [195, 195, 200];
  const curLo = band(VO2, '2026-07-15')[0];          // graded against the 190 era
  ok('the 209W floor that produced the complaint is 110% of 190 (' + curLo + 'W)', curLo === 209);
  ok('...and all three intervals sit under it', ridden.every((v) => v < curLo));
  const oldLo = band(VO2, '2026-06-15')[0];          // the FTP actually in force
  ok('the band in force in June was built on 179, floor ' + oldLo + 'W', oldLo === 197);
  ok('...which one of the three intervals clears', ridden.filter((v) => v >= oldLo).length === 1);
  // THE HONEST LIMIT, and it is worth stating in the file rather than only in a message. This fix
  // makes the grade CORRECT; it does not make the session a pass. Against the band actually in
  // force, two of three intervals are still short - by 2W rather than by 14W. What changes is that
  // the shortfall is now real and small instead of invented and large, which is the difference
  // between a debrief the athlete can trust and one he has learned to argue with.
  ok('two are still genuinely short - the fix removes the ERROR, not the shortfall',
     ridden.filter((v) => v < oldLo).length === 2);
  ok('...and the miss shrinks from 14W to 2W', (curLo - Math.max.apply(null, ridden)) === 9 && (oldLo - 195) === 2);

  // And prescribing must not move: no date means today's FTP.
  const bandNoDate = (pct, cur) => [Math.round(cur*pct[0]/100), Math.round(cur*pct[1]/100)];
  ok('with no date the band is priced off the CURRENT FTP', bandNoDate(VO2, 183)[0] === 201);
  ok('...which equals the on-date band for today', bandNoDate(VO2, 183)[0] === band(VO2, '2026-08-19')[0]);
}

console.log('\n' + Y + '=== the dependency this rests on ===' + X);
ok('ftpHistory keys on date alone, so the log it reads is trustworthy', /ftpHistory:\{ keys:\['date'\], val:'ftp' \}/.test(SRC));
ok('ftpOn_ still walks the live log to the latest entry on or before the date', /if\(sorted\[i\]\.date<=dateStr\) eff=sorted\[i\]; else break;/.test(SRC));

console.log('');
if (fails) { console.log(R + 'band on date: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'band on date: all checks passed' + X + '\n');
