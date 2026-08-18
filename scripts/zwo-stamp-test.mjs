// GRADE THE FILE HE WAS GIVEN, NOT THE PLAN HE WAS NOT.
//
// A VO2 session was reported as failed - "power fell short in every work interval" - on a ride of
// 194/194/200/199W. The band is DERIVED at read time, which is right for a plan that can change and
// wrong the moment a file leaves the building:
//
//   SESSION_DEFS.vo2 is pctFtp [110,120]  ->  at FTP 190 the grader wants 209-228W
//   _zwoFor_ writes OnPower as the band MIDPOINT  ->  today's exporter emits ~219W
//   the .zwo actually in his Zwift folder targeted ~197W  ->  the pre-557c917 band
//
// So the grader and the current exporter agree with each other; the FILE is the stale artifact. He
// executed it exactly and was told he missed. Nothing recorded what had been sent, so nothing could
// tell the difference.
//
// The export now stamps the band it encoded, and grading prefers that stamp.
//
// Run: node scripts/zwo-stamp-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
function mb(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, mb(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, g, w) => { const c = JSON.stringify(g) === JSON.stringify(w); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(g) + ', want ' + JSON.stringify(w))); };

console.log('\n' + Y + '=== the numbers that produced the false failure ===' + X);
{
  const m = src.match(/vo2:\s*\{[^}]*pctFtp:\[(\d+),(\d+)\]/);
  ok('the VO2 band is still pctFtp 110-120', !!m && m[1] === '110' && m[2] === '120');
  const FTP = 190;
  eq('...which at FTP 190 is the 209-228W he was graded on', [Math.round(FTP*1.10), Math.round(FTP*1.20)], [209, 228]);
  eq('...and the exporter writes the MIDPOINT, ~219W', Math.round((209 + 228) / 2), 219);
  ok('the ridden intervals sit outside that band', [194, 194, 200, 199].every((w) => w < 209));
  ok('...and inside the band the file actually targeted', [194, 194, 200, 199].every((w) => w >= 194 && w <= 202));
}

console.log('\n' + Y + '=== the export records what it sent ===' + X);
{
  const stamped = [];
  const stub = {
    planSessionsForDate_: () => sessions,
    markPlanEdited_: (s, f) => { (s._edited = s._edited || {}); (f||[]).forEach((k)=>s._edited[k]=1); s.editedAt = 1; stamped.push(f); return s; },
    sv: () => {}, _tbDK_: () => '2026-08-18',
    console: { log(){}, warn(){} }
  };
  let sessions;
  const names = Object.keys(stub);
  const stamp = new Function(...names, exFn('_zwoStampRx_') + 'return _zwoStampRx_;')(...names.map((n)=>stub[n]));
  const read  = new Function(...names, exFn('_stampedRxFor_') + 'return _stampedRxFor_;')(...names.map((n)=>stub[n]));

  sessions = [{ id:'a', intent:'vo2' }, { id:'b', intent:'strengthA' }];
  eq('the band is written onto the matching session', stamp({ intent:'vo2', lo:194, hi:202, ftp:190 }, '2026-08-18'), true);
  eq('...as a STRING, so a lowered band cannot be raised back by Math.max', sessions[0].zwoRx, '194-202@190');
  ok('...stamped so the correction travels', sessions[0].editedAt === 1 && sessions[0]._edited.zwoRx);
  ok('...and the unrelated session is untouched', !sessions[1].zwoRx);
  eq('re-downloading the same file changes nothing', stamp({ intent:'vo2', lo:194, hi:202, ftp:190 }, '2026-08-18'), false);
  eq('...but a changed band re-stamps', stamp({ intent:'vo2', lo:209, hi:228, ftp:190 }, '2026-08-18'), true);

  // It must never invent a row - that is how the plan grew 13 sessions on a Sunday.
  sessions = [{ id:'c', intent:'threshold' }];
  eq('NEG: no matching session -> no stamp, and no row created', stamp({ intent:'vo2', lo:194, hi:202, ftp:190 }, '2026-08-18'), false);
  eq('...the day is left exactly as it was', sessions.length, 1);
  sessions = [{ id:'d', intent:'vo2', deleted:true }];
  eq('NEG: a tombstoned session is not stamped', stamp({ intent:'vo2', lo:194, hi:202, ftp:190 }, '2026-08-18'), false);
  eq('NEG: an incomplete export is not stamped', stamp({ intent:'vo2', lo:0, hi:202, ftp:190 }, '2026-08-18'), false);

  console.log('\n' + Y + '=== and grading reads it back ===' + X);
  sessions = [{ id:'a', intent:'vo2', zwoRx:'194-202@190' }];
  eq('the stamp parses back to the band that was sent', read('2026-08-18', 'vo2'), { lo:194, hi:202, ftp:190 });
  eq('NEG: a different intent does not borrow it', read('2026-08-18', 'threshold'), null);
  sessions = [{ id:'a', intent:'vo2' }];
  eq('NEG: never exported -> null, meaning fall back to the derived band', read('2026-08-18', 'vo2'), null);
  sessions = [{ id:'a', intent:'vo2', zwoRx:'garbage' }];
  eq('NEG: a malformed stamp is ignored, not half-parsed', read('2026-08-18', 'vo2'), null);
}

console.log('\n' + Y + '=== the grader prefers the stamp ===' + X);
{
  const wm = exFn('_blockWorkMeasure_');
  ok('it consults the stamp', /_stampedRxFor_\(dateKey, intent\)/.test(wm));
  ok('...overriding the derived band', /t2\.powerLo=_sr\.lo; t2\.powerHi=_sr\.hi; t=t2;/.test(wm));
  // bp.sessions is derived and shared; mutating it in place would leak into every other reader.
  ok('...on a COPY, never mutating the derived session', /var t2=\{\}; for\(var tk in t\)/.test(wm));
  ok('the debrief reads its band from this one function', /C\.workIntervals=wm\?\{ vals:wm\.vals, lo:wm\.lo, hi:wm\.hi/.test(src));
  // The stamp happens at the single funnel, not while merely previewing a file.
  ok('stamped from _zwoEmit_, the one path every download and send takes', /_zwoStampRx_\(z, dateKey\);/.test(src));
  ok('_zwoFor_ reports the intent so the stamp knows which session', /intent:intent,/.test(src));
}

console.log('\n' + Y + '=== the build stamp is applied by CI, not by hand ===' + X);
ok('the source carries a placeholder, not a date someone typed', /window\.__BUILD__ = '__BUILD_STAMP__';/.test(src));
ok('NEG: the stale hand-edited value is gone', !/window\.__BUILD__ = '2026-08-04/.test(src));
ok('CI substitutes it', /sed -i "s\/__BUILD_STAMP__\/\$STAMP\/" worker\.js/.test(yml));
ok('...with the commit and the deploy clock', /STAMP="\$\(date -u \+%Y-%m-%dT%H:%MZ\)-\$\{GITHUB_SHA:0:7\}"/.test(yml));
ok('...before the deploy step', yml.indexOf('Stamp the build') < yml.indexOf('npx wrangler deploy'));
// Fail closed: an un-stamped deploy is the exact condition that makes a stale tab unfalsifiable.
ok('CI FAILS if the placeholder is missing', /::error::worker\.js has no __BUILD_STAMP__ placeholder/.test(yml) && /exit 1/.test(yml));

console.log('');
if (fails) { console.log(R + 'zwo stamp: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'zwo stamp: all checks passed' + X + '\n');
