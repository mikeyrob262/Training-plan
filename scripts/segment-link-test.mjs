// The segment-card schematic links out to Strava's real segment map.
//
// The failure this guards against is not a broken link — it is a link that WORKS and lands on the
// wrong thing. https://www.strava.com/segments/ with a junk or missing id resolves to a generic
// page that renders fine, so a smoke test that only asks "did it 200?" passes while every card
// points at the same place. So the assertions here are about IDENTITY: this card, this segment id.
//
// Everything executable runs in SERVED form. The template literal eats one backslash level, and a
// source-form test would have passed the /\d+/ bug that shipped (see served-escape-test.mjs) — a
// digit check written as /^s\d+$/ in source is served as /^sd+$/, which accepts 'sd' and rejects
// 's123'. _saSegUrl_ avoids regex entirely for that reason; this proves the served build agrees.
//
// Run: node scripts/segment-link-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(label,cond)=>{ if(!cond)fails++;
  console.log('  '+(cond?G+'PASS'+X:R+'FAIL'+X)+'  '+label); };

const sandbox = asServed('var _SA_SINUOUS=1.15, _SA_SINUOUS_BAD=1.6;\n' + ex('_saSegUrl_') + ex('_saSketch_'));
const F = new Function(sandbox + '\nreturn {u:_saSegUrl_, s:_saSketch_};')();

console.log('\n'+C+'=== 1. the id on the card becomes the id in the URL ==='+X);
// Real keys, read off the live store. st.segments is keyed 's'+<Strava segment id> for all 2,017.
check('s10009961 -> that segment', F.u('s10009961'), 'https://www.strava.com/segments/10009961');
check('s1089677 (7-digit) -> that segment', F.u('s1089677'), 'https://www.strava.com/segments/1089677');
check('numeric id is preserved exactly', F.u('s'+'32095412'), 'https://www.strava.com/segments/32095412');

console.log('\n'+C+'=== 2. a bad id yields NO link, never a generic one ==='+X);
// Each of these would resolve to a real Strava page that looks like it worked.
check('empty', F.u(''), null);
check('null', F.u(null), null);
check('undefined', F.u(undefined), null);
check('bare "s" (no id)', F.u('s'), null);
check('unprefixed number', F.u('10009961'), null);
check('legacy k: key', F.u('k:2026-01-04_104_12345'), null);
check('leading zero is not a Strava id', F.u('s007'), null);
check('non-numeric tail', F.u('sabc'), null);
check('float', F.u('s12.5'), null);
check('negative', F.u('s-5'), null);
check('whitespace', F.u('s 123'), null);
check('injection attempt stays null', F.u('s1"onclick="x'), null);

console.log('\n'+C+'=== 3. the schematic actually carries the link ==='+X);
const withGeom = F.s({id:'s10009961', bearing:342.4, distMi:7.08});
ok('sketch wraps in an anchor', withGeom.indexOf('<a href="https://www.strava.com/segments/10009961"')===0);
ok('opens in a new tab', withGeom.indexOf('target="_blank"')>0);
ok('carries rel=noopener', withGeom.indexOf('rel="noopener noreferrer"')>0);
ok('still draws the schematic line', withGeom.indexOf('<svg')>0 && withGeom.indexOf('start &rarr; end')>0);
ok('shows a visible Strava affordance', withGeom.indexOf('Strava &#8599;')>0);
ok('exactly one href in the sketch', (withGeom.match(/href=/g)||[]).length===1);

console.log('\n'+C+'=== 4. the no-geometry card links too ==='+X);
// 75 of 2,017 segments have no stored coordinates. That card cannot draw anything — which makes
// reaching Strava's real map MORE valuable there, not less.
const noGeom = F.s({id:'s10246210', bearing:null});
ok('no-route-data card is still a link', noGeom.indexOf('<a href="https://www.strava.com/segments/10246210"')===0);
ok('...and still says no route data', noGeom.indexOf('no route data')>0);

console.log('\n'+C+'=== 5. an unlinkable card degrades to plain markup ==='+X);
const bad = F.s({id:'k:junk', bearing:120});
ok('no anchor when the id is unusable', bad.indexOf('<a ')<0);
ok('no dangling /segments/ URL', bad.indexOf('strava.com/segments')<0);
ok('the schematic still renders', bad.indexOf('<svg')===0);

console.log('\n'+C+'=== 6. no generic segment link anywhere in the source ==='+X);
// A hand-written link would bypass _saSegUrl_ and its id check. The builder's own return line is
// the one legitimate occurrence, so it is excluded by RANGE rather than by pattern — matching on
// the text would also excuse a copy of that same line pasted anywhere else.
const defStart = src.slice(0, src.indexOf('function _saSegUrl_(')).split('\n').length;
const defEnd = src.slice(0, matchBrace(src.indexOf('function _saSegUrl_('))).split('\n').length + 1;
const generic = src.split('\n')
  .map((L,i)=>[i+1,L])
  .filter(([n,L]) => L.indexOf('strava.com/segments')>=0 && !(n>=defStart && n<=defEnd) && !/^\s*\/\//.test(L));
ok('every segment URL is built by _saSegUrl_ ('+generic.length+' hand-written)', generic.length===0);
if(generic.length) generic.forEach(([n,L])=>console.log('      worker.js:'+n+'  '+L.trim().slice(0,90)));

console.log(fails ? '\n'+R+'segment link: '+fails+' FAILED'+X+'\n' : '\n'+G+'segment link: all checks passed'+X+'\n');
process.exit(fails?1:0);
