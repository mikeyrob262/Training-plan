// Pre-push preflight for this Worker.
//
// The entire app is served as ONE template literal, which creates two failure
// modes that `node --check` CANNOT catch (both shipped app-breaking bugs):
//   1. A stray backtick / bad ${ terminates the template literal  -> the
//      esbuild BUILD fails. Caught by step 1 (wrangler --dry-run).
//   2. A regex written with single backslashes (/\s/, /\*/) has its backslash
//      stripped by the template literal, so the SERVED regex is invalid
//      (/\s/ -> /s/, /^\*\*/ -> /^**/). Build + node --check both pass; only
//      the BROWSER throws at load. Caught by step 2 (parse the served <script>).
//
// Run manually: `node scripts/preflight.mjs`
// Runs automatically on `git push` via .githooks/pre-push (core.hooksPath).
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const R='\x1b[31m', G='\x1b[32m', D='\x1b[2m', X='\x1b[0m';
const out = mkdtempSync(join(tmpdir(), 'preflight-'));
const fail = (m) => { console.error(`${R}✗ preflight FAILED: ${m}${X}`); cleanup(); process.exit(1); };
const cleanup = () => { try { rmSync(out, { recursive: true, force: true }); } catch {} };

try {
  // ---- 1. Real build (esbuild via wrangler) -> catches template-literal breaks
  console.log(`${D}· building (wrangler deploy --dry-run)…${X}`);
  try {
    execSync(`npx --yes wrangler deploy --dry-run --outdir "${out}"`, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error((e.stderr || e.stdout || '').toString());
    fail('wrangler build failed (see above) — the served template literal is malformed.');
  }
  console.log(`${G}✓ wrangler build clean${X}`);

  // ---- 2. Browser-equivalent parse: run the worker, fetch the served HTML,
  //         and parse each inline <script> the way the browser does.
  let html;
  try {
    const mod = await import(pathToFileURL(join(out, 'worker.js')).href);
    const res = await mod.default.fetch(new Request('http://localhost/'), {}, { waitUntil() {}, passThroughOnException() {} });
    html = await res.text();
  } catch (e) {
    fail('could not run the built worker to get served HTML: ' + e.message);
  }
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) fail('no inline <script> found in served HTML (unexpected).');
  let bad = 0;
  scripts.forEach((s, i) => {
    try { new Function(s); } // same parse the browser does; throws on invalid regex literals
    catch (e) { bad++; console.error(`${R}  <script #${i}> would throw at load: ${e.message}${X}`); }
  });
  if (bad) fail(`${bad} served script block(s) fail to parse — the app would break at load.`);
  console.log(`${G}✓ served scripts parse (browser-equivalent, ${scripts.length} block${scripts.length > 1 ? 's' : ''})${X}`);

  // ---- 3. AI card render smoke-test -> catches bare undeclared-symbol ReferenceErrors
  //         (ceilCy / rcv class) that _aiSafe_ swallows in production, blanking a card.
  console.log(`${D}· rendering AI cards (smoke-test)…${X}`);
  try {
    const so = execSync('node scripts/ai-cards-smoke.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('an AI card throws or renders blank (see above).');
  }

  // ---- 4. Nutrition fold semantics -> the st.nl dialect fold must merge meal buckets by
  //         MULTISET MAX. A set-rebuild collapses a food legitimately logged twice in one meal
  //         (real case: Hamburger - Five Guys x2, 2026-07-21) and a naive concat doubles a
  //         cross-dialect twin. Both are silent; the fixture blocks the push.
  console.log(`${D}· checking nutrition fold semantics…${X}`);
  try {
    const so = execSync('node scripts/nl-merge-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('nutrition fold semantics regressed (see above).');
  }

  console.log(`${G}preflight passed — safe to push.${X}`);
  cleanup();
} catch (e) {
  fail('unexpected error: ' + (e && e.message));
}
