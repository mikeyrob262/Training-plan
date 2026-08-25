// WHY IS THE TABLE PALE WHEN THE CSS SAYS IT IS NOT?
// Reads the COMPUTED colour off real cells, and asks the browser which rule won.
import { spawn } from 'child_process';
import net from 'net';
const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9351;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const okp = await new Promise(res => { const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
    if (okp) return true; await wait(250);
  }
  return false;
}
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--remote-allow-origins=*','--window-size=1600,1000','about:blank'], {stdio:'ignore'});
let ws;
try {
  if (!await portUp(PORT)) throw new Error('no debug port');
  const t = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id:i, method:m, params:p||{}})); });
  const ev = async (x) => { const r = await send('Runtime.evaluate', {expression:x, returnByValue:true, awaitPromise:true});
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,600));
    return r.result && r.result.result && r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:1600, height:1000, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url: URL_ + '?p=' + Date.now() });
  await wait(3000);
  await ev(`(function(){ try{ localStorage.setItem('aiq_layout','desktop'); }catch(e){} return 1; })()`);
  await send('Page.reload', { ignoreCache: true });
  await wait(12000);
  for (let i = 0; i < 20; i++) { if (await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }

  await ev(`(function(){ dsShowLegacy(); return 1; })()`);
  await wait(1500);
  await ev(`(function(){ lgOpenSeason_('cyc', 2025); return 1; })()`);
  await wait(1800);

  const out = await ev(`(function(){
    var td=document.querySelector('.lg-t tbody td');
    var td2=document.querySelectorAll('.lg-t tbody td')[1];
    var th=document.querySelector('.lg-t th');
    var foot=document.querySelector('.lg-t tfoot td');
    var h=[].slice.call(document.querySelectorAll('#LEGACY-DS div')).filter(function(d){
      return (d.textContent||'').trim()==='Month by month'; })[0];
    var cs=function(el){ if(!el) return null; var c=getComputedStyle(el);
      return { text:(el.textContent||'').trim().slice(0,20), color:c.color, bg:c.backgroundColor,
               inline:el.getAttribute('style')||null, cls:el.className||null }; };
    // Which stylesheet rules actually match this cell?
    var rules=[];
    try{
      for(var i=0;i<document.styleSheets.length;i++){
        var sh=document.styleSheets[i], rs=null;
        try{ rs=sh.cssRules; }catch(e){ continue; }
        if(!rs) continue;
        for(var j=0;j<rs.length;j++){
          var r=rs[j];
          if(r.selectorText && /\\.lg-t\\b/.test(r.selectorText)) rules.push(r.selectorText+' { '+(r.style&&r.style.color?('color:'+r.style.color):'(no color)')+' }');
        }
      }
    }catch(e){ rules.push('ERR '+e.message); }
    return { bodyClass:document.body.className, bodyBg:getComputedStyle(document.body).backgroundColor,
             varHead:getComputedStyle(document.body).getPropertyValue('--d-head').trim(),
             varT2:getComputedStyle(document.body).getPropertyValue('--d-t2').trim(),
             varT4:getComputedStyle(document.body).getPropertyValue('--d-t4').trim(),
             td:cs(td), td2:cs(td2), th:cs(th), foot:cs(foot), heading:cs(h),
             nTables:document.querySelectorAll('.lg-t').length,
             matchedRules:rules };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) { console.error('FAILED: ' + (e && e.message || e)); }
finally { try { ws && ws.close(); } catch (e) {} try { chrome.kill(); } catch (e) {} }
