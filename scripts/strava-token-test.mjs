// EVERY CALLER OF withStravaToken_ IS WRITTEN AS "DO THE WORK INSIDE cb", SO A HANG IS SILENCE.
//
// backfillStravaCalories_ was reported as "returned undefined, callback never fired once, no log
// line at all, and no [calories] backfill line either". The loop never started, so it could not
// even report that it had not: the token refresh is an unbounded fetch, and a request that never
// settles calls nothing.
//
// Same lesson the fbPush watchdog already records - bound it, so silence becomes a RELEASE rather
// than a permanent stall. On timeout it falls back to the STORED access token, which is usually
// still valid: a refresh failing does not mean the current token is dead.
//
// The once-guard is not belt-and-braces. With a race the slow original can still settle afterwards,
// and a second cb runs the caller's ENTIRE BODY twice - for a backfill that is two concurrent loops
// writing the same records.
//
// Run: node scripts/strava-token-test.mjs
import fs from 'fs';
const src=fs.readFileSync('worker.js','utf8');
function mb(f){let i=src.indexOf('{',f),d=0;for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(!d)return j;}}return -1;}
const ex=n=>{const i=src.indexOf('function '+n+'(');return src.slice(i,mb(i)+1)+'\n';};
const G='\x1b[32m',R='\x1b[31m',X='\x1b[0m';
let fails=0; const ok=(l,c)=>{if(!c)fails++;console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l);};

function run(scenario){
  return new Promise(res=>{
    const calls=[];
    const stub={
      st:{stravaToken:scenario.stored, stravaRefreshToken:scenario.refresh},
      sv:()=>{}, window:{PROXY_TOKEN:''},
      fetch:scenario.fetch,
      setTimeout:(fn,ms)=>setTimeout(fn, scenario.fast?5:ms),
      clearTimeout,
      console:{warn:m=>calls.push('warn:'+m), error:m=>calls.push('err:'+m), log:()=>{}}
    };
    const names=Object.keys(stub);
    const f=new Function(...names, ex('withStravaToken_')+'return withStravaToken_;')(...names.map(n=>stub[n]));
    let got=[], t0=Date.now();
    f(tok=>got.push(tok));
    setTimeout(()=>res({got, calls, ms:Date.now()-t0}), scenario.fast?400:200);
  });
}
const hang=()=>new Promise(()=>{});                        // never settles - the reported case
const okTok=()=>Promise.resolve({json:()=>Promise.resolve({access_token:'NEW',refresh_token:'R2'})});
const noTok=()=>Promise.resolve({json:()=>Promise.resolve({})});
const boom=()=>Promise.reject(new Error('network down'));

console.log('\n=== the callback always fires, exactly once ===');
let r=await run({stored:'OLD',refresh:'R',fetch:hang,fast:true});
ok('a HANGING refresh still calls back (was: silence forever)', r.got.length===1);
ok('...falling back to the stored token', r.got[0]==='OLD');
ok('...and says why', r.calls.some(c=>/did not answer/.test(c)));

r=await run({stored:'OLD',refresh:'R',fetch:okTok});
ok('a good refresh returns the new token', r.got.length===1 && r.got[0]==='NEW');

r=await run({stored:'OLD',refresh:'R',fetch:noTok});
ok('no access_token falls back to the stored one', r.got.length===1 && r.got[0]==='OLD');
ok('...and says why', r.calls.some(c=>/no access_token/.test(c)));

r=await run({stored:'OLD',refresh:'R',fetch:boom});
ok('a rejected refresh falls back', r.got.length===1 && r.got[0]==='OLD');

r=await run({stored:null,refresh:null,fetch:hang});
ok('not connected calls back with null', r.got.length===1 && r.got[0]===null);

r=await run({stored:'ONLY',refresh:null,fetch:hang});
ok('no refresh token uses the stored one', r.got.length===1 && r.got[0]==='ONLY');

// The once-guard: a slow original settling AFTER the timeout must not double-fire.
let late; const slow=()=>new Promise(rs=>{ late=()=>rs({json:()=>Promise.resolve({access_token:'LATE'})}); });
r=await new Promise(res=>{
  const stub={st:{stravaToken:'OLD',stravaRefreshToken:'R'},sv:()=>{},window:{PROXY_TOKEN:''},
    fetch:slow,setTimeout:(fn)=>setTimeout(fn,5),clearTimeout,console:{warn:()=>{},error:()=>{},log:()=>{}}};
  const n=Object.keys(stub);
  const f=new Function(...n, ex('withStravaToken_')+'return withStravaToken_;')(...n.map(x=>stub[x]));
  const got=[]; f(t=>got.push(t));
  setTimeout(()=>{ late(); setTimeout(()=>res({got}),50); },40);
});
ok('a late settle after timeout does NOT fire a second callback', r.got.length===1);
ok('...and the first answer stands', r.got[0]==='OLD');

console.log('');
if(fails){ console.log(R+'strava token: '+fails+' failed'+X+'\n'); process.exit(1); }
console.log(G+'strava token: all checks passed'+X+'\n');
