// Section 8 "Prescribed vs actual" — the redesigned layout.
//
// This was a PRESENTATION change: _trjRxDays_ and _trjRxLoad_/_trjRxTarget_ are untouched, so the
// first thing asserted is that the numbers rendered are exactly the ones the (unchanged) computation
// produced. Everything after that is structure.
//
// One renderer serves both surfaces (aiRenderTrajectory_ -> aiRenderTab_), so "both surfaces" here
// means the shared markup plus the media queries that reflow it, which are asserted directly.
//
// Run: node scripts/trj-section8-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, matchBrace(i)+1)+'\n'; }
function exVar(n){ let j=src.indexOf('var '+n+'='); if(j<0) j=src.indexOf('var '+n+' ='); if(j<0) throw new Error('missing var '+n);
  return src.slice(j, src.indexOf(';', j)+1)+'\n'; }

// Stubs for everything section 8 reaches that is not part of this change.
const stubs = `
  function aiEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function aiCard_(b){ return '<div class="aicard">'+b+'</div>'; }
  function _trjSec_(n,l,s){ return '<div class="sec" data-n="'+n+'"><span class="seclabel">'+l+'</span>'+(s?'<span class="secsub">'+s+'</span>':'')+'</div>'; }
  function _trjNote_(t){ return '<div class="note">'+aiEsc_(t)+'</div>'; }
  function _trjFmt_(t){ return 'Jul '+(t%31+1); }
  function _gcWeekPts_(weeks, pick){ return (weeks||[]).map(function(w,i){ var v=null; try{v=pick(w);}catch(e){} return {v:(v!=null&&isFinite(v))?v:null, lab:'wk '+(i+1)}; }); }
  var __R = null;
  function _trjRxDays_(){ return __R; }
  var __FIT = null;
  function _trjFit_(){ return __FIT; }
`;
let code = stubs + exVar('_TRJ_RX_MAX') + exVar('TRJ_RX_MIN');
for (const f of ['_trjRxCol_','_trjRxTier_','_trjChip_','_trjRxChart_','_trjMethod_','_trjSection8_']) code += ex(f);
const M = new Function(code + ';return {_trjSection8_,_trjRxChart_,_trjRxTier_,_trjRxCol_,setR:function(r){__R=r;},setFit:function(f){__FIT=f;}};')();

let fails = 0;
const R = '\x1b[31m', G = '\x1b[32m', X = '\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
}

// Fixture mirroring the mockup's numbers so the arithmetic is checkable by eye.
const WEEKS = [
  { t: 1, presc: 73,  actual: 62  },   //  85%  A bit lighter   green
  { t: 8, presc: 293, actual: 604 },   // 206%  Much harder     orange
  { t: 15, presc: 183, actual: 316 },  // 173%  Harder          orange
  { t: 22, presc: 220, actual: 195 },  //  89%  A bit lighter   green
  { t: 29, presc: 256, actual: 310 },  // 121%  Slightly harder orange
  { t: 36, presc: 183, actual: 339 },  // 185%  Much harder     orange
  { t: 43, presc: 264, actual: 365 },  // 138%  Harder          orange
  { t: 50, presc: 148, actual: 95  },  //  64%  Much lighter    blue
];
const FIX = { days: new Array(18).fill(0).map((_, i) => ({ t: i })), weeks: WEEKS, n: 18,
  presc: 1620, actual: 2286, over: 6, onPlan: 6, under: 6, missed: 2, unpriced: 0 };
M.setR(FIX);
M.setFit({ slope: -0.05 / 7, n: 8 });
const html = M._trjSection8_();

