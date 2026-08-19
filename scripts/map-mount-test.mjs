// A LEAFLET MAP MOUNTS ONCE PER CONTAINER, AND A SECOND MOUNT MUST NOT THROW.
//
// Reported repeatedly as "the map is blank again", intermittent, cleared by a reload. It was never
// the data and never the tiles:
//
//   L.map(id) THROWS 'Map container is already initialized.' when the div still carries a
//   _leaflet_id. renderRideMap_ called it bare, so the throw escaped mid-function. The athlete got
//   no map, no route, and NOT EVEN the 'GPS data unavailable' fallback - that fallback runs on a
//   null RETURN and never on an exception. A silent blank box.
//
// It is intermittent because it needs the NODE to survive between renders. A surface that rebuilds
// its innerHTML hands over a fresh div and works; ride -> ride navigation, a re-render storm, or two
// armed mount timers reuse the same node and throw. Reload always "fixes" it - the tell that the
// container, not the ride, is the variable.
//
// This is the SECOND sizing/lifecycle bug on this renderer. The first was a zero-size mount, fixed
// with a ResizeObserver, and that fix is asserted still intact here: the two are independent, and
// the RO does nothing for a map that never got constructed.
//
// Run: node scripts/map-mount-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

function matchBrace(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const i0 = src.indexOf('function renderRideMap_(');
if (i0 < 0) { console.log(R + 'renderRideMap_ missing' + X); process.exit(1); }
const FN = src.slice(i0, matchBrace(i0) + 1);
// Strip comments so an assertion counts CODE, not prose that happens to quote it. Every guard in
// this file has been broken once by a comment mentioning the thing it greps for.
const CODE = FN.replace(/^\s*\/\/.*$/gm, '');

console.log('\n' + Y + '=== the previous map on this container is torn down first ===' + X);
ok('a registry keyed by container id exists', /window\._rideMapReg_/.test(CODE));
ok('...and the prior instance is removed', /_oldMap\s*=\s*window\._rideMapReg_\[mapId\]/.test(CODE) && /_oldMap\.remove\(\)/.test(CODE));
ok('...before the new map is constructed',
   CODE.indexOf('_oldMap.remove()') < CODE.indexOf('L.map(mapId'));
ok('a stale stamp left by an innerHTML replacement is cleared too', /_mc\._leaflet_id\s*=\s*null/.test(CODE));
ok('...and that clearing also happens BEFORE construction',
   CODE.indexOf('_mc._leaflet_id=null') > -1 && CODE.indexOf('_mc._leaflet_id=null') < CODE.indexOf('L.map(mapId'));
ok('the new map is registered for the next render to find', /window\._rideMapReg_\[mapId\]\s*=\s*map/.test(CODE));
ok('...and deregisters itself on unload, so the registry cannot leak', /delete window\._rideMapReg_\[mapId\]/.test(CODE));

console.log('\n' + Y + '=== a mount failure is LOUD and returns null, never an escaping throw ===' + X);
ok('the construction is wrapped', /try\{[\s\S]{0,120}map=L\.map\(mapId/.test(CODE));
ok('...it logs which container failed', /\[ridemap\] mount failed for/.test(CODE));
ok('...and returns null so the caller\'s own fallback runs', /mount failed for[\s\S]{0,160}return null/.test(CODE));
// The exact shape that caused the silent blank must not come back.
ok('NEG: L.map is no longer called bare', !/^\s*var map=L\.map\(mapId/m.test(CODE));

console.log('\n' + Y + '=== the earlier zero-size fix is untouched ===' + X);
ok('the ResizeObserver is still there', /new ResizeObserver\(/.test(CODE));
ok('...still ignores a still-collapsed container', /if\(w<2 \|\| h<2\) return;/.test(CODE));
ok('...still re-fits only once', /if\(!map\.__sizedOnce\)/.test(CODE));
ok('...and still disconnects with the map', /_ro\.disconnect\(\)/.test(CODE));

console.log('\n' + Y + '=== the semantics, exercised against Leaflet\'s actual rule ===' + X);
{
  // Leaflet's real test is `if (container._leaflet_id) { throw }`. Model exactly that, then run the
  // guard's logic over it, so this asserts BEHAVIOUR and not just that some source text is present.
  const mkEl = () => ({ _leaflet_id: null, innerHTML: 'x' });
  const leafletMount = (el) => {
    if (el._leaflet_id) throw new Error('Map container is already initialized.');
    el._leaflet_id = 1;
    return { el, removed: false, remove(){ this.removed = true; this.el._leaflet_id = null; } };
  };
  const reg = {};
  const mount = (id, el) => {
    try { if (reg[id]) reg[id].remove(); } catch (e) {}
    delete reg[id];
    if (el && el._leaflet_id) { el._leaflet_id = null; el.innerHTML = ''; }
    let m; try { m = leafletMount(el); } catch (e) { return null; }
    reg[id] = m; return m;
  };

  // 1. the reported failure: same node, mounted twice.
  const el = mkEl();
  const first = mount('rd-map', el);
  ok('first mount succeeds', !!first);
  const second = mount('rd-map', el);
  ok('SECOND mount on the SAME node also succeeds (this was the blank map)', !!second);
  ok('...and the first map was actually removed, not leaked', first.removed === true);
  ok('...and only one live map is registered for the container', Object.keys(reg).length === 1);

  // 2. without the guard, that same sequence is the bug - proving the test can fail.
  const bare = mkEl();
  leafletMount(bare);
  let threw = false;
  try { leafletMount(bare); } catch (e) { threw = true; }
  ok('NEG CONTROL: an unguarded second mount still throws', threw === true);

  // 3. a fresh node from an innerHTML rebuild must keep working - that is the path that was
  //    already fine, and a fix that broke it would trade one blank map for another.
  const fresh = mkEl();
  ok('a rebuilt container mounts cleanly', !!mount('rd-map', fresh));

  // 4. a node carrying a stamp whose instance we never saw (replaced under a live map).
  const orphan = mkEl(); orphan._leaflet_id = 99;
  ok('an orphaned stamp with no tracked instance is recovered', !!mount('other-map', orphan));
}

console.log('\n' + Y + '=== every caller benefits, because there is one renderer ===' + X);
{
  const calls = (src.match(/renderRideMap_\(/g) || []).length - 1;   // minus the definition
  ok('all ride maps still route through renderRideMap_ (' + calls + ' call sites)', calls >= 5);
  ok('the weather map keeps its own separate teardown', /weatherMapInstance\.remove\(\)/.test(src));
}

console.log('');
if (fails) { console.log(R + 'map mount: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'map mount: all checks passed' + X + '\n');
