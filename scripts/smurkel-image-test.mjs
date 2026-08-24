// Images in the Dr. Smurkel chat.
//
// The request used to be messages:[{role:'user', content:<one flat string>}] with the whole
// conversation serialized into "ATHLETE:/YOU:" lines. An image cannot go into a string, so the
// content becomes a BLOCK ARRAY when — and only when — pictures are attached; a text-only turn
// still sends the string, because that is what every other call in the file sends and churning it
// buys nothing.
//
// Three things here are load-bearing and none of them is obvious from reading the diff:
//
//   1. EVERY IMAGE IS RE-SENT ON EVERY TURN. This request rebuilds ONE user message from scratch
//      rather than appending to a message array, so an image attached on turn 1 is simply absent
//      from turn 2 unless it is included again. The test sends a second turn and asserts the first
//      image is still there.
//   2. IMAGES COME FIRST, each behind an "Image N:" label — the documented shape (images before
//      text; several images introduced by label so they can be referred to later). The labels have
//      to match the [attached Image N] tags in the transcript or "the second picture" resolves to
//      the wrong one.
//   3. THE MEDIA TYPE MUST BE ONE THE API ACCEPTS — image/jpeg, png, gif, webp. Not image/heic.
//
// The prep path itself (FileReader -> Image -> canvas) is browser-only and is exercised by
// scripts/desktop-layout-measure.mjs' sibling harness rather than here; what this file pins is the
// wire shape, the guards, and the prompt rules that keep a number read off a screenshot from being
// laundered into the app's measured facts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.argv[2] || '').indexOf('http') === 0 ? process.argv[2] : null;
const LIVE = !!URL_;
const src = LIVE
  ? await (await fetch(URL_, { cache: 'no-store' })).text()
  : fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = LIVE ? (s) => s
  : (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'), (_, c) => (c === BS ? BS : c));

function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing fn ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + BS + 's*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

// Capture what fetchSmurkelReply_ would put on the wire, without a network.
function send(convo) {
  let captured = null;
  const stubs = {
    _smurkelFacts_: () => 'FTP 183 W. Yesterday: 42.5 mi, NP 228 W.',
    _smurkelContext_: () => ({}),
    _SM_PERSONA: 'PERSONA',
    _SM_FORMAT_CHAT: 'FORMAT',
    fetch: (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return new Promise(() => {}); },
    AbortController: function () { this.abort = () => {}; this.signal = null; },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  const M = new Function(...Object.keys(stubs), asServed(exFn('fetchSmurkelReply_') + 'return fetchSmurkelReply_;'))
    (...Object.values(stubs));
  M(convo, () => {});
  return captured;
}
const IMG = (n, mt) => ({ media_type: mt || 'image/png', data: 'AAAA' + n, name: n + '.png', w: 800, h: 600 });

console.log('\n' + Y + '=== a text-only turn still sends a plain string ===' + X);
{
  const c = send({ dk: '2026-08-24', ride: null, debrief: 'D', turns: [{ who: 'you', text: 'why so hard?' }] });
  ok('one user message', c.body.messages.length === 1);
  ok('content is a string, not blocks  [negative control]', typeof c.body.messages[0].content === 'string');
  ok('the question is in it', c.body.messages[0].content.indexOf('why so hard?') >= 0);
  ok('no image rules leaked into a text-only prompt',
    c.body.messages[0].content.indexOf('He has attached') < 0);
}

console.log('\n' + Y + '=== one image turns the content into blocks, image FIRST ===' + X);
{
  const c = send({ dk: '2026-08-24', debrief: 'D',
    turns: [{ who: 'you', text: 'what is this race?', imgs: [IMG('reg')] }] });
  const b = c.body.messages[0].content;
  ok('content is an array', Array.isArray(b));
  eq('label, image, then the prompt', b.map(x => x.type), ['text', 'image', 'text']);
  eq('the label numbers it', b[0].text, 'Image 1:');
  eq('the source is base64', b[1].source.type, 'base64');
  eq('...with the media type the API accepts', b[1].source.media_type, 'image/png');
  eq('...and raw base64, no data: prefix', b[1].source.data, 'AAAAreg');
  ok('the prompt is the LAST block', b[b.length - 1].text.indexOf('PERSONA') === 0);
  ok('the transcript tags the attachment', b[b.length - 1].text.indexOf('[attached Image 1]') >= 0);
}

console.log('\n' + Y + '=== the rules that stop a screenshot becoming a measured fact ===' + X);
{
  const c = send({ dk: '2026-08-24', debrief: 'D', turns: [{ who: 'you', text: 'read this', imgs: [IMG('a')] }] });
  const p = c.body.messages[0].content.slice(-1)[0].text;
  ok('it is told how many images and how they are labelled', /He has attached 1 image, labelled Image 1/.test(p));
  ok('a figure read off an image must be attributed to HIM', p.indexOf('is HIS, not the app') >= 0);
  ok('it must say when something is illegible rather than guess', p.indexOf('illegible') >= 0);
  ok('it must not imply the calendar changed', p.indexOf('Never imply it has been saved') >= 0);
}

console.log('\n' + Y + '=== images from earlier turns are RE-SENT ===' + X);
{
  const c = send({ dk: '2026-08-24', debrief: 'D', turns: [
    { who: 'you', text: 'what is this?', imgs: [IMG('one')] },
    { who: 'coach', text: 'A half marathon on March 1.' },
    { who: 'you', text: 'and this one?', imgs: [IMG('two')] },
  ] });
  const b = c.body.messages[0].content;
  const imgs = b.filter(x => x.type === 'image');
  eq('both images are on the wire', imgs.map(x => x.source.data), ['AAAAone', 'AAAAtwo']);
  eq('labelled in order', b.filter(x => x.type === 'text' && /^Image /.test(x.text)).map(x => x.text),
    ['Image 1:', 'Image 2:']);
  const p = b[b.length - 1].text;
  ok('the transcript numbers match the labels',
    p.indexOf('[attached Image 1]') >= 0 && p.indexOf('[attached Image 2]') >= 0);
  ok('the coach turn between them is still in the history', p.indexOf('A half marathon on March 1.') >= 0);
}

console.log('\n' + Y + '=== an image with no text is a valid message ===' + X);
{
  const c = send({ dk: '2026-08-24', debrief: 'D', turns: [{ who: 'you', text: '', imgs: [IMG('solo')] }] });
  const b = c.body.messages[0].content;
  ok('the image is still sent', b.filter(x => x.type === 'image').length === 1);
  ok('the transcript says the picture IS the question',
    b[b.length - 1].text.indexOf('the picture is the question') >= 0);
}

console.log('\n' + Y + '=== the guards ===' + X);
{
  const M = new Function(asServed(
    exVar('_SM_IMG_MAX_N') + exVar('_SM_IMG_MAX_EDGE') + exVar('_SM_IMG_MAX_B64') +
    src.match(new RegExp('var _SM_IMG_OK = [^;]*;'))[0] +
    'return {_SM_IMG_MAX_N,_SM_IMG_MAX_EDGE,_SM_IMG_MAX_B64,_SM_IMG_OK};'))();
  eq('three images per message', M._SM_IMG_MAX_N, 3);
  eq('the long edge is capped at the model’s own standard tier', M._SM_IMG_MAX_EDGE, 1568);
  ok('the per-image base64 cap is inside the API’s 10MB', M._SM_IMG_MAX_B64 < 10 * 1024 * 1024);
  ok('three of them still fit the 32MB request cap', M._SM_IMG_MAX_B64 * 3 < 32 * 1024 * 1024);
  eq('exactly the four formats the API accepts', Object.keys(M._SM_IMG_OK).sort(),
    ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  ok('NEG: heic is not on the list', !M._SM_IMG_OK['image/heic']);
}

console.log('\n' + Y + '=== HEIC is attempted, not pre-rejected ===' + X);
{
  const prep = src.slice(src.indexOf('function _smImgPrep_('), src.indexOf('function _smTrayNote_('));
  ok('nothing filters on file extension before decoding',
    !/\.heic/i.test(prep) && prep.indexOf('accept=') < 0);
  ok('the decode failure is the only rejection path', prep.indexOf('img.onerror') >= 0);
  ok('...and it names Safari, so the message is actionable', prep.indexOf('Safari') >= 0);
  ok('a PNG is kept as PNG rather than JPEG-ed  [text stays legible]', prep.indexOf("srcType==='image/png'") >= 0);
  ok('transparency is flattened onto white, not black', prep.indexOf("fillStyle='#ffffff'") >= 0);
}

console.log('\n' + Y + '=== the tray is per-message and never persisted ===' + X);
{
  ok('_SM_TRAY is module scope, not on st', /var _SM_TRAY = \[\];/.test(src) && src.indexOf('st.smTray') < 0);
  ok('binding the reply UI clears anything staged', /_SM_TRAY=\[\]; _smTrayPaint_\(\)/.test(src));
  ok('sending empties it', /var imgs=_SM_TRAY\.slice\(\); _SM_TRAY=\[\];/.test(src));
  ok('NEG: no image is written into st anywhere in the chat path', src.indexOf('st.smurkelImgs') < 0);
}

console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'smurkel images: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
