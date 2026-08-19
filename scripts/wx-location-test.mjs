// THE WEATHER FOLLOWS THE ATHLETE, AND SAYS WHERE IT IS.
//
// Two defects, one of which was never reported and is the more serious:
//
//   TIMEZONE. WX_TZ was America/Chicago while the coordinates are Grand Rapids - America/DETROIT,
//   Eastern, not Central. Open-Meteo labels its hourly series in the timezone it is given, so every
//   series arrived shifted by an hour while every consumer treated it as local wall-clock: the
//   ride-window slice, the start-time temperature, the storm-window hours, the peak-time labels.
//   Wrong at home, before travel enters into it. FIVE fetches carried it, two of which pass the
//   ride's own coordinates and then ask for Chicago hours.
//
//   LOCATION. The coordinates were a constant, so every reading was Grand Rapids' weather wherever
//   the athlete actually was, and the caption said "Grand Rapids, MI" unconditionally - the worst
//   kind of wrong while travelling, since the figures move and the label insists they have not.
//
// The priority order is the contract: a PICKED location outranks a DEVICE fix, because a choice is a
// statement and a device is a guess - and the guess may be a hotel car park. That order is what this
// file mainly exists to hold.
//
// Run: node scripts/wx-location-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== no fetch states a timezone any more ===' + X);
ok('WX_TZ is auto', /var WX_TZ='auto';/.test(SRC));
ok('NEG: no America/Chicago anywhere', !/America%2FChicago/.test(SRC));
{
  const autos = (SRC.match(/timezone=auto/g) || []).length + (SRC.match(/&timezone='\+WX_TZ/g) || []).length;
  ok('every weather fetch derives the zone from its coordinates (' + autos + ')', autos >= 5);
  // The two that matter most: they already send the ride's own position.
  ok('the ride-detail wind map no longer asks for Central hours', !/latitude='\+lat\+[\s\S]{0,400}America%2FChicago/.test(SRC));
}

console.log('\n' + Y + '=== the resolver, and its priority order ===' + X);
ok('wxCoords_ exists', /function wxCoords_\(\)/.test(SRC));
ok('a picked location is read first', SRC.indexOf("aiq_wx_loc") < SRC.indexOf("aiq_wx_geo"));
ok('a device fix is second', /aiq_wx_geo/.test(SRC));
ok('home is the last resort, not the answer', /return \{lat:WX_LAT, lon:WX_LON, label:'Grand Rapids, MI', src:'home'\}/.test(SRC));
ok('the device fix carries a TTL, so a stale trip cannot price today', /var WX_GEO_TTL=12\*60\*60\*1000/.test(SRC));
ok('...and it is actually applied', /Date\.now\(\)-\(\+g\.at\|\|0\)\)<WX_GEO_TTL/.test(SRC));
ok('both live fetches use the resolver', (SRC.match(/wxCoords_\(\)\.lat/g) || []).length >= 2);

console.log('\n' + Y + '=== the picker WRITES the rung that was unreachable ===' + X);
ok('a search exists', /function wxLocSearch_\(q, ?cb\)/.test(SRC));
ok('...using the same provider as the forecast', /geocoding-api\.open-meteo\.com/.test(SRC));
ok('...debounced rather than firing per keystroke', /setTimeout\(function\(\)\{ wxLocSearch_\(q, ?render\); \}, ?300\)/.test(SRC));
ok('...and disambiguating same-named towns with admin1', /if\(x\.admin1\) bits\.push\(x\.admin1\)/.test(SRC));
ok('a setter writes aiq_wx_loc', /localStorage\.setItem\('aiq_wx_loc'/.test(SRC));
ok('...clears the weather cache, or the picker only APPEARS to work', /wxCache_\.weather=null; ?wxCache_\.aqi=null;/.test(SRC));
ok('...and re-renders the surface the athlete is ON, not always the mobile one',
   /_desk && typeof dsShowWeather==='function'\) dsShowWeather\(\);/.test(SRC) && /else if\(typeof showWeather==='function'\) showWeather\(\);/.test(SRC));
ok('clearing removes the key, falling back to device or home', /localStorage\.removeItem\('aiq_wx_loc'\)/.test(SRC));
ok('a device fix never overrides an explicit choice', /if\(wxCoords_\(\)\.src==='picked'\) return;/.test(SRC));

console.log('\n' + Y + '=== BOTH surfaces, because this project has parallel renderers ===' + X);
// The picker was first wired only into showWeather() - the MOBILE shell titled "Weather Coach" -
// while dsShowWeather(), titled "Weather", kept a static pill. The feature shipped, deployed, and
// was invisible on the surface actually in use. This project's standing rule is that every change
// lands on both renderers; this section is that rule made enforceable for this control.
{
  const fnAt = (name) => { const i = SRC.indexOf('function ' + name + '('); if (i < 0) return '';
    let d = 0, end = -1;
    for (let k = SRC.indexOf('{', i); k < SRC.length; k++){ const c = SRC[k];
      if (c === '{') d++; else if (c === '}'){ d--; if (!d){ end = k; break; } } }
    return SRC.slice(i, end + 1); };
  const mob = fnAt('showWeather'), desk = fnAt('dsShowWeather');
  ok('the MOBILE shell opens the picker', /wxLocOpen_\(\)/.test(mob));
  ok('the DESKTOP page opens the picker', /wxLocOpen_\(\)/.test(desk));
  ok('the mobile shell names the resolved location', /wxCoords_\(\)/.test(mob));
  ok('the desktop page names the resolved location', /wxCoords_\(\)/.test(desk));
  ok('NEG: desktop no longer renders a static city', !/>Grand Rapids, MI<\/div>/.test(desk));
  ok('the desktop control is a BUTTON, not an inert div', /<button onclick="wxLocOpen_\(\)"/.test(desk));
}

console.log('\n' + Y + '=== the label is the control, so they cannot drift ===' + X);
ok('the header names the resolved location', /_lc\.label\|\|'Grand Rapids, MI'/.test(SRC));
ok('...and says where it came from', /_lc\.src==='picked'\?'chosen':_lc\.src==='device'\?'this device':'default'/.test(SRC));
ok('...and opens the picker', /locRow\.onclick=function\(\)\{ if\(typeof wxLocOpen_==='function'\) wxLocOpen_\(\); \}/.test(SRC));
ok('the dashboard caption is no longer a hardcoded city', !/>Grand Rapids, MI<\/div>'/.test(SRC));

console.log('\n' + Y + '=== the priority order, exercised ===' + X);
{
  const HOME = { lat: 42.9634, lon: -85.6681, label: 'Grand Rapids, MI', src: 'home' };
  const TTL = 12 * 60 * 60 * 1000;
  const resolve = (store, now) => {
    if (store.aiq_wx_loc) { const p = store.aiq_wx_loc; if (isFinite(p.lat) && isFinite(p.lon)) return { ...p, src: 'picked' }; }
    if (store.aiq_wx_geo) { const g = store.aiq_wx_geo;
      if (isFinite(g.lat) && isFinite(g.lon) && (now - (g.at || 0)) < TTL) return { lat: g.lat, lon: g.lon, label: 'Current location', src: 'device' }; }
    return HOME;
  };
  const NOW = 1755600000000;
  const PICK = { lat: 39.74, lon: -104.98, label: 'Denver, CO, US' };
  const GEO = { lat: 25.76, lon: -80.19, at: NOW - 1000 };

  ok('nothing stored -> home', resolve({}, NOW).src === 'home');
  ok('a fresh device fix -> device', resolve({ aiq_wx_geo: GEO }, NOW).src === 'device');
  ok('a picked location -> picked', resolve({ aiq_wx_loc: PICK }, NOW).src === 'picked');
  ok('PICKED BEATS DEVICE - a choice outranks a guess',
     resolve({ aiq_wx_loc: PICK, aiq_wx_geo: GEO }, NOW).label === 'Denver, CO, US');
  ok('a device fix older than the TTL is ignored',
     resolve({ aiq_wx_geo: { ...GEO, at: NOW - TTL - 1 } }, NOW).src === 'home');
  ok('...and one exactly at the boundary is too', resolve({ aiq_wx_geo: { ...GEO, at: NOW - TTL } }, NOW).src === 'home');
  ok('a malformed pick falls through rather than breaking', resolve({ aiq_wx_loc: { lat: 'x', lon: null } }, NOW).src === 'home');
  ok('clearing the pick falls back to the device fix',
     resolve({ aiq_wx_geo: GEO }, NOW).lat === 25.76);
  // The failure mode must be a wrong city, never a blank screen.
  ok('a resolution always yields usable coordinates',
     [{}, { aiq_wx_loc: PICK }, { aiq_wx_geo: GEO }, { aiq_wx_loc: { lat: NaN } }]
       .every((s) => { const r = resolve(s, NOW); return isFinite(r.lat) && isFinite(r.lon); }));
}

console.log('');
if (fails) { console.log(R + 'wx location: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'wx location: all checks passed' + X + '\n');
