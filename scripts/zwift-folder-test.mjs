// One-click send to Zwift, and the folder Chrome will not open.
//
// Zwift keeps custom workouts under %LOCALAPPDATA%, and every path under %LOCALAPPDATA% is on
// Chrome's File System Access blocklist — "Can't open this folder because it contains system
// files". So the one folder the athlete needs is precisely the one the picker refuses, and no flag
// or permission changes that; the blocklist is enforced in the browser.
//
// The way through is a Windows directory JUNCTION under Documents, which is not blocklisted. Chrome
// checks the path it is given, and a write through the junction lands in the real Zwift folder
// because it IS the real folder — not a copy, so there is no second place for a file to go stale.
//
// TWO THINGS HAVE TO HOLD FOR THAT TO WORK, and both are pinned here:
//
//   1. VERIFICATION MUST KEY ON THE MARKER, NOT THE FOLDER NAME. A junction is called whatever you
//      called it, so a check that insists on the rider id would reject the very folder this fix
//      hands it. zwiftVerify_ accepts any folder containing workouts.files — the file ZWIFT writes —
//      which is evidence rather than a naming convention.
//   2. A PICK THAT ENDS WITH NOTHING SET MUST EXPLAIN ITSELF. Chrome reports a blocked pick and a
//      cancelled one identically (AbortError), and the old catch returned silently — so the one case
//      that needs a remedy got nothing at all.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fnBody } from './lib-src-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : null;
const LIVE = !!URL_;
const src = LIVE ? await (await fetch(URL_, { cache: 'no-store' })).text()
                 : fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = LIVE ? (s) => s
  : (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'), (_, c) => (c === BS ? BS : c));
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + BS + 's*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const M = new Function('uiAlert', asServed(
  exVar('ZWIFT_EXPECT_ID') + exVar('ZWIFT_MARKER') + exVar('ZWIFT_LINK_NAME') +
  fnBody(src, '_zwiftPathHint_') + fnBody(src, '_zwiftLinkHint_') + fnBody(src, '_zwiftBlockedHelp_') +
  fnBody(src, 'zwiftVerify_') +
  'return {ZWIFT_EXPECT_ID,ZWIFT_MARKER,ZWIFT_LINK_NAME,_zwiftPathHint_,_zwiftLinkHint_,_zwiftBlockedHelp_,zwiftVerify_};'
))((s) => { M_ALERT.push(s); });
const M_ALERT = [];

// A directory handle as the File System Access API presents one: a name, and getFileHandle that
// rejects when the file is absent.
const handle = (name, files) => ({
  name,
  getFileHandle: (f) => (files.indexOf(f) >= 0 ? Promise.resolve({}) : Promise.reject(new Error('NotFound'))),
});

console.log('\n' + Y + '=== a junction verifies on the MARKER, not on its name ===' + X);
{
  const v = await M.zwiftVerify_(handle('ZwiftWorkouts', ['workouts.files', '2026-08-20-threshold.zwo']));
  ok('a folder named ZwiftWorkouts is accepted', v.ok === true);
  ok('...because Zwift’s own marker is in it', /workouts\.files/.test(v.why));
  ok('and the name is reported for the UI', v.name === 'ZwiftWorkouts');
}
{
  const v = await M.zwiftVerify_(handle(M.ZWIFT_EXPECT_ID, []));
  ok('the rider-id folder still passes before Zwift has written its marker', v.ok === true);
  ok('...and says the marker is not there yet', v.marker === false);
}
{
  const v = await M.zwiftVerify_(handle('Downloads', ['2026-08-25-vo2.zwo']));
  ok('NEG: a random folder with a .zwo in it is refused', v.ok === false);
  ok('...and says why', /is not/.test(v.why));
}

console.log('\n' + Y + '=== the remedy is a real command, with real backslashes ===' + X);
{
  const cmd = M._zwiftLinkHint_();
  console.log('     ' + cmd);
  ok('it is a junction, not a copy', cmd.indexOf('mklink /J') >= 0);
  ok('the link lands under Documents, which Chrome does not block', cmd.indexOf('Documents') >= 0);
  ok('...named the same as what the dialog tells them to pick', cmd.indexOf(M.ZWIFT_LINK_NAME) >= 0);
  ok('it targets LOCALAPPDATA, which Chrome does block', cmd.indexOf('LOCALAPPDATA') >= 0);
  ok('...at this rider’s id', cmd.indexOf(M.ZWIFT_EXPECT_ID) >= 0);
  // The served template eats one backslash level, so a path written with escapes would arrive as
  // "%USERPROFILE%DocumentsZwiftWorkouts" — a command that RUNS and silently makes the wrong
  // folder. Assert the paths themselves rather than counting separators: a count is a restatement
  // of the string, and gets it wrong as easily as the code could.
  ok('the link path is intact', cmd.indexOf('%USERPROFILE%' + BS + 'Documents' + BS + M.ZWIFT_LINK_NAME) >= 0);
  ok('the target path is intact', cmd.indexOf('%LOCALAPPDATA%' + BS + 'Zwift' + BS + 'Workouts' + BS + M.ZWIFT_EXPECT_ID) >= 0);
  ok('NEG: no doubled separator from an escaping slip', cmd.indexOf(BS + BS) < 0);
  ok('NEG: no separator was eaten', cmd.indexOf('DocumentsZwift') < 0 && cmd.indexOf('ZwiftWorkouts' + M.ZWIFT_EXPECT_ID) < 0);
}

console.log('\n' + Y + '=== a pick that sets nothing explains itself ===' + X);
{
  M_ALERT.length = 0;
  M._zwiftBlockedHelp_();
  const t = M_ALERT.join(' ');
  ok('the dialog fired', M_ALERT.length === 1);
  ok('it says the pick was not the problem', /Nothing is wrong with your pick/.test(t));
  ok('it names AppData as the blocker', /AppData/.test(t));
  ok('it carries the command', /mklink/.test(t));
  ok('it says the link is the same folder, not a copy', /not a copy/.test(t));
}
{
  // Gated on INTENT: the help is for someone who has no folder yet. Once one is set, a cancel is a
  // cancel — a modal for changing your mind is how a useful dialog becomes noise.
  const pick = fnBody(src, 'zwiftPickFolder_');
  ok('the catch consults the stored handle before explaining', /zwiftGetHandle_\(\)\.then/.test(pick));
  ok('...and only helps when nothing is set', /if\(!existing\) _zwiftBlockedHelp_\(\)/.test(pick));
  ok('NEG: the silent return is gone', !/if\(e && e\.name==='AbortError'\) return false;/.test(pick));
}

console.log('\n' + Y + '=== the write path is unchanged — it still re-verifies every send ===' + X);
{
  const send = fnBody(src, 'zwiftSendFile_');
  ok('permission is re-checked', /zwiftPerm_\(h\)/.test(send));
  ok('the folder is re-verified on every write', /zwiftVerify_\(h\)/.test(send));
  ok('...and a failed verify does not write', /if\(!v\.ok\) return \{sent:false/.test(send));
  ok('the bytes are the exporter’s own xml', /w\.write\(z\.xml\)/.test(send));
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'zwift folder: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
