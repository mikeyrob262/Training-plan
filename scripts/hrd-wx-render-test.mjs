// TWO CARD-LEVEL DEFECTS, BOTH "the display told you something that was not so".
//
// 1. HR DRIFT CHART. Reported unlabelled/unreadable. The missing axis was the smaller half: it used
//    the generic spark(), which scales EVERY series against a ZERO baseline - so an HR trace of
//    ~140 +/- 8 bpm collapsed into a flat sliver across the top tenth of the box. The drift the card
//    exists to show was geometrically invisible before anyone noticed the labels were gone.
// 2. "HOLLAND 100 ALTERNATIVE". Reported as wrong content bleeding onto the card. It was the RIDE
//    NAME, printed deliberately because the number is often not from today's ride - but with no
//    prefix, so an unintroduced proper noun read as a stray fragment. A label nobody can identify
//    as a label does not do the job it was added for.
// 3. WEATHER ALERT ON A PAST DAY. "Thunderstorms Tue" stood as an active alert the day AFTER it
//    hit, because the scan used `i>0` to mean "later than today" - an assumption about how the
//    payload is aligned, not a date check. The bare weekday made it invisible: inside a 7-day
//    window "Tue" a day late looks exactly like "Tue" a week early.
//
// Run: node scripts/hrd-wx-render-test.mjs
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

console.log('\n' + Y + '=== the drift chart scales to the DATA, not to zero ===' + X);
ok('a dedicated chart exists', /function _hrdChart_\(vals,color,durMin\)/.test(SRC));
ok('it takes its floor and ceiling from the series', /var lo=Math\.min\.apply\(null,vals\), ?hi=Math\.max\.apply\(null,vals\)/.test(SRC));
ok('...padded so the trace never rides the frame', /var pad=Math\.max\(2,\(hi-lo\)\*0\.15\)/.test(SRC));
ok('...and the y scale spans that range, not 0..max', /\(vals\[i\]-yLo\)\/\(yHi-yLo\)/.test(SRC));
ok('NEG: the card no longer uses the zero-baseline spark()', !/spark\(series,col/.test(SRC));
ok('the card calls the new chart', /_hrdChart_\(series,col,res\.durMin\)/.test(SRC));

console.log('\n' + Y + '=== it is labelled on both axes ===' + X);
ok('y ticks are printed in bpm', /'\+yHi\+' bpm<\/span><span>'\+yLo\+'/.test(SRC));
ok('x ticks are printed in minutes', /0 min<\/span><span>half<\/span><span>'\+dm\+' min/.test(SRC));
ok('the first/second-half split is drawn, since that IS the measurement', /stroke-dasharray="2 2"/.test(SRC));
ok('labels are HTML around the svg, never text inside a stretched viewBox', !/<text/.test(SRC.slice(SRC.indexOf('function _hrdChart_'), SRC.indexOf('function _hrdChart_') + 2200)));
ok('the divider uses a literal colour, never var() in an SVG attribute',
   !/stroke="var\(/.test(SRC.slice(SRC.indexOf('function _hrdChart_'), SRC.indexOf('function _hrdChart_') + 2200)));

console.log('\n' + Y + '=== the ride name is introduced as a label ===' + X);
ok('the bare name now carries a "Read from" prefix', /Read from<\/span> '\+who/.test(SRC));
ok('...and it is still the real ride name, not a re-derived one', /var who=ride\?_hrdRideLabel_\(ride\):''/.test(SRC));
ok('_hrdRideLabel_ still routes through actName_, never r.name raw', /function _hrdRideLabel_[\s\S]{0,120}actName_\(r\)/.test(SRC));

console.log('\n' + Y + '=== a past storm is not an alert ===' + X);
ok('the scan compares a DATE', /if\(!dstr \|\| dstr<=_wxToday\) return;/.test(SRC));
ok('NEG: the index proxy is gone', !/stormDay<0 && i>0 && code>=95/.test(SRC));
ok('the label now carries the date, not just a weekday', /dayNames2\[sd\.getDay\(\)\]\+' '\+\(sd\.getMonth\(\)\+1\)\+'\/'\+sd\.getDate\(\)/.test(SRC));
ok('the Alerts TAB still filters by real time too', /var d=new Date\(hourly\.time\[i\]\);\s*\n\s*if\(d<now\) continue;/.test(SRC));

console.log('\n' + Y + '=== the alert selection, exercised ===' + X);
{
  // Model the scan and run the reported case: a payload whose daily array starts BEFORE today.
  const pick = (times, codes, today) => {
    let s = -1;
    codes.forEach((c, i) => { if (s >= 0 || !(c >= 95)) return; const d = String(times[i] || ''); if (!d || d <= today) return; s = i; });
    return s;
  };
  const oldPick = (codes) => { let s = -1; codes.forEach((c, i) => { if (s < 0 && i > 0 && c >= 95) s = i; }); return s; };
  // Reported shape: Mon..Sun, storm on TUESDAY, today is WEDNESDAY.
  const times = ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'];
  const codes = [0, 95, 0, 0, 0, 0, 0];
  ok('OLD logic flags the PAST Tuesday storm (idx ' + oldPick(codes) + ')', oldPick(codes) === 1);
  ok('NEW logic flags nothing, because it already happened', pick(times, codes, '2026-08-19') === -1);
  // A real upcoming storm must still fire.
  const codes2 = [0, 0, 0, 0, 95, 0, 0];
  ok('a FUTURE storm still fires', pick(times, codes2, '2026-08-19') === 4);
  // Today's storm is handled by the hazard list above, so it must not double-report.
  const codes3 = [0, 0, 95, 0, 0, 0, 0];
  ok('TODAY is left to the hazard list, not duplicated as an alert', pick(times, codes3, '2026-08-19') === -1);
  // And an aligned payload (index 0 == today) behaves the same, so the fix is not alignment-specific.
  ok('an aligned payload still finds the future storm',
     pick(['2026-08-19','2026-08-20','2026-08-21'], [0, 0, 95], '2026-08-19') === 2);
}

console.log('');
if (fails) { console.log(R + 'hrd/wx render: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'hrd/wx render: all checks passed' + X + '\n');
