// DEVICE-LEVEL TEST of the last-write-wins fix.
//
// Not a unit test: this pulls the JS that is actually SERVED from the live Worker, runs each
// simulated device in its own vm context with its own persistent "localStorage", and syncs them
// through real Firebase HTTP. The only departure from the real thing is the path - it uses a
// scratch node (/lwwtest) instead of /data, so the user's data is never involved. Cleaned up at
// the end.
//
// The question: can a device holding a stale FTP in localStorage push it back up over a
// legitimately lower value? Run with --old to run the same scenario against the PRE-FIX rule
// and watch it fail, which is what makes the pass meaningful.
import fs from 'fs';
import vm from 'vm';

const OLD = process.argv.includes('--old');
const tok = fs.readFileSync('tok.txt', 'utf8').trim();
const base = 'https://mikey-training-app-default-rtdb.firebaseio.com';
const PATH = '/lwwtest';
const url = () => base + PATH + '.json?auth=' + encodeURIComponent(tok);
const cloudGet = async () => (await fetch(url())).json();
const cloudPut = async (b) => { const r = await fetch(url(), { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if(!r.ok) throw new Error(r.status); return r.json(); };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', C='\x1b[36m', X='\x1b[0m';
let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
};

// ---- pull the SERVED script off the live Worker -----------------------------------------
console.log(C + 'fetching the deployed script from the live Worker...' + X);
const html = await (await fetch('https://training-plan.mgrobinson07.workers.dev')).text();
console.log('  ' + html.length.toLocaleString() + ' bytes served');
function matchBrace(s, from){ let i=s.indexOf('{',from), d=0; for(;i<s.length;i++){const c=s[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(s, n){ const i=s.indexOf('function '+n+'('); if(i<0) throw new Error('not in served output: '+n); return s.slice(i, matchBrace(s,i)+1)+'\n'; }
function exVar(s, n){ let j=s.indexOf('var '+n+' ='); if(j<0) j=s.indexOf('var '+n+'='); if(j<0) throw new Error('not in served output: var '+n);
  let k=j, d=0, started=false;
  for(;k<s.length;k++){ const c=s[k]; if(c==='['||c==='{'){d++;started=true;} else if(c===']'||c==='}'){d--;} else if(c===';'&&(!started||d===0)) break; }
  return s.slice(j, k+1)+'\n'; }

let lib = exVar(html,'_LWW_TOP') + exVar(html,'_LWW_SUB') + 'var _lwwShadow_=null; var st={};\n';
for (const f of ['_lwwPaths_','_lwwGet_','_lwwSet_','mergeStateRoot_','_lwwSnapshot_','_lwwTouch_',
                 'mergeState_','isPlainObj_','arrayToIndexObject_','mergeArrays_']) lib += ex(html, f);
console.log('  extracted the merge layer from the LIVE served copy (' + lib.length.toLocaleString() + ' bytes)');
console.log('  mode: ' + (OLD ? Y+'PRE-FIX (plain mergeState_, max-wins)'+X : G+'SHIPPED (mergeStateRoot_, last-write-wins)'+X));

// ---- a simulated device ------------------------------------------------------------------
// Each gets its own vm context, so its `st` and its shadow are genuinely separate - the way two
// browsers are. `store` stands in for localStorage and persists across the device's "reloads".
function Device(name, store){
  const ctx = vm.createContext({ console, Date });
  vm.runInContext(lib, ctx);
  const dev = {
    name,
    load(){ vm.runInContext('st = ' + JSON.stringify(store) + '; _lwwTouch_();', ctx); },
    get st(){ return JSON.parse(vm.runInContext('JSON.stringify(st)', ctx)); },
    // the user edits a setting, then saveLocal_ runs
    edit(k, v){
      vm.runInContext('st[' + JSON.stringify(k) + '] = ' + JSON.stringify(v) + ';', ctx);
      // saveLocal_: stamp the clock iff an allowlisted value changed
      vm.runInContext('if(_lwwTouch_()) st.lastUpdate = Date.now();', ctx);
      Object.assign(store, this.st);
      console.log('    ' + name + ' edits ' + k + ' = ' + JSON.stringify(v) + '  (localStorage now ' + k + '=' + JSON.stringify(store[k]) + ')');
    },
    // the 5s poll: applyFirebaseData
    async poll(){
      const remote = await cloudGet();
      const fn = OLD ? 'mergeState_' : 'mergeStateRoot_';
      vm.runInContext('st = ' + fn + '(st, ' + JSON.stringify(remote) + '); _lwwTouch_();', ctx);
      Object.assign(store, this.st);
      console.log('    ' + name + ' polls  -> local ftp=' + this.st.ftp);
    },
    // fbPush: re-read remote, merge, PUT with a fresh clock
    async push(){
      const remote = await cloudGet();
      const fn = OLD ? 'mergeState_' : 'mergeStateRoot_';
      if (remote && Object.keys(remote).length) vm.runInContext('st = ' + fn + '(st, ' + JSON.stringify(remote) + '); _lwwTouch_();', ctx);
      vm.runInContext('st.lastUpdate = Date.now();', ctx);
      const out = this.st;
      await cloudPut(out);
      Object.assign(store, out);
      console.log('    ' + name + ' pushes -> cloud ftp=' + out.ftp);
    },
  };
  dev.load();
  return dev;
}

console.log('\n' + C + '=== SCENARIO: phone corrects FTP down; a stale laptop tab tries to undo it ===' + X);
// Both devices start in sync at 190.
const phoneLS  = { ftp:190, weight:'160', lastUpdate: Date.now() - 600000, note:'phone' };
const laptopLS = { ftp:190, weight:'160', lastUpdate: Date.now() - 600000, note:'laptop' };
await cloudPut({ ftp:190, weight:'160', lastUpdate: Date.now() - 600000 });
console.log('  t0  cloud=190, phone=190, laptop=190  (all in sync)');

const phone = Device('phone ', phoneLS);
// The laptop tab is opened NOW and then goes stale - it never polls again until the end.
const laptop = Device('laptop', laptopLS);

console.log('\n  step 1 - the correction is made on the phone');
phone.edit('ftp', 183);
await phone.push();
check('cloud holds the corrected 183', (await cloudGet()).ftp, 183);

console.log('\n  step 2 - the laptop has been sitting on 190 in localStorage the whole time');
check('laptop localStorage is genuinely stale', laptopLS.ftp, 190);

console.log('\n  step 3 - the laptop wakes up: it polls, then saves');
await laptop.poll();
check('the laptop ADOPTS 183 instead of keeping 190', laptop.st.ftp, 183);
await laptop.push();
const afterLaptop = await cloudGet();
check('and the cloud STILL reads 183 after the laptop pushed', afterLaptop.ftp, 183);

console.log('\n  step 4 - the nastier variant: a stale tab that pushes without polling first');
const rogueLS = { ftp:190, weight:'160', lastUpdate: Date.now() - 600000, note:'rogue' };
const rogue = Device('rogue ', rogueLS);
await rogue.push();
check('a blind push from stale state cannot resurrect 190', (await cloudGet()).ftp, 183);

console.log('\n  step 5 - a legitimate later edit still gets through (not just frozen)');
laptop.edit('ftp', 175);
await laptop.push();
check('the laptop can lower it further to 175', (await cloudGet()).ftp, 175);
await phone.poll();
check('and the phone picks that up', phone.st.ftp, 175);

console.log('\n  step 6 - raising still works too');
phone.edit('ftp', 195);
await phone.push();
check('raised to 195', (await cloudGet()).ftp, 195);

console.log('\n' + C + '=== cleanup ===' + X);
await fetch(base + PATH + '.json?auth=' + encodeURIComponent(tok), { method:'DELETE' });
const gone = await cloudGet();
check('scratch path removed', gone, null);

// Confirm we never touched the real data.
const real = await (await fetch(base + '/data/ftp.json?auth=' + encodeURIComponent(tok))).json();
const realW = await (await fetch(base + '/data/weight.json?auth=' + encodeURIComponent(tok))).json();
console.log('  /data/ftp is still ' + JSON.stringify(real) + ', /data/weight ' + JSON.stringify(realW) + ' (untouched)');
check('the real FTP was never involved', real, 183);

console.log('\n' + (fails ? R + fails + ' CHECK(S) FAILED' + X : G + 'device test: all checks passed' + X));
process.exit(fails ? 1 : 0);
