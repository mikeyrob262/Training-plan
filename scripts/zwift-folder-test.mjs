// One-click send to Zwift, and the folder Chrome will not open.
//
// Zwift keeps custom workouts under %LOCALAPPDATA%, and every path under %LOCALAPPDATA% is on
// Chrome's File System Access blocklist — "Can't open this folder because it contains system
// files". So the one folder the athlete needs is precisely the one the picker refuses. No flag or
// permission changes that; the blocklist is enforced in the browser.
//
// The way through is a Windows directory JUNCTION under Documents, which is not blocklisted. Chrome
// checks the path it is given, and a write through the junction lands in the real Zwift folder
// because it IS the real folder — not a copy, so there is no second place for a file to go stale.
//
// THE BROWSER CANNOT MAKE THE JUNCTION. getDirectoryHandle({create:true}) creates a real directory;
// no File System Access call — and no web API at all — creates a junction or a symlink. So one
// command is irreducible, and the app's job is to make it a paste rather than a troubleshooting
// session: idempotent, safe, on the clipboard, with the half-finished state named as itself.
//
// The command's four-state behaviour was verified against a real filesystem before this test was
// written — absent, already-a-junction, empty folder, and folder-with-a-real-file (which it refuses,
// leaving the file intact). What is pinned here is the shape that makes those outcomes true.
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

const ALERTS = [], CLIP = [];
const M = new Function('uiAlert', 'navigator', asServed(
  exVar('ZWIFT_EXPECT_ID') + exVar('ZWIFT_MARKER') + exVar('ZWIFT_LINK_NAME') +
  fnBody(src, '_zwiftPathHint_') + fnBody(src, '_zwiftLinkPath_') + fnBody(src, '_zwiftFixCmd_') +
  fnBody(src, '_zwiftLinkHint_') + fnBody(src, '_zwiftBlockedHelp_') + fnBody(src, 'zwiftVerify_') +
  'return {ZWIFT_EXPECT_ID,ZWIFT_MARKER,ZWIFT_LINK_NAME,_zwiftFixCmd_,_zwiftBlockedHelp_,zwiftVerify_};'
))((s) => { ALERTS.push(s); }, { clipboard: { writeText(t) { CLIP.push(t); } } });

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

console.log('\n' + Y + '=== ONE command, safe to run twice ===' + X);
{
  const cmd = M._zwiftFixCmd_();
  console.log('     ' + cmd);
  // The first version was a bare mklink. It fails the moment the link exists — which is the state
  // anyone is in after one attempt — so the command handed out to fix the problem broke on its
  // second run and read as a new problem.
  ok('it clears whatever is there first', cmd.indexOf('rmdir') === 0);
  ok('...then makes the link, in the same line',
    cmd.indexOf('&') > 0 && cmd.indexOf('mklink /J') > cmd.indexOf('&'));
  ok('a missing folder is not an error the athlete has to read', cmd.indexOf('2>nul') > 0);
  // rmdir WITHOUT /s is the safety property. With /s this line could delete a folder of real
  // workouts; without it, rmdir refuses a non-empty directory and the whole command fails
  // harmlessly — verified against a real folder containing a file, which survived.
  ok('NEG: it can never recurse, so it can never delete a workout', cmd.indexOf('/s') < 0);
  ok('it is a junction, not a copy', cmd.indexOf('mklink /J') > 0);
  ok('the link lands under Documents, which Chrome does not block', cmd.indexOf('Documents') >= 0);
  ok('...named the same as what the dialog tells them to pick', cmd.indexOf(M.ZWIFT_LINK_NAME) >= 0);
  ok('it targets LOCALAPPDATA, which Chrome does block', cmd.indexOf('LOCALAPPDATA') >= 0);
  ok('...at this rider’s id', cmd.indexOf(M.ZWIFT_EXPECT_ID) >= 0);
  // The served template eats one backslash level, so a path written with escapes would arrive as
  // "%USERPROFILE%DocumentsZwiftWorkouts" — a command that RUNS and silently makes the wrong
  // folder. Assert the paths themselves rather than counting separators: a count is a restatement
  // of the string and gets it wrong as easily as the code could, which it already did once.
  ok('the link path is intact', cmd.indexOf('%USERPROFILE%' + BS + 'Documents' + BS + M.ZWIFT_LINK_NAME) >= 0);
  ok('the target path is intact',
    cmd.indexOf('%LOCALAPPDATA%' + BS + 'Zwift' + BS + 'Workouts' + BS + M.ZWIFT_EXPECT_ID) >= 0);
  ok('NEG: no doubled separator from an escaping slip', cmd.indexOf(BS + BS) < 0);
  ok('NEG: no separator was eaten', cmd.indexOf('DocumentsZwift') < 0);
  // Both halves must name the SAME link, or it removes one folder and links another.
  eq('the same link path on both sides of the &',
    cmd.split('%USERPROFILE%' + BS + 'Documents' + BS + M.ZWIFT_LINK_NAME).length - 1, 2);
}

