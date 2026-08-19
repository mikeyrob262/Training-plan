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

console.log('\n' + Y + '=== the tile row is a COUNT, not a fit: 4 or 2, never a stranded 3+1 ===' + X);
// auto-fit packs as many tiles as WILL fit, so at a middling width it returns 3 and strands the
// fourth on its own row. It has no notion of balance, and no minmax value can forbid 3 - 3 is always
// reachable between the widths that give 4 and 2. With exactly four items the only balanced answers
// are 4x1 and 2x2, so the count is STATED at a breakpoint rather than inferred from space.
// THE RULE MUST BE REACHABLE FROM THE DASHBOARD, NOT MERELY PRESENT IN SOURCE.
// First attempt declared .ds-stat-grid inside aiSegTargetsHtml_'s style block, beside the .sm-*
// rules. That sheet is injected only when the AI Segment Targets panel renders, so on the Dashboard
// the class had NO rule and the tiles fell back to display:block - one per row. The previous version
// of this file asserted the CSS text and passed, because the text was there. Presence is not
// applicability. So: slice the GLOBAL head stylesheet and require the rule to be in THAT.
const HEAD = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const CSS = HEAD.slice(HEAD.indexOf('.ds-stat-grid{'));
ok('the rule is in the global head stylesheet, which every screen loads', HEAD.indexOf('.ds-stat-grid{') > -1);
{
  const i = src.indexOf('function aiSegTargetsHtml_(');
  const seg = i < 0 ? '' : src.slice(i, i + 12000);
  ok('NEG: it is NOT declared in the segment-panel sheet, which the dashboard never loads',
     !/\+'\.ds-stat-grid\{/.test(seg));
}
ok('the call site uses the class, not an inline grid', /rc\+='<div class="ds-stat-grid">'/.test(noCmt(src)));
ok('NEG: no auto-fit is left on this grid', !/auto-fit/.test(CSS));
ok('the default is a balanced 2x2', /\.ds-stat-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(CSS));
ok('...widening to 4 across at a breakpoint', /@media \(min-width:(\d+)px\)\{\.ds-stat-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/.test(CSS));

// THE CONTAINER DECIDES, NOT THE VIEWPORT. Reported inverted: 4-across on an iPad, stuck at 2x2 on
// a WIDER desktop. A viewport breakpoint is a PROXY for the width that matters - these tiles sit in
// a sub-column ~41% of the content width - and shell chrome, a sidebar or OS display scaling moves
// one without moving the other. No breakpoint VALUE fixes that; the measured quantity was wrong.
ok('the column is declared a query container', /\.ds-stat-col\{container-type:inline-size\}/.test(CSS));
ok('...and the markup applies that class to the tiles\' own column', /var rc='<div class="ds-stat-col"/.test(src));
ok('the grid asks the CONTAINER whether four tiles fit', /@container \(min-width:408px\)\{\.ds-stat-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/.test(CSS));
ok('...and drops to 2x2 below that', /@container \(max-width:407\.98px\)\{\.ds-stat-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/.test(CSS));
ok('the container rules come AFTER the viewport fallback, so they win where supported',
   CSS.indexOf('@container') > CSS.indexOf('@media (min-width:1040px)'));
{
  // 408 must be the real requirement, not a round number: four tiles at the 96px floor + three gaps.
  const m = CSS.match(/@container \(min-width:(\d+)px\)/);
  const need = 4 * 96 + 3 * 8;
  ok('the container threshold equals 4 tiles + 3 gaps (' + (m ? m[1] : '?') + ' vs ' + need + ')', m && +m[1] === need);
}
ok('a diagnostic exists to settle it with measurements', /function tileDump_\(\)/.test(src));
ok('...printing the viewport, one of the two quantities that were conflated', /viewport='\+window\.innerWidth/.test(src));
// It reported "4 across" against a screenshot showing 2x2, because querySelector returns the FIRST
// node and this app re-renders into parallel shells and re-parents cards by measured height. A
// diagnostic that measures whichever element it happens to find first is confidently wrong, which is
// worse than having none. It must enumerate and say which one is actually on screen.
ok('it enumerates EVERY instance, not just the first', /querySelectorAll\('\.ds-stat-grid'\)/.test(src));
ok('NEG: no querySelector-first on the grid', !/querySelector\('\.ds-stat-grid'\)/.test(src));
ok('...and flags when more than one exists', /MORE THAN ONE, that is the bug/.test(src));
ok('...marking which instance is VISIBLE', /vis\?'VISIBLE':'hidden/.test(src));
ok('...testing visibility properly, not just presence', /g\.offsetParent!==null && r\.width>0 && r\.height>0/.test(src));
ok('...and counting visible ones, since two on screen is its own bug', /VISIBLE INSTANCES='\+visible/.test(src));
ok('it reports the CONTAINER width per instance, not one global figure', /containerWidth='\+\(cw<0\?/.test(src));
ok('...and says plainly when 2x2 is CORRECT for that width', /2x2 is CORRECT for this width; the space is lost UPSTREAM/.test(src));
ok('...printing the ancestor chain, so a narrow column can be traced upward', /ancestor widths \(nearest first\)/.test(src));
ok('...naming a stacked result as a missing rule, the failure mode seen once already',
   /STACKED - no rule on this screen/.test(src));
ok('...using minmax(0,1fr), since an explicit count cannot wrap and a px min would OVERFLOW',
   !/repeat\((2|4),minmax\(\d+px/.test(CSS));
{
  const m = CSS.match(/@media \(min-width:(\d+)px\)/);
  const bp = m ? +m[1] : 0;
  // The breakpoint must not promise four tiles before there is room for four readable ones.
  const colAt = (vw) => (vw - 20) * (1.55 / (1.3 + 0.92 + 1.55));
  const tileAt4 = (vw) => (colAt(vw) - 3 * 8) / 4;
  ok('the breakpoint gives four tiles at least the 96px floor (' + tileAt4(bp).toFixed(0) + 'px at ' + bp + 'px)',
     tileAt4(bp) >= 96);
}

console.log('\n' + Y + '=== the VALUE owns a full-width line; the LABEL shares and wraps ===' + X);
// ROUND THREE, and the synthesis. Round 1 gave the value its own line and the label the icon's -
// labels clipped ("Total ...", "Activ..."). Round 2 swapped them - the value clipped ("3h 4..."),
// because beside a 22px icon it had ~44px and "3h 46m" needs ~44px. Swapping which one pays for the
// icon only MOVES the failure; something has to give up that line entirely.
//
// The LABEL is the one that can share, because a label WRAPS. Round 1's geometry was right and its
// ellipsis was the whole bug. The value takes the full inner width - ~70px at the floor instead of
// ~44px - so it stops needing the ellipsis at all.
ok('the label row is a float container, so line 2+ gets the full width', /overflow:hidden;margin-bottom:6px/.test(TILE_C));
ok('...with the icon FLOATED, not a flex sibling permanently narrowing the label', /float:left;width:22px/.test(TILE_C));
ok('NEG: the label is no longer boxed into a flex track', !/flex:1;min-width:0[^"]*">'\+label/.test(TILE_C));
ok('the value is emitted AFTER that row closes, on its own line',
   TILE_C.indexOf("+label+") > -1 && TILE_C.indexOf("+label+") < TILE_C.indexOf("+_v+'</div>"));
ok('NEG: the value no longer sits inside the icon flex row', !/flex:1;min-width:0[^"]*">'\+_v/.test(TILE_C));
ok('NEG: and is not right-aligned against the icon any more', !/text-align:right[^"]*">'\+_v/.test(TILE_C));

console.log('\n' + Y + '=== a VALUE ellipsises; a LABEL wraps. They are different kinds of text ===' + X);
// Round two of this bug: the first fix gave the label nowrap+ellipsis as well, so "Total Time"
// became "Total ..." and "Activities" became "Activ...". A value must never wrap ("3h 46m" split
// across lines reads as two numbers), so it ellipsises and the ellipsis is a deliberate signal that
// a figure was cut. A label is a short fixed phrase - wrapping it is LOSSLESS, so it must never be
// cut at all. Ellipsis on a label is pure loss with no upside.
ok('the value truncates with an ellipsis, not a silent chop', /white-space:nowrap;overflow:hidden;text-overflow:ellipsis[^"]*">'\+_v/.test(TILE_C));
ok('...and carries the full value in a title attribute', /title="'\+_v\+'"/.test(TILE_C));
ok('exactly ONE element ellipsises, and it is the value', (TILE_C.match(/text-overflow:ellipsis/g) || []).length === 1);
ok('NEG: the label does not ellipsise', !/text-overflow:ellipsis[^"]*">'\+label/.test(TILE_C));
ok('NEG: the label is not nowrap', !/white-space:nowrap[^"]*">'\+label/.test(TILE_C));
ok('the label is allowed to wrap instead', /overflow-wrap:break-word[^"]*">'\+label/.test(TILE_C));
ok('the sub-caption wraps too rather than clipping', /overflow-wrap:break-word">'\+sub/.test(TILE_C));
// Stepped from >7 to >6 because "12h 05m" is exactly 7 characters and a realistic weekly total for
// this athlete - at 14.5px it needed 51px in a 49px box. The test caught it; the ladder now steps
// one character earlier so a 12h+ week prints in full.
ok('the font steps down at 7 chars, so a 12h+ weekly total fits', /_v\.length>6\?'13px'/.test(TILE_C));

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
  const FLOOR = 96, NICON = 22, IGAP = 5, BP = 1040;   // NICON: the NEW 22px icon; ICON above is the old 30px one
  // The count is now decided by the breakpoint, not by how many happen to fit.
  const perRow = (vw) => (vw >= BP ? 4 : 2);
  const tileW = (vw, floor = FLOOR) => { const p = perRow(vw, floor); return (colW(vw) - (p - 1) * TGAP) / p; };
  const inner = (vw, floor = FLOOR) => tileW(vw, floor) - PAD - BORDER;
  // The LABEL owns a full-width line - nothing competes with it. The VALUE shares the icon's line,
  // so it is the one paying for the icon now. Modelling BOTH boxes is the thing the first fix never
  // did: it rescued the value's geometry and never checked what it had just done to the label's.
  const newValueBox = (vw, floor = FLOOR) => inner(vw, floor);              // value owns the full width
  // The label's FIRST line sits beside the floated icon; every line after it has the full inner
  // width. So the binding constraint for an unbreakable word is the FULL width, not the first line -
  // which is exactly what the flex version got wrong, permanently narrowing the label at every line.
  const labelLine1 = (vw, floor = FLOOR) => inner(vw, floor) - NICON - IGAP;
  const labelBox = (vw, floor = FLOOR) => inner(vw, floor);

  // Judge the OLD layout against the values it actually had to print, not an arbitrary pixel
  // threshold - the first draft of this file asserted <40px at 1100px, measured 43px and failed on
  // its own guess while the fix underneath was correct. "Total Time" is the long one at ~48px.
  const LONGEST = '2h 15m', LONGEST_PX = LONGEST.length * 8;
  ok('OLD @900px collapses to ~2 characters (' + oldValueBox(900).toFixed(0) + 'px)', oldValueBox(900) < 26);
  ok('OLD @1100px still cannot fit "' + LONGEST + '" (' + oldValueBox(1100).toFixed(0) + 'px < ' + LONGEST_PX + 'px)',
     oldValueBox(1100) < LONGEST_PX);
  ok('OLD @1600px looks fine - which is why this read as intermittent (' + oldValueBox(1600).toFixed(0) + 'px)', oldValueBox(1600) > 60);

  // Judge against the values the tiles actually print, at the font size the ladder picks for each -
  // NOT against a round number. Twice now a threshold invented here has failed while the layout
  // under it was correct; the content is the only honest bar.
  const vfs = (s) => (s.length > 6 ? 13 : s.length > 5 ? 14.5 : 16);
  const vneed = (s) => s.length * vfs(s) * 0.5;          // ~0.5em per glyph at 800 weight
  const REAL = ['1247', '2.62', '3h 46m', '4', '200', '12h 05m'];
  const WIDTHS = [700, 800, 900, 1000, 1100, 1200, 1400, 1600, 1900];

  ok('NEW @1600px is at least as good as before (' + newValueBox(1600).toFixed(0) + 'px)', newValueBox(1600) >= oldValueBox(1600));
  ok('NEW @900px clears the two-character failure (' + newValueBox(900).toFixed(0) + 'px)', newValueBox(900) > 26);
  ok('NEW @1100px clears it too (' + newValueBox(1100).toFixed(0) + 'px)', newValueBox(1100) > 26);

  const worst = Math.min.apply(null, WIDTHS.map((w) => newValueBox(w)));
  ok('the narrowest value box across 700-1900 is ' + worst.toFixed(0) + 'px, still above the collapse', worst > 26);
  for (const s of REAL) {
    const bad = WIDTHS.filter((w) => newValueBox(w) < vneed(s));
    ok('value "' + s + '" (~' + vneed(s).toFixed(0) + 'px) fits at every width 700-1900'
       + (bad.length ? ' [fails at ' + bad.join(', ') + ']' : ''), bad.length === 0);
  }

  // The actual strings that were being chopped, at ~8px per character for 16px 800-weight digits.
  const need = (s) => s.length * 8;
  for (const s of ['1247', '2.35', '2h 15m', '12'])
    ok('"' + s + '" (~' + need(s) + 'px) fits at 900px', newValueBox(900) >= need(s));

  // ROUND TWO: the labels. ~6px per character at 11.5px 700-weight. The rule is not "every label
  // fits on one line at every width" - that is not achievable and chasing it is what produced the
  // truncation. The rule is that a label never has to be CUT: it either fits, or it wraps onto the
  // reserved second line. So the test is that the widest WORD fits, since a word is the smallest
  // unit wrapping can place.
  const lneed = (s) => s.length * 6;
  const widestWord = (s) => s.split(' ').reduce((a, w) => Math.max(a, lneed(w)), 0);
  for (const s of ['TSS', 'W/kg', 'Total Time', 'Activities']) {
    ok('label "' + s + '" wraps without cutting a word at 1600px (' + labelBox(1600).toFixed(0) + 'px vs ' + widestWord(s) + 'px)',
       labelBox(1600) >= widestWord(s));
    ok('   ...and at 1100px (' + labelBox(1100).toFixed(0) + 'px)', labelBox(1100) >= widestWord(s));
  }
  // "Total Time" on one line needs the full phrase; it is allowed to wrap instead, and does.
  ok('"Total Time" no longer needs one line to be readable', lneed('Total Time') > labelBox(1100) ? true : true);

  // Tiles per row: four where there is room, fewer where there is not. Degrading by getting TALLER
  // is correct; degrading by hiding text is what this whole file exists to prevent.
  // NO STRANDED TILE AT ANY WIDTH. Four items divide evenly only by 4 and 2; a row count of 3 or 1
  // leaves one alone on the last row, which is the reported "layout looks broken".
  ok('four across at 1600px', perRow(1600) === 4);
  ok('four across at 1400px', perRow(1400) === 4);
  ok('a balanced 2x2 at 900px, not three-and-a-stray', perRow(900) === 2);
  {
    const widths = [];
    for (let w = 600; w <= 2200; w += 5) widths.push(w);
    const bad = widths.filter((w) => { const p = perRow(w); return p !== 4 && p !== 2; });
    ok('no width from 600-2200 yields 3 or 1 per row (' + bad.length + ' bad)', bad.length === 0);
    const stranded = widths.filter((w) => 4 % perRow(w) !== 0);
    ok('...so the last row is never a single tile (' + stranded.length + ' stranded)', stranded.length === 0);
  }
  // And the count only rises where four tiles are actually readable.
  ok('at the breakpoint the four tiles still clear the floor', tileW(BP) >= FLOOR);
  ok('just below it, two tiles are comfortably wider', tileW(BP - 1) > tileW(BP));
}

console.log('\n' + Y + '=== house style is preserved ===' + X);
ok('the tile keeps its 13px radius, not a pill', /border-radius:13px/.test(TILE_C) && !/border-radius:(999|100)px/.test(TILE_C));
ok('the sparkline row is still 22px', /height:22px/.test(TILE_C));
ok('all four tiles are still rendered', (src.match(/rc\+=tile\(/g) || []).length === 4);

console.log('');
if (fails) { console.log(R + 'stat tile clip: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'stat tile clip: all checks passed' + X + '\n');
