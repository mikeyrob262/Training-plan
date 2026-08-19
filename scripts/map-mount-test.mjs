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
// Strip comments so an assertion counts CODE, not prose that happens to quote it. Every guard in
// this file has been broken once by a comment mentioning the thing it greps for.
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) { console.log(R + n + ' missing' + X); process.exit(1); } return src.slice(i, matchBrace(i) + 1); };
const MOUNT = noCmt(exFn('_mountMap_'));
const RENDER = noCmt(exFn('renderRideMap_'));

console.log('\n' + Y + '=== the previous map on this container is torn down first ===' + X);
ok('a registry keyed by container id exists', /window\._rideMapReg_/.test(MOUNT));
ok('...and the prior instance is removed', /_old\s*=\s*window\._rideMapReg_\[key\]/.test(MOUNT) && /_old\.remove\(\)/.test(MOUNT));
ok('...before the new map is constructed',
   MOUNT.indexOf('_old.remove()') < MOUNT.indexOf('L.map(el'));
ok('a stale stamp left by an innerHTML replacement is cleared too', /el\._leaflet_id\s*=\s*null/.test(MOUNT));
ok('...and that clearing also happens BEFORE construction',
   MOUNT.indexOf('el._leaflet_id=null') > -1 && MOUNT.indexOf('el._leaflet_id=null') < MOUNT.indexOf('L.map(el'));
ok('the new map is registered for the next render to find', /window\._rideMapReg_\[key\]\s*=\s*m/.test(MOUNT));
ok('...and deregisters itself on unload, so the registry cannot leak', /delete window\._rideMapReg_\[key\]/.test(MOUNT));
ok('an element without an id still gets the stamp guard', /key=\(typeof target==='string'\)\?target:\(el\.id\|\|null\)/.test(MOUNT));

console.log('\n' + Y + '=== a mount failure is LOUD and returns null, never an escaping throw ===' + X);
ok('the construction is wrapped', /try\{[\s\S]{0,80}m=L\.map\(el/.test(MOUNT));
ok('...it logs which container failed', /\[map\] mount failed for/.test(MOUNT));
ok('...and returns null so the caller\'s own fallback runs', /mount failed for[\s\S]{0,180}return null/.test(MOUNT));

console.log('\n' + Y + '=== EVERY mount routes through the guard, not just the reported one ===' + X);
{
  // The audit that found this bug found three more unguarded mounts. A fix that covered only the
  // ride map would have left the ride-planner wind map able to throw inside a bare try and blank in
  // silence. Count constructions in CODE, so the explanatory comments above cannot mask a live one.
  const bare = (noCmt(src).match(/=L\.map\(/g) || []).length;
  ok('exactly one L.map() construction remains, inside the helper (' + bare + ')', bare === 1);
  ok('...and it is the helper\'s', /m=L\.map\(el/.test(MOUNT));
  const routed = (noCmt(src).match(/_mountMap_\(/g) || []).length - 1;   // minus the definition
  ok('all four mount sites route through it (' + routed + ')', routed === 4);
  ok('the ride renderer uses it and bails on null', /var map=_mountMap_\(mapId,/.test(RENDER) && /if\(!map\) return null;/.test(RENDER));
  ok('the segment map now also removes its previous instance', /if\(_saMap && _saMap!==map\) _saMap\.remove\(\)/.test(noCmt(src)));
  ok('the wind map reports a failed mount instead of swallowing it', /WM: mount failed/.test(noCmt(src)));
  ok('the weather map keeps its own separate teardown too', /weatherMapInstance\.remove\(\)/.test(noCmt(src)));
}

console.log('\n' + Y + '=== the earlier zero-size fix is untouched ===' + X);
ok('the ResizeObserver is still there', /new ResizeObserver\(/.test(RENDER));
ok('...still ignores a still-collapsed container', /if\(w<2 \|\| h<2\) return;/.test(RENDER));
ok('...still re-fits only once', /if\(!map\.__sizedOnce\)/.test(RENDER));
ok('...and still disconnects with the map', /_ro\.disconnect\(\)/.test(RENDER));

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

console.log('\n' + Y + '=== every ride map still shares one renderer ===' + X);
{
  const calls = (noCmt(src).match(/renderRideMap_\(/g) || []).length - 1;   // minus the definition
  ok('all ride maps still route through renderRideMap_ (' + calls + ' call sites)', calls >= 5);
}

console.log('');
if (fails) { console.log(R + 'map mount: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'map mount: all checks passed' + X + '\n');
