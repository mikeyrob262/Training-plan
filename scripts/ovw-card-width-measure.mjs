// Card WIDTHS and internal slack on the Overview, measured.
//
// The report is that some cards look narrower than their neighbours and that others have empty space
// inside them. Those are two different defects - a card that is genuinely narrower than its column,
// and a card at full width whose CONTENT does not fill it - and they have different fixes. So this
// measures both: the card box against its column, and the widest thing inside the card against the
// card's own content box.
import { spawn } from 'child_process';
import net from 'net';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9491;
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = process.env.FIT_URL || 'https://training-plan.mgrobinson07.workers.dev/';

async function up(p, t = 60) {
  for (let i = 0; i < t; i++) {
    const o = await new Promise(res => {
      const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
    });
    if (o) return true;
    await wait(250);
  }
  return false;
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  if (!await up(PORT)) throw new Error('no port');
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  ws = new WebSocket(list.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?w=' + Date.now() });
  await wait(2500);
  await ev("(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()");
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 70; i++) {
    if (await ev("typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0")) break;
    await wait(1000);
  }
  await wait(6000);
  for (let i = 0; i < 14; i++) {
    await ev("(function(){try{ if(typeof dsShowAthleteIntel==='function') dsShowAthleteIntel(); }catch(e){} return 1})()");
    await wait(800);
    if (await ev("!!document.querySelector('.ov-bal')")) break;
  }

  const probe = [
    "(function(){",
    " var bal=document.querySelector('.ov-bal'); if(!bal) return ['no overview'];",
    " var WS=[String.fromCharCode(32),String.fromCharCode(9),String.fromCharCode(10),String.fromCharCode(13)];",
    " var txt=function(el){ var s=String(el.textContent||'');",
    "  WS.forEach(function(w){ s=s.split(w).join(' '); });",
    "  while(s.indexOf('  ')>=0) s=s.split('  ').join(' ');",
    "  return s.trim(); };",
    " var out=[];",
    " [].slice.call(bal.children).forEach(function(col,ci){",
    "  var cw=col.getBoundingClientRect().width;",
    "  out.push('COLUMN '+ci+'  width '+Math.round(cw));",
    "  [].slice.call(col.children).forEach(function(card){",
    "   var r=card.getBoundingClientRect(), cs=getComputedStyle(card);",
    "   var padL=parseFloat(cs.paddingLeft)||0, padR=parseFloat(cs.paddingRight)||0;",
    "   var inner=r.width-padL-padR;",
    "   // The widest thing actually drawn inside, so a card at full width whose CONTENT stops short",
    "   // is distinguishable from a card that is genuinely narrow.",
    "   var widest=0, deepest=null;",
    "   var scan=function(el,d){",
    "    [].slice.call(el.children).forEach(function(c){",
    "     var q=c.getBoundingClientRect();",
    "     if(q.height>4 && q.width>widest){ widest=q.width; deepest=c; }",
    "     if(d<3) scan(c,d+1);",
    "    });",
    "   };",
    "   scan(card,0);",
    "   // VERTICAL SLACK: the gap between the bottom of the last thing drawn and the card's own",
    "   // content bottom. That is the empty space a reader sees at the foot of a card.",
    "   var kids=[].slice.call(card.children).filter(function(c){ return c.getBoundingClientRect().height>2; });",
    "   var padT=parseFloat(cs.paddingTop)||0, padB=parseFloat(cs.paddingBottom)||0;",
    "   var lastBottom=kids.length?kids[kids.length-1].getBoundingClientRect().bottom:r.top+padT;",
    "   var vslack=Math.round((r.bottom-padB)-lastBottom);",
    "   out.push('  card '+Math.round(r.width)+'w x '+Math.round(r.height)+'h'",
    "    +'  vSLACK '+vslack",
    "    +'  pad '+Math.round(padL)+'/'+Math.round(padR)",
    "    +'  inner '+Math.round(inner)",
    "    +'  widest child '+Math.round(widest)",
    "    +'  SLACK '+Math.round(inner-widest)",
    "    +'  ::  '+txt(card).slice(0,34));",
    "  });",
    " });",
    " return out;",
    "})()"
  ].join(String.fromCharCode(10));
  const rows = await ev(probe);
  console.log(Array.isArray(rows) ? rows.join(String.fromCharCode(10)) : JSON.stringify(rows));
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