console.log('\n=== the computation is untouched — rendered numbers are the input numbers ===');
check('headline ratio is actual/prescribed', /141%/.test(html), true);
check('actual TSS printed verbatim', /2286/.test(html), true);
check('prescribed TSS printed verbatim', /1620/.test(html), true);
check('paired-day count printed verbatim', /18 paired days/.test(html), true);
check('_trjRxDays_ is still the only source', /var R=_trjRxDays_\(\);/.test(ex('_trjSection8_')), true);
check('load reader untouched', /function _trjRxLoad_\(r\)\{\s*\n\s*if\(!r\) return 0;/.test(src), true);

console.log('\n=== headline colour: brand orange for OVER, the other two states unchanged ===');
// Only the over state moves to #FC4C02 (the section-number chip's brand orange). The amber #f59e0b
// stays wherever the over/under BAND is the thing being encoded, so band colour means one thing.
const headOf = (h) => (h.match(/font-size:34px;font-weight:800;color:(#[0-9A-Fa-f]{6})/) || [])[1];
const tssOf  = (h) => (h.match(/font-size:19px;font-weight:800;color:(#[0-9A-Fa-f]{6})/) || [])[1];
const state = (presc, actual) => {
  M.setR(Object.assign({}, FIX, { presc: presc, actual: actual }));
  const h = M._trjSection8_();
  M.setR(FIX);
  return h;
};
const over = state(1620, 2286);      // 141% — the reported case
const onPlan = state(1620, 1650);    // 102%
const under = state(1620, 1150);     //  71%
check('over  -> brand orange headline', headOf(over), '#FC4C02');
check('on plan -> still green', headOf(onPlan), '#22c55e');
check('under -> still blue', headOf(under), '#60a5fa');
check('the amber is no longer on the headline at all', /color:#f59e0b;line-height:1\.05/.test(over), false);
console.log('  (and the band amber is still used where a BAND is what is meant)');
check('the actual-TSS total keeps the band colour', tssOf(over), '#f59e0b');
check('...which follows the band in the under state too', tssOf(under), '#60a5fa');
check('badges are untouched by this', M._trjRxTier_(206).c, '#f59e0b');
check('at-a-glance over-plan is untouched', /#f59e0b[^"]*">6<\/div>[\s\S]{0,120}?days over plan/.test(over), true);
check('only the headline reads headCol', (ex('_trjSection8_').match(/\+headCol\+/g) || []).length, 1);
check('the boundary is the same 115 the bands use', /var headCol=\(pct>115\)\?'#FC4C02':col;/.test(ex('_trjSection8_')), true);

console.log('\n=== top row: three columns ===');
check('grid class present', /class="trj-rx-top"/.test(html), true);
check('headline label', /ACTUAL LOAD AS A SHARE OF PRESCRIBED/.test(html), true);
check('the two stat boxes, with a vs between', /ACTUAL TSS[\s\S]*?>vs<[\s\S]*?PRESCRIBED TSS/.test(html), true);
check('chart column heading', /ACTUAL AS A SHARE OF PRESCRIBED, BY WEEK/.test(html), true);
check('at-a-glance column', /AT A GLANCE/.test(html), true);

console.log('\n=== at a glance: DAY counts, honestly labelled ===');
// The mockup says "weeks"; over/onPlan/under are day counts (6+6+6 = the 18 paired DAYS), so the
// label follows the data.
check('says days, not weeks', /days over plan/.test(html) && !/weeks over plan/.test(html), true);
check('over plan is orange, matching the badges', /#f59e0b[^"]*">6<\/div>[\s\S]{0,120}?days over plan/.test(html), true);
check('on plan is green', /#22c55e[^"]*">6<\/div>[\s\S]{0,120}?days on plan/.test(html), true);
check('under plan is blue', /#60a5fa[^"]*">6<\/div>[\s\S]{0,120}?days under plan/.test(html), true);

console.log('\n=== the chart ===');
const chart = M._trjRxChart_([{v:85,lab:'a'},{v:206,lab:'b'},{v:173,lab:'c'},{v:89,lab:'d'}]);
check('gridlines at 0/50/100/150/200', ['0%','50%','100%','150%','200%'].every((t) => chart.indexOf('>'+t+'<') >= 0), true);
check('a dashed reference line', /stroke-dasharray="4 3"/.test(chart), true);
check('labelled "on plan"', /100% \(on plan\)/.test(chart), true);
check('the area is filled, not just a line', /<path d="M[^"]*Z" fill="#f59e0b"/.test(chart), true);
check('split into an above and a below fill', /clip-path="url\(#[a-z0-9]+a\)"/.test(chart) && /clip-path="url\(#[a-z0-9]+b\)"/.test(chart), true);
check('a callout bubble on the peak', /206%<\/text>/.test(chart), true);
check('axis end labels', /Earliest week/.test(chart) && /This week/.test(chart), true);
check('one point is not a chart', M._trjRxChart_([{v:120,lab:'a'}]), '');
check('values past 200% clamp but still print true', /<text[^>]*>240%<\/text>/.test(M._trjRxChart_([{v:100,lab:'a'},{v:240,lab:'b'}])), true);

console.log('\n=== tiers: words are finer than colours, and never contradict them ===');
[[206,'Much harder','#f59e0b'],[185,'Much harder','#f59e0b'],[173,'Harder','#f59e0b'],
 [138,'Harder','#f59e0b'],[121,'Slightly harder','#f59e0b'],[100,'On plan','#22c55e'],
 [89,'A bit lighter','#22c55e'],[85,'A bit lighter','#22c55e'],[78,'A bit lighter','#60a5fa'],
 [64,'Much lighter','#60a5fa']]
 .forEach(([r, t, c]) => {
   check(r + '% -> ' + t, M._trjRxTier_(r).t, t);
   check(r + '% colour matches the existing band', M._trjRxTier_(r).c, c);
 });
check('the colour rule is the ORIGINAL 115/85 band', /return \(r>115\)\?'#f59e0b':\(\(r<85\)\?'#60a5fa':'#22c55e'\);/.test(ex('_trjRxCol_')), true);

console.log('\n=== the week table ===');
check('all 8 weeks rendered', (html.match(/of prescribed"/g) || []).length, 8);
check('column headers', ['WEEK OF','ACTUAL / PRESCRIBED','AS % OF PRESCRIBED'].every((h) => html.indexOf(h) >= 0), true);
check('raw pair shown', /604 \/ 293/.test(html), true);
check('badge shown', />206%<\/span>/.test(html), true);
check('plain-English label shown', />Much harder<\/span>/.test(html), true);

console.log('\n=== the filled bar: an OWNER-GRANTED, SCOPED exception to the no-pill-bar rule ===');
// Granted 2026-07-30 for THIS TABLE ONLY. Not a reversal: ai-cards-nobar-test.mjs and
// wkg-card-test.mjs still assert the rule everywhere else, and they run in the same preflight.
// What keeps this one honest is asserted below — a fixed shared scale, a stated ceiling, and a
// fill colour that cannot drift from the badge beside it.
const rowArea = html.slice(html.indexOf('WEEK-BY-WEEK'), html.indexOf('WHAT THIS MEANS'));
check('a filled bar is drawn per week', (rowArea.match(/height:100%;border-radius:4px;background:#/g) || []).length, 8);
check('its width is the ratio, not an arbitrary fill', /width:103\.0%|width:100\.0%/.test(rowArea), true);
check('on a track that is the full 0-200% scale', /height:7px;border-radius:4px;background:#1c2130;overflow:hidden/.test(rowArea), true);
check('the scale and its ceiling are stated', /shared 0&ndash;200% scale &middot; a full-width bar is 200% of prescribed/.test(html), true);
check('each bar carries the exact number as a title', /title="206% of prescribed"/.test(rowArea), true);
// Proportions: 200% must be the full track and everything else a true fraction of it.
const barW = (pct) => Math.max(0, Math.min(100, pct / 200 * 100)).toFixed(1);
check('206% clamps to a full bar', rowArea.indexOf('width:' + barW(206) + '%') >= 0, true);
check('64% is under a third', rowArea.indexOf('width:' + barW(64) + '%') >= 0, true);
check('85% and 89% are distinguishable', barW(85) !== barW(89), true);
console.log('\n=== ...and the bar cannot disagree with the badge next to it ===');
[[85,'#22c55e'],[206,'#f59e0b'],[64,'#60a5fa']].forEach(([r, c]) => {
  check(r + '% bar is ' + c, rowArea.indexOf('background:' + c + '"></div>') >= 0, true);
  check(r + '% badge is the same colour', M._trjRxTier_(r).c, c);
});
check('both read from the one colour function', /background:'\+tier\.c\+'"><\/div>/.test(ex('_trjSection8_')), true);
check('the exception is documented at the code, not just here', /owner-granted exception[\s\S]{0,200}THIS TABLE ONLY/.test(ex('_trjSection8_')), true);

console.log('\n=== bottom right + focus bar ===');
check('what this means', /WHAT THIS MEANS/.test(html), true);
check('the narrowing stat, restated', /THE GAP IS NARROWING/.test(html), true);
check('with the real slope', /5 points a week across 8 weeks/.test(html), true);
check('methodology moved here', /HOW THIS IS CALCULATED/.test(html), true);
check('methodology keeps the missed-day count', /\(2 here\)/.test(html), true);
check('focus bar', /Focus:<\/span> Stay consistent with your plan\./.test(html), true);

console.log('\n=== honest degrade ===');
M.setFit(null);
const noFit = M._trjSection8_();
check('no fit -> no narrowing claim', /THE GAP IS/.test(noFit), false);
check('...but the card still renders', /WEEK-BY-WEEK BREAKDOWN/.test(noFit), true);
M.setR({ days: [], weeks: [], n: 3, presc: 0, actual: 0, over: 0, onPlan: 0, under: 0, missed: 4, unpriced: 1 });
check('below the pairing threshold -> the note, not a ratio', /is the threshold for a ratio/.test(M._trjSection8_()), true);
M.setR(null);
check('no data at all -> nothing', M._trjSection8_(), '');

console.log('\n=== both surfaces: one renderer + the reflow rules ===');
check('section 8 is in the single trajectory renderer', /_trjSection7_\(\), _trjSection8_\(\)/.test(src), true);
check('no separate mobile section-8 renderer exists', (src.match(/function _trjSection8_/g) || []).length, 1);
check('3-col top row at desktop', /\.trj-rx-top\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.5fr\) minmax\(0,\.85fr\)/.test(src), true);
check('2-col bottom row at desktop', /\.trj-rx-bot\{display:grid;grid-template-columns:minmax\(0,1\.45fr\) minmax\(0,1fr\)/.test(src), true);
check('at 900px the glance column drops full-width and the bottom stacks', /@media\(max-width:900px\)\{\.trj-rx-top\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.2fr\)\}/.test(src), true);
check('at 620px everything is single column', /@media\(max-width:620px\)\{\.trj-rx-top\{grid-template-columns:1fr\}/.test(src), true);
check('the chart scales rather than fixing a pixel width', /style="width:100%;height:auto;display:block/.test(chart), true);
check('the scale column takes the slack so numbers cluster right',
  /\.trj-rx-tbl\{display:grid;grid-template-columns:auto minmax\(60px,1fr\) auto auto/.test(src), true);
// A true 390px viewport was measured via CDP device emulation (--window-size cannot go below the
// ~485px minimum window width, which made an early "mobile is broken" reading a screenshot artifact
// rather than a layout fault). These are the rules that keep the card inside it.
check('at 620px the bar SURVIVES, just tighter', /\.trj-rx-tbl\{grid-template-columns:auto minmax\(34px,1fr\) auto auto;gap:0 8px\}/.test(src), true);
check('below 440px it drops, because it is too short to read', /@media\(max-width:440px\)\{\.trj-rx-tbl\{grid-template-columns:auto 1fr auto\}\.trj-rx-mk\{display:none\}\}/.test(src), true);
check('the bar cells carry that class', (html.match(/class="trj-rx-mk"/g) || []).length, 10);
check('no nowrap on the table headers (that is what overflowed the card)',
  /ACTUAL \/ PRESCRIBED<\/div>/.test(html) && !/white-space:nowrap">ACTUAL \/ PRESCRIBED/.test(html), true);
check('the plain-English label survives to 340px, not 400',
  /@media\(max-width:340px\)\{\.trj-rx-tier\{display:none\}\}/.test(src), true);
check('the section header wraps so a subtitle cannot push it wide',
  /display:flex;align-items:center;flex-wrap:wrap;gap:4px 9px;margin:22px 0 10px/.test(src), true);

console.log('\n' + (fails ? R + fails + ' CHECK(S) FAILED' + X : G + 'trj-section8: all checks passed' + X));
process.exit(fails ? 1 : 0);