console.log('\n' + Y + '=== a half-made setup is named as itself ===' + X);
{
  // Picking a ZwiftWorkouts that is an ordinary folder is exactly what a failed link attempt leaves
  // behind. The generic message read as "wrong folder", which sends someone hunting for a different
  // folder instead of finishing the link they already started.
  const v = await M.zwiftVerify_(handle(M.ZWIFT_LINK_NAME, []));
  ok('it is refused', v.ok === false);
  ok('...flagged as the half-made case, not a wrong pick', v.linkEmpty === true);
  ok('...and says the link command has not run', /link command has not run/.test(v.why));
  ok('NEG: it does not send them hunting for the rider-id folder', v.why.indexOf(M.ZWIFT_EXPECT_ID) < 0);
}

console.log('\n' + Y + '=== the dialog does the typing ===' + X);
{
  ALERTS.length = 0; CLIP.length = 0;
  M._zwiftBlockedHelp_();
  const t = ALERTS.join(' ');
  ok('the command went to the clipboard', CLIP.length === 1 && CLIP[0] === M._zwiftFixCmd_());
  ok('...and the dialog says so', /on your clipboard/.test(t));
  ok('it says the pick was not the problem', /Your pick was fine/.test(t));
  ok('it names AppData as the blocker', /AppData/.test(t));
  ok('it is honest that the browser cannot do this part', /no web API can create a folder link/.test(t));
  ok('it says the command is safe to repeat', /Safe to run more than once/.test(t));
  ok('...and that it cannot delete a folder with files in it', /cannot delete a folder that has files/.test(t));
  ok('it says the link is the same folder, not a copy', /not a copy/.test(t));
  ok('the command itself is in the text as a fallback', t.indexOf('mklink /J') >= 0);
}
{
  // Clipboard access can be refused. The dialog must not claim a copy that did not happen.
  const M2 = new Function('uiAlert', 'navigator', asServed(
    exVar('ZWIFT_EXPECT_ID') + exVar('ZWIFT_LINK_NAME') +
    fnBody(src, '_zwiftLinkPath_') + fnBody(src, '_zwiftFixCmd_') + fnBody(src, '_zwiftBlockedHelp_') +
    'return {_zwiftBlockedHelp_};'
  ))((s) => { ALERTS.push(s); }, { clipboard: { writeText() { throw new Error('denied'); } } });
  ALERTS.length = 0;
  M2._zwiftBlockedHelp_();
  const t = ALERTS.join(' ');
  ok('a refused clipboard still shows the dialog', ALERTS.length === 1);
  ok('NEG: and does not claim the command was copied', !/on your clipboard/.test(t));
  ok('...the command is still there to copy by hand', t.indexOf('mklink /J') >= 0);
}

console.log('\n' + Y + '=== the write path is unchanged — it re-verifies every send ===' + X);
{
  const send = fnBody(src, 'zwiftSendFile_');
  ok('permission is re-checked', /zwiftPerm_\(h\)/.test(send));
  ok('the folder is re-verified on every write', /zwiftVerify_\(h\)/.test(send));
  ok('...and a failed verify does not write', /if\(!v\.ok\) return \{sent:false/.test(send));
  ok('the bytes are the exporter’s own xml', /w\.write\(z\.xml\)/.test(send));
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'zwift folder: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
