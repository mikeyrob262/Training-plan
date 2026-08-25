// MEASURE THE DEPLOYED PAGES IN A REAL BROWSER. Reasoning about flex rules is how the stat-tile clip
// cost two needless CSS ships; measure the box.
//
// Covers the four surfaces this pass touched, at a desktop and a phone width:
//   Legacy season rail -> a season detail (month table + the full activity list)
//   Run Training       -> Running Trajectory, the condensed stat strips, the drift card
//
// THREE TRAPS THIS HARNESS EXISTS TO NOT FALL INTO:
//   1 isDesktop() reads localStorage 'aiq_layout' BEFORE the width check and returns early, so a
//     stranded 'mobile' renders 480px in a 1600px window and no reload clears it. Set it EXPLICITLY
//     per run rather than trusting the viewport.
//   2 The browser can be running older code than the server. Read window.__BUILD__ and assert the
//     new functions exist IN THE TAB before measuring anything.
//   3 A container that scrolls sideways is the failure, not a wide child: wide tables are SUPPOSED
//     to scroll inside their own box. So the assertion is that the PAGE never scrolls sideways
//     while the table wrapper may.
//
// Run: node scripts/legacy-run-layout-measure.mjs [url]
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.layout-shots');
const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const info = (l) => console.log('  ' + Y + '·' + X + '     ' + l);

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const okp = await new Promise(res => { const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
    if (okp) return true; await wait(250);
  }
  return false;
}

