// DOES THE EDGE SERVE THE COMMIT WE JUST DEPLOYED? Asked of the live URL, answered by the build stamp.
//
// For an unknown number of deploys this repo could not answer that question, and nothing said so. Two
// pipelines were deploying every push: .github/workflows/deploy.yml, which substitutes __BUILD_STAMP__
// with "<utc>-<short sha>" before uploading, and a Cloudflare-native Git integration connected to the
// same repo with a raw `npx wrangler deploy` and no stamping step at all. Both fired on every push and
// whichever finished last won. When Cloudflare's won, the edge served correct code carrying the raw
// placeholder — so window.__BUILD__, the one thing every diagnostic leads with, reported UNSTAMPED
// against a perfectly current build. The Cloudflare integration was disconnected 2026-08-21.
//
// THE STAMP WAS THE SMALL HALF. Two deployers racing means the winner is decided by finish order, not
// commit order, so a slower build of an OLDER commit can land after a newer one and the edge serves
// stale code from a deploy that reported green. That is almost certainly what 369e4af was: the live
// URL served the previous commit for 65+ polls and an empty commit "fixed" it by winning the next
// race. Neither failure is visible from CI's own conclusion, which is why this check reads the EDGE.
//
// It therefore distinguishes three outcomes rather than pass/fail:
//   stamped, sha matches   -> the edge is serving THIS commit. The only pass.
//   placeholder intact     -> something deployed without the stamping step. Suspect a second path.
//   stamped, sha differs   -> the edge is serving a DIFFERENT commit: stale, or a race was lost.
//
// Run: node scripts/deploy-stamp-verify.mjs [sha] [url]
//   sha defaults to the short HEAD of the working tree; CI passes GITHUB_SHA explicitly.
import { execSync } from 'child_process';

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';

const URL_ = process.argv[3] || process.env.DEPLOY_URL || 'https://training-plan.mgrobinson07.workers.dev/';
let sha = (process.argv[2] || process.env.GITHUB_SHA || '').trim();
if (!sha) {
  try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
  catch { console.log(R + 'no sha given and git rev-parse failed - pass one: node scripts/deploy-stamp-verify.mjs <sha>' + X); process.exit(2); }
}
const short = sha.slice(0, 7);

// Generous, because a red CI run on a good deploy is its own kind of lie. Measured landing time after
// the second pipeline was removed is ~40s (poll 2); this allows five minutes.
const TRIES = Number(process.env.STAMP_TRIES || 15);
const WAIT_MS = Number(process.env.STAMP_WAIT_MS || 20000);

const readStamp = (html) => {
  const at = html.indexOf("window.__BUILD__ = '");
  if (at < 0) return null;                       // not the app, or the assignment was renamed
  const end = html.indexOf("'", at + 20);
  return end < 0 ? null : html.slice(at + 20, end);
};

console.log('\n' + Y + '=== does the edge serve ' + short + '? ===' + X);
console.log('  url: ' + URL_);

let last = null;
for (let i = 1; i <= TRIES; i++) {
  let html = '';
  try {
    // Cache-busted and no-store: the question is what the EDGE holds, not what a cache remembers.
    const res = await fetch(URL_ + (URL_.indexOf('?') < 0 ? '?' : '&') + 'stampcheck=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) { console.log('  poll ' + i + ': HTTP ' + res.status); await sleep(i); continue; }
    html = await res.text();
  } catch (e) {
    console.log('  poll ' + i + ': fetch failed (' + ((e && e.message) || e) + ')');
    await sleep(i); continue;
  }

  const stamp = readStamp(html);
  last = stamp;
  if (stamp === null) {
    console.log(R + '  the page carries no window.__BUILD__ assignment - this is not the app, or the stamp was removed.' + X);
    process.exit(1);
  }
  const unstamped = stamp.indexOf('BUILD_STAMP') > -1;
  const matches = !unstamped && stamp.endsWith('-' + short);
  console.log('  poll ' + i + ': ' + stamp + (matches ? '  <-- this commit' : ''));

  if (matches) {
    console.log('\n' + G + 'deploy stamp: the edge is serving ' + short + ' (' + stamp + ')' + X + '\n');
    process.exit(0);
  }
  await sleep(i);
}

// Out of tries. Say WHICH failure this is, because the two have completely different fixes.
console.log('');
if (last && last.indexOf('BUILD_STAMP') > -1) {
  console.log(R + 'FAILED: the edge serves the raw __BUILD_STAMP__ placeholder.' + X);
  console.log('  Something deployed this Worker WITHOUT the stamping step. CI substitutes the');
  console.log('  placeholder before uploading, so a live placeholder means the artifact at the edge');
  console.log('  did not come from CI. Check Workers & Pages -> training-plan -> Settings -> Build for');
  console.log('  a reconnected Git integration; that is exactly what caused this before 2026-08-21.');
} else {
  console.log(R + 'FAILED: the edge is stamped ' + JSON.stringify(last) + ', which is not ' + short + '.' + X);
  console.log('  The edge is serving a DIFFERENT commit than the one just deployed - stale delivery, or');
  console.log('  a second deployer won the race. Do NOT debug the code: it is very likely correct and');
  console.log('  simply not being served. Re-trigger, and if a second pipeline exists, remove it.');
}
process.exit(1);

function sleep(i) { return i >= TRIES ? Promise.resolve() : new Promise((s) => setTimeout(s, WAIT_MS)); }
