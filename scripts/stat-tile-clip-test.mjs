// THE DASHBOARD STAT TILES MUST STAY READABLE WHEN THE COLUMN IS NARROW.
//
// Reported as TSS / W-kg / Total Time / Activities showing "12", "2.", "2h", "3" - roughly two
// characters each, on the top-right row of the desktop dashboard.
//
// It was a layout collapse, not a data bug, and it had two causes:
//
//   1. repeat(4,1fr) forces four tiles across at ANY width, with no floor. These tiles sit in row
//      1's THIRD column (grid 1.3fr / 0.92fr / 1.55fr), so the column is only ~41% of the content
//      width. Around a 900px viewport each tile lands near 82px; take off 24px of padding, a fixed
//      30px icon and a 6px gap and the value box is about 20px - two characters.
//   2. the value shared its line with that fixed 30px icon, so it competed for room it never
//      needed, and white-space:nowrap + overflow:hidden then CHOPPED it in silence.
//
// The silence is the part worth pinning. A truncated "2h" is indistinguishable from a real reading,
// so this presented as a wrong NUMBER rather than a broken BOX, which is what kept it in the
// "probably a data bug" pile across several sessions. Same family as the banded-values and
// formatted-value-read-as-a-number bugs: a display defect wearing the costume of a measurement.
//
// Run: node scripts/stat-tile-clip-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

// The tile helper and the grid that holds it.
const i0 = src.indexOf('function tile(icon,iconCol,val,label,sub,sparkHtml)');
if (i0 < 0) { console.log(R + 'dashboard tile() helper missing' + X); process.exit(1); }
const TILE = src.slice(i0, src.indexOf("rc+=tile('", i0));
const GRID = src.slice(Math.max(0, i0 - 1800), i0);
// Strip comments: the prose above the fix quotes the very strings these guards grep for.
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const TILE_C = noCmt(TILE), GRID_C = noCmt(GRID);

console.log('\n' + Y + '=== the tile grid has a floor and is allowed to wrap ===' + X);
ok('the grid uses auto-fit with a minimum tile width', /grid-template-columns:repeat\(auto-fit,minmax\(\d+px,1fr\)\)/.test(GRID_C));
ok('NEG: it is no longer a hard four-across', !/grid-template-columns:repeat\(4,1fr\)/.test(GRID_C));
{
  const m = GRID_C.match(/minmax\((\d+)px,1fr\)/);
  const floor = m ? +m[1] : 0;
  ok('...and the floor is wide enough to hold a real value (>=96px), got ' + floor + 'px', floor >= 96);
}

console.log('\n' + Y + '=== the value owns its own full-width line ===' + X);
ok('the icon now shares its line with the LABEL, not the value', /flex:1;min-width:0;font-size:12px[^"]*"?>'\+label/.test(TILE_C) || />'\+label\+'<\/div>[\s\S]{0,40}<\/div>/.test(TILE_C));
ok('the value is emitted after that header row closes',
   TILE_C.indexOf("+label+") > -1 && TILE_C.indexOf("+label+") < TILE_C.indexOf("+_v+'</div>"));
ok('NEG: the value is not right-aligned inside a shared flex line any more', !/text-align:right;font-size:'\+\(String\(val\)/.test(TILE_C));

console.log('\n' + Y + '=== a value that still will not fit SAYS so ===' + X);
ok('the value truncates with an ellipsis, not a silent chop', /text-overflow:ellipsis/.test(TILE_C));
ok('...and carries the full value in a title attribute', /title="'\+_v\+'"/.test(TILE_C));
ok('the label degrades the same way', (TILE_C.match(/text-overflow:ellipsis/g) || []).length >= 3);
ok('the font still steps down for long values', /_v\.length>7\?'13px'/.test(TILE_C));

console.log('\n' + Y + '=== the arithmetic that caused it, run rather than argued ===' + X);
{
  // Row 1 is grid-template-columns:1.3fr 0.92fr 1.55fr with a 10px gap; the tiles are the third
  // column. Reproduce the measurement end to end so the diagnosis is executable.
  const colW = (vw) => { const inner = vw - 2 * 10; return inner * (1.55 / (1.3 + 0.92 + 1.55)); };
  const PAD = 24, BORDER = 2, ICON = 30, GAP = 6, TGAP = 8;

  const oldValueBox = (vw) => {
    const tile = (colW(vw) - 3 * TGAP) / 4;              // always four across
    return tile - PAD - BORDER - ICON - GAP;             // value fights the icon for the rest
  };
  const newValueBox = (vw, floor = 104) => {
    const c = colW(vw);
    const per = Math.max(1, Math.min(4, Math.floor((c + TGAP) / (floor + TGAP))));
    const tile = (c - (per - 1) * TGAP) / per;
    return tile - PAD - BORDER;                          // value owns the full inner width
  };

  // Judge the OLD layout against the values it actually had to print, not an arbitrary pixel
  // threshold - the first draft of this file asserted <40px at 1100px, measured 43px and failed on
  // its own guess while the fix underneath was correct. "Total Time" is the long one at ~48px.
  const LONGEST = '2h 15m', LONGEST_PX = LONGEST.length * 8;
  ok('OLD @900px collapses to ~2 characters (' + oldValueBox(900).toFixed(0) + 'px)', oldValueBox(900) < 26);
  ok('OLD @1100px still cannot fit "' + LONGEST + '" (' + oldValueBox(1100).toFixed(0) + 'px < ' + LONGEST_PX + 'px)',
     oldValueBox(1100) < LONGEST_PX);
  ok('OLD @1600px looks fine - which is why this read as intermittent (' + oldValueBox(1600).toFixed(0) + 'px)', oldValueBox(1600) > 60);

  ok('NEW @900px is readable (' + newValueBox(900).toFixed(0) + 'px)', newValueBox(900) >= 60);
  ok('NEW @1100px is readable (' + newValueBox(1100).toFixed(0) + 'px)', newValueBox(1100) >= 60);
  ok('NEW @1600px is at least as good as before (' + newValueBox(1600).toFixed(0) + 'px)', newValueBox(1600) >= oldValueBox(1600));
  ok('NEW never drops below the two-character failure at any width 700-1900',
     [700, 800, 900, 1000, 1200, 1400, 1600, 1900].every((w) => newValueBox(w) >= 55));

  // The actual strings that were being chopped, at ~8px per character for 16px 800-weight digits.
  const need = (s) => s.length * 8;
  for (const s of ['1247', '2.35', '2h 15m', '12'])
    ok('"' + s + '" (~' + need(s) + 'px) fits at 900px', newValueBox(900) >= need(s));
}

console.log('\n' + Y + '=== house style is preserved ===' + X);
ok('the tile keeps its 13px radius, not a pill', /border-radius:13px/.test(TILE_C) && !/border-radius:(999|100)px/.test(TILE_C));
ok('the sparkline row is still 22px', /height:22px/.test(TILE_C));
ok('all four tiles are still rendered', (src.match(/rc\+=tile\(/g) || []).length === 4);

console.log('');
if (fails) { console.log(R + 'stat tile clip: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'stat tile clip: all checks passed' + X + '\n');