try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--remote-allow-origins=*','--window-size=1600,1000','about:blank'], {stdio:'ignore'});
let ws;
try {
  if (!await portUp(PORT)) throw new Error('chrome did not open the debug port');
  const targets = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id:i, method, params: params||{}})); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 900));
    return r.result && r.result.result && r.result.result.value;
  };
  const shot = async (name) => {
    try {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (r.result && r.result.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
    } catch (e) {}
  };

  await send('Page.enable'); await send('Runtime.enable');

  // The measuring toolkit, injected once per navigation. Returns RECTS, never computed styles.
  const KIT = `
    window.__M=function(sel){ var el=(typeof sel==='string')?document.querySelector(sel):sel; if(!el) return null;
      var b=el.getBoundingClientRect();
      return { x:Math.round(b.x), right:Math.round(b.right), w:Math.round(b.width),
               y:Math.round(b.y), bottom:Math.round(b.bottom), h:Math.round(b.height),
               sw:el.scrollWidth, cw:el.clientWidth, sh:el.scrollHeight, ch:el.clientHeight,
               overX:(el.scrollWidth>el.clientWidth+1) }; };
    // A cell whose CONTENT is wider than its box is a silent clip - the failure mode that made a
    // stat tile read "12" when the number was 12.4. Checked on the leaf that holds the text.
    window.__CLIP=function(root, sel){
      return [].slice.call((root||document).querySelectorAll(sel)).map(function(el){
        return { text:(el.textContent||'').trim().slice(0,24), w:Math.round(el.getBoundingClientRect().width),
                 sw:el.scrollWidth, cw:el.clientWidth, clipped:(el.scrollWidth>el.clientWidth+1) };
      });
    };
    window.__PAGEWIDE=function(){
      var de=document.documentElement, b=document.body;
      return { docOverX:(de.scrollWidth>de.clientWidth+1), bodyOverX:(b.scrollWidth>b.clientWidth+1),
               deSW:de.scrollWidth, deCW:de.clientWidth };
    };
    'kit';
  `;

  async function boot(width, height, layout, mobileFlag) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobileFlag });
    await send('Page.navigate', { url: URL_ + '?probe=' + Date.now() });
    await wait(3000);
    // Trap 1: pin the layout BEFORE the app decides, then reload so isDesktop() reads it at boot.
    await evalJS(`(function(){ try{ localStorage.setItem('aiq_layout', ${JSON.stringify(layout)}); }catch(e){} return 1; })()`);
    await send('Page.reload', { ignoreCache: true });
    await wait(11000);
    for (let i = 0; i < 20; i++) {
      const p = await evalJS(`(function(){ try{ return !!(typeof _storeV2Runs!=='undefined' && _storeV2Runs && _storeV2Runs.length); }catch(e){ return false; } })()`);
      if (p) break;
      await wait(2500);
    }
    await evalJS(KIT);
  }

  // ============ TRAP 2: is the TAB running the new code? ============
  await boot(1600, 1000, 'desktop', false);
  console.log('\n' + Y + '=== the tab, not the server ===' + X);
  const tab = await evalJS(`(function(){
    return { build:(typeof window.__BUILD__!=='undefined'?String(window.__BUILD__):'(none)'),
             detail:(typeof _lgSeasonDetailHTML_), rt:(typeof _rtCardHTML_),
             verdict:(typeof _runDriftVerdict_), keep:(typeof _runRemoveKeepScroll_),
             layout:(typeof isDesktop==='function'?isDesktop():'?'),
             w:innerWidth };
  })()`);
  info('__BUILD__ ' + tab.build + ' · viewport ' + tab.w + ' · isDesktop() ' + tab.layout);
  ok('the TAB has the season detail', tab.detail === 'function');
  ok('the TAB has the running trajectory', tab.rt === 'function');
  ok('the TAB has the drift verdict', tab.verdict === 'function');
  ok('the TAB has the scroll-preserving dismiss', tab.keep === 'function');
  ok('the desktop shell is what rendered', tab.layout === true);
  if (tab.detail !== 'function') throw new Error('browser is running older code than the server - stop and re-check the deploy');

  // ================= DESKTOP: LEGACY =================
  console.log('\n' + Y + '=== desktop 1600px · Legacy season rail ===' + X);
  await evalJS(`(function(){ dsShowLegacy(); return 1; })()`);
  await wait(2500);
  await shot('desktop-legacy-rail');
  const railD = await evalJS(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.lg-scard'));
    return { page:__PAGEWIDE(), nCards:cards.length,
             allButtons:cards.every(function(c){ return c.tagName==='BUTTON'; }),
             cardBoxes:cards.slice(0,4).map(function(c){ var b=c.getBoundingClientRect();
               return { y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height),
                        label:(c.getAttribute('aria-label')||'') }; }),
             rails:['cyc','run'].map(function(k){ var m=__M('#lg-hs-'+k); return m?{k:k, overX:m.overX, w:m.w}:null; }),
             hint:(document.body.innerText.indexOf('Open a season')>=0) };
  })()`);
  ok('the page does not scroll sideways', !railD.page.docOverX && !railD.page.bodyOverX);
  ok('season cards rendered as real buttons', railD.nCards > 0 && railD.allButtons);
  ok('the rail scrolls horizontally on purpose', railD.rails.filter(Boolean).some(r => r.overX));
  ok('the header tells the reader they open', railD.hint);
  info(railD.nCards + ' cards, first: ' + JSON.stringify(railD.cardBoxes[0]));

  console.log('\n' + Y + '=== desktop · a season detail (2025 cycling) ===' + X);
  await evalJS(`(function(){ lgOpenSeason_('cyc', 2025); return 1; })()`);
  await wait(2000);
  await shot('desktop-legacy-season-2025');
  const detD = await evalJS(`(function(){
    var tw=[].slice.call(document.querySelectorAll('.lg-tw'));
    var tables=[].slice.call(document.querySelectorAll('.lg-t'));
    var arows=document.querySelectorAll('.lg-arow');
    var wrap=document.querySelector('#ds-content > div');
    return { page:__PAGEWIDE(),
             back:!!document.querySelector('.lg-back'),
             nWrappers:tw.length, nTables:tables.length,
             wrapperBoxes:tw.map(function(w){ var m=__M(w); return { w:m.w, sw:m.sw, cw:m.cw, overX:m.overX }; }),
             tableWiderThanWrapper:tw.map(function(w,i){ var t=tables[i]; if(!t) return null;
               return Math.round(t.getBoundingClientRect().width) - Math.round(w.getBoundingClientRect().width); }),
             clickable:arows.length,
             monthRows:document.querySelectorAll('.lg-t tbody tr').length,
             cellClips:__CLIP(document, '.lg-t td').filter(function(c){ return c.clipped; }).length,
             totalH:wrap?wrap.scrollHeight:null,
             txt:document.body.innerText.slice(0,0) };
  })()`);
  ok('the page still does not scroll sideways', !detD.page.docOverX && !detD.page.bodyOverX);
  ok('there is a way back to the rail', detD.back);
  ok('both tables rendered', detD.nTables === 2 && detD.nWrappers === 2);
  ok('no table cell is silently clipped', detD.cellClips === 0);
  ok('the activity rows are clickable', detD.clickable > 0);
  info('wrappers: ' + JSON.stringify(detD.wrapperBoxes) + '  clickable rows: ' + detD.clickable);

  console.log('\n' + Y + '=== desktop · a season detail (2019 running, 220 activities) ===' + X);
  await evalJS(`(function(){ lgCloseSeason_(); return 1; })()`);
  await wait(1200);
  await evalJS(`(function(){ lgOpenSeason_('run', 2019); return 1; })()`);
  await wait(2500);
  await shot('desktop-legacy-season-2019-run');
  const runSeason = await evalJS(`(function(){
    return { page:__PAGEWIDE(),
             rows:document.querySelectorAll('.lg-t tbody tr').length,
             arows:document.querySelectorAll('.lg-arow').length,
             clips:__CLIP(document,'.lg-t td').filter(function(c){ return c.clipped; }).length,
             saysRate:(document.body.innerText.indexOf('open in full')>=0),
             noElevCol:(document.body.innerText.indexOf('Ft climbed')<0) };
  })()`);
  ok('the long season does not break the page', !runSeason.page.docOverX && !runSeason.page.bodyOverX);
  ok('no clipped cells across 220 rows', runSeason.clips === 0);
  ok('the link rate is stated on the page', runSeason.saysRate);
  ok('NEG: running shows no elevation column', runSeason.noElevCol);
  info(runSeason.rows + ' table rows, ' + runSeason.arows + ' openable');

  // ================= DESKTOP: RUN TRAINING =================
  console.log('\n' + Y + '=== desktop · Run Training ===' + X);
  await evalJS(`(function(){ lgCloseSeason_(); dsShowRun(); return 1; })()`);
  await wait(3500);
  await shot('desktop-run-training');
  const runD = await evalJS(`(function(){
    var body=document.getElementById('DS-RUN-BODY');
    var txt=document.body.innerText;
    // innerText, NOT textContent: the labels are uppercased by text-transform, which is a RENDERING
    // property. textContent returns the source string ("Miles YTD") and the uppercase match finds
    // nothing - a probe bug that reads exactly like a missing element.
    var strips=[].slice.call(document.querySelectorAll('#DS-RUN-BODY > div')).filter(function(d){
      var t=(d.innerText||'').toUpperCase();
      return t.indexOf('MILES YTD')>=0 || t.indexOf('LONGEST RUN')>=0; });
    var toggles=document.querySelectorAll('[data-rtrange]');
    var svg=document.querySelector('#DS-RUN-BODY svg[viewBox="0 0 600 150"]');
    return { page:__PAGEWIDE(),
             hasTrajectory:(txt.indexOf('RUNNING TRAJECTORY')>=0 || txt.indexOf('Running Trajectory')>=0),
             nToggles:toggles.length,
             ridge:svg?__M(svg):null,
             nStrips:strips.length,
             stripBoxes:strips.map(function(s){ var m=__M(s); return { w:m.w, h:m.h, overX:m.overX }; }),
             stripClips:__CLIP(body,'#DS-RUN-BODY div[style*="white-space:nowrap"]').filter(function(c){ return c.clipped; }),
             // The four cleanup outcomes, read off the rendered page.
             noMap:(document.querySelectorAll('#DS-RUN-BODY .leaflet-container').length===0),
             noLoadMapBtn:(txt.indexOf('Load GPS Map')<0),
             noGrowth:(txt.indexOf('Cumulative miles')<0 && txt.indexOf('Running growth')<0),
             tenkAfterPB:(function(){ var a=txt.indexOf('Personal Bests'), b=txt.indexOf('10k race pace');
               return (a>=0 && b>a); }),
             driftVerdict:(txt.indexOf('Nothing about the shin is recorded')>=0),
             bodyH:body?body.scrollHeight:null };
  })()`);
  ok('the page does not scroll sideways', !runD.page.docOverX && !runD.page.bodyOverX);
  ok('the Running Trajectory card is on the page', runD.hasTrajectory);
  ok('the range toggle has all five ranges', runD.nToggles === 5);
  ok('the ridge SVG actually drew', !!runD.ridge && runD.ridge.h > 100);
  ok('both stat strips rendered', runD.nStrips === 2);
  ok('neither strip overflows its box', runD.stripBoxes.every(s => !s.overX));
  ok('no stat value is silently clipped', runD.stripClips.length === 0);
  ok('the GPS mini-map is gone', runD.noMap);
  ok('...and so is the Load GPS Map button', runD.noLoadMapBtn);
  ok('the growth chart is off this page', runD.noGrowth);
  ok('10k race pace sits after Personal Bests', runD.tenkAfterPB);
  ok('the drift card carries its verdict', runD.driftVerdict);
  info('ridge ' + JSON.stringify(runD.ridge) + ' · strips ' + JSON.stringify(runD.stripBoxes));
  if (runD.stripClips.length) console.log('    ' + R + JSON.stringify(runD.stripClips) + X);

  // The range toggle must actually repaint.
  console.log('\n' + Y + '=== desktop · the range toggle repaints ===' + X);
  const beforeTxt = await evalJS(`(function(){ var t=document.body.innerText; var i=t.indexOf('vs 90 days ago'); return i>=0; })()`);
  await evalJS(`(function(){ var els=document.querySelectorAll('[data-rtrange]');
    for(var i=0;i<els.length;i++) if(els[i].getAttribute('data-rtrange')==='1Y'){ els[i].click(); break; } return 1; })()`);
  await wait(3000);
  const afterTxt = await evalJS(`(function(){ var t=document.body.innerText;
    return { yr:(t.indexOf('vs a year ago')>=0), old:(t.indexOf('vs 90 days ago')>=0),
             stillThere:(t.indexOf('Running Trajectory')>=0 || t.indexOf('RUNNING TRAJECTORY')>=0) }; })()`);
  ok('90D was the default', beforeTxt);
  ok('clicking 1Y repaints to the year view', afterTxt.yr && !afterTxt.old);
  ok('...and the card survives the repaint', afterTxt.stillThere);
  await shot('desktop-run-training-1Y');

  // ================= MOBILE =================
  console.log('\n' + Y + '=== mobile 390px · Legacy ===' + X);
  await boot(390, 844, 'mobile', true);
  const mtab = await evalJS(`(function(){ return { d:(typeof isDesktop==='function'?isDesktop():'?'), w:innerWidth }; })()`);
  ok('the mobile shell is what rendered', mtab.d === false);
  await evalJS(`(function(){ showLegacy(); return 1; })()`);
  await wait(2500);
  await shot('mobile-legacy-rail');
  await evalJS(`(function(){ lgOpenSeason_('run', 2019); return 1; })()`);
  await wait(2500);
  await shot('mobile-legacy-season-2019');
  const mLg = await evalJS(`(function(){
    var sheet=document.getElementById('LEGACY');
    // Found by SCROLLABILITY, not by a style-attribute substring: the browser reserialises cssText
    // as "overflow-y: auto" with a space, so the substring selector matches nothing and the check
    // silently compares against null.
    var body=null;
    if(sheet){ [].slice.call(sheet.querySelectorAll('div')).forEach(function(d){
      if(!body && d.scrollHeight>d.clientHeight+1 && getComputedStyle(d).overflowY==='auto') body=d; }); }
    return { page:__PAGEWIDE(), sheet:!!sheet,
             bodyOverX:body?(body.scrollWidth>body.clientWidth+1):null,
             wrappers:[].slice.call(document.querySelectorAll('.lg-tw')).map(function(w){ var m=__M(w);
               return { w:m.w, sw:m.sw, overX:m.overX }; }),
             clips:__CLIP(document,'.lg-t td').filter(function(c){ return c.clipped; }).length,
             back:!!document.querySelector('.lg-back') };
  })()`);
  ok('the phone page does not scroll sideways', !mLg.page.docOverX && !mLg.page.bodyOverX);
  ok('the sheet body does not scroll sideways either', mLg.bodyOverX === false);
  ok('the wide tables scroll inside their own box', mLg.wrappers.every(w => w.overX));
  ok('no cell is clipped at 390px', mLg.clips === 0);
  ok('there is a way back', mLg.back);
  info('table wrappers at 390px: ' + JSON.stringify(mLg.wrappers));

  console.log('\n' + Y + '=== mobile 390px · Run Training ===' + X);
  await evalJS(`(function(){ var l=document.getElementById('LEGACY'); if(l) l.remove(); renderRun(); return 1; })()`);
  await wait(3500);
  await shot('mobile-run-training');
  const mRun = await evalJS(`(function(){
    var scr=document.getElementById('RUN-SCREEN');
    var txt=scr?scr.innerText:'';
    // Same innerText rule as desktop, and the style attribute is matched loosely because cssText
    // normalises "flex-wrap:wrap" to "flex-wrap: wrap" with a space when the browser reserialises it.
    var strips=[].slice.call(scr.querySelectorAll('div')).filter(function(d){
      var t=(d.innerText||'').toUpperCase();
      return (t.indexOf('MILES YTD')>=0 || t.indexOf('LONGEST RUN')>=0) && t.length<120; });
    return { screen:!!scr, page:__PAGEWIDE(),
             scrOverX:scr?(scr.scrollWidth>scr.clientWidth+1):null,
             hasTrajectory:(txt.indexOf('RUNNING TRAJECTORY')>=0 || txt.indexOf('Running Trajectory')>=0),
             nToggles:scr.querySelectorAll('[data-rtrange]').length,
             ridgeH:(function(){ var s=scr.querySelector('svg[viewBox="0 0 600 150"]'); return s?Math.round(s.getBoundingClientRect().height):null; })(),
             nStrips:strips.length,
             stripRows:strips.map(function(s){ return { h:Math.round(s.getBoundingClientRect().height), overX:(s.scrollWidth>s.clientWidth+1) }; }),
             clips:__CLIP(scr,'div[style*="white-space:nowrap"]').filter(function(c){ return c.clipped; }),
             noMap:(scr.querySelectorAll('.leaflet-container').length===0),
             driftVerdict:(txt.indexOf('Nothing about the shin is recorded')>=0),
             totalH:scr.scrollHeight };
  })()`);
  ok('the run screen mounted', mRun.screen);
  ok('it does not scroll sideways', mRun.scrOverX === false && !mRun.page.docOverX);
  ok('the trajectory card is on mobile too', mRun.hasTrajectory);
  ok('the range toggle is there', mRun.nToggles === 5);
  ok('the ridge drew', mRun.ridgeH > 100);
  ok('both stat strips rendered', mRun.nStrips === 2);
  ok('neither strip overflows at 390px', mRun.stripRows.every(s => !s.overX));
  ok('no stat value clipped at 390px', mRun.clips.length === 0);
  ok('no map on mobile either', mRun.noMap);
  ok('the drift verdict is on mobile too', mRun.driftVerdict);
  info('strip heights ' + JSON.stringify(mRun.stripRows) + ' · ridge ' + mRun.ridgeH + 'px · page ' + mRun.totalH + 'px');
  if (mRun.clips.length) console.log('    ' + R + JSON.stringify(mRun.clips) + X);

  // ============ THE "NOT YET" SCROLL BUG, FOR REAL ============
  console.log('\n' + Y + '=== mobile · "Not yet" does not move the page ===' + X);
  const jump = await evalJS(`(function(){
    var scr=document.getElementById('RUN-SCREEN');
    var card=document.getElementById('run-rung-no');
    if(!card) return { skipped:'the run-ahead card is not showing' };
    var raCard=card.closest('div[style*="border-radius:14px"]');
    // Scroll well past the card, then note what is under a fixed point on screen.
    scr.scrollTop=420;
    var before=scr.scrollTop;
    var probe=document.elementFromPoint(200, 500);
    var probeTextBefore=probe?(probe.textContent||'').trim().slice(0,40):'';
    var probeYBefore=probe?Math.round(probe.getBoundingClientRect().top):null;
    card.click();
    var after=scr.scrollTop;
    var probeYAfter=(probe&&probe.isConnected)?Math.round(probe.getBoundingClientRect().top):null;
    return { skipped:null, before:before, after:after, moved:(before-after),
             cardGone:!(raCard&&raCard.isConnected),
             probeText:probeTextBefore, probeYBefore:probeYBefore, probeYAfter:probeYAfter,
             shiftPx:(probeYBefore!=null&&probeYAfter!=null)?(probeYAfter-probeYBefore):null };
  })()`);
  if (jump.skipped) {
    info('SKIPPED: ' + jump.skipped);
  } else {
    ok('the card is actually dismissed', jump.cardGone);
    // THE REAL TEST: not that scrollTop is unchanged - it must change, by exactly the height that
    // vanished - but that the content the reader was LOOKING AT stays where it was on screen.
    ok('the content under the reader does not move', jump.shiftPx !== null && Math.abs(jump.shiftPx) <= 2);
    ok('scrollTop was compensated, not left alone', jump.moved > 0);
    info('scrollTop ' + jump.before + ' -> ' + jump.after + ' (compensated ' + jump.moved + 'px); ' +
         'content "' + jump.probeText + '" moved ' + jump.shiftPx + 'px');
  }
  await shot('mobile-run-training-dismissed');

  console.log('');
  console.log('screenshots -> ' + OUT);
  console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'all layout checks passed' + X));
} catch (e) {
  console.error(R + 'FAILED: ' + (e && e.message || e) + X);
  fails++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
process.exit(fails ? 1 : 0);
