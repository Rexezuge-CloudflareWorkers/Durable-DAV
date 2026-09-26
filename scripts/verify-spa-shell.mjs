#!/usr/bin/env node
/**
 * Fail when the SPA shell the API worker serves is missing or self-inconsistent.
 *
 * `apps/api/src/workers/DurableDavWorker.ts` answers every browser navigation
 * with `SPA_HTML`, embedded from `apps/web/dist/index.html` by the Vite
 * `spa-shell-embed` plugin. Both that file and `apps/web/dist/` are gitignored
 * build artifacts, so a fresh clone gets the empty `postinstall` stub and every
 * `GET /` returns a blank page — with nothing in the source tree saying so.
 *
 * What this catches:
 * - the `postinstall` stub (or no build at all) still in place;
 * - `spa-shell.ts` referencing `/assets/...` bundles that were not emitted (a
 *   partially cleaned or half-copied `dist/`, which serves a shell whose JS 404s);
 * - `spa-shell.ts` and `apps/web/dist/index.html` disagreeing, i.e. only one of
 *   the two halves of the build was refreshed.
 *
 * Known limit, deliberately stated rather than papered over: this cannot detect a
 * *stale but self-consistent* pair. A `dist/` and a `spa-shell.ts` built together
 * from last week's source agree with each other, and that is precisely the
 * failure this script was added after — the served bundle predated the commit
 * that changed the server's `DAV:href` format, so the bucket browser's parser no
 * longer matched the server and every file and folder 404'd. That class is
 * covered at the source level instead, by
 * `test/integration/api/SpaBrowserPlane.int.test.ts`, which runs the real SPA
 * parser over real 207 bodies. The remaining duty is operational: run
 * `pnpm run build` after touching `apps/web`, before `wrangler deploy`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHELL_PATH = join(ROOT, 'apps/api/src/generated/spa-shell.ts');
const DIST_INDEX = join(ROOT, 'apps/web/dist/index.html');
const DIST_ASSETS = join(ROOT, 'apps/web/dist/assets');

/**
 * A built shell is a full Vite `index.html`. The stub is `SPA_HTML: string = ''`.
 * Any threshold works; this one is only there to reject an obviously empty value.
 */
const MIN_HTML_BYTES = 200;

const problems = [];

function fail(message) {
  problems.push(message);
}

/** The `SPA_HTML` string literal, decoded from the generated TS module. */
function readEmbeddedHtml() {
  if (!existsSync(SHELL_PATH)) {
    fail(`apps/api/src/generated/spa-shell.ts is missing — run \`pnpm run build\` (only apps/web has a build script).`);
    return null;
  }
  const source = readFileSync(SHELL_PATH, 'utf8');
  const marker = 'export const SPA_HTML: string = ';
  const at = source.indexOf(marker);
  if (at === -1) {
    fail('apps/api/src/generated/spa-shell.ts does not export SPA_HTML — regenerate it with `pnpm run build`.');
    return null;
  }
  const literal = source.slice(at + marker.length).replace(/;\s*$/, '');
  // `postinstall` writes `SPA_HTML: string = ''`, which is valid JSON-ish but
  // decodes to an empty string. Check it before `JSON.parse` so the most common
  // failure (a fresh clone that never ran `pnpm run build`) gets the actionable
  // message instead of "not the generated shape".
  if (literal === "''" || literal === '""') {
    fail(
      'apps/api/src/generated/spa-shell.ts still holds the empty postinstall stub — run `pnpm run build`. ' +
        'Until then every browser navigation served by the API worker is a blank page.',
    );
    return null;
  }
  let html;
  try {
    html = JSON.parse(literal);
  } catch {
    fail('apps/api/src/generated/spa-shell.ts is not the generated shape — delete it and run `pnpm run build`.');
    return null;
  }
  if (typeof html !== 'string' || html.length < MIN_HTML_BYTES) {
    fail(
      `apps/api/src/generated/spa-shell.ts holds no usable HTML (${String(html).length} chars) — run \`pnpm run build\`. ` +
        'Until then every browser navigation served by the API worker is a blank page.',
    );
    return null;
  }
  return html;
}

const html = readEmbeddedHtml();

if (html !== null) {
  // Every same-origin asset the shell references must exist in `dist/assets`.
  // A missing one means the served page loads with no JS, so the bucket browser
  // silently renders nothing at all.
  const referenced = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  if (referenced.length === 0) {
    fail('The embedded shell references no /assets/ bundles — it is not a real Vite build output.');
  }
  for (const asset of new Set(referenced)) {
    if (!existsSync(join(DIST_ASSETS, asset))) {
      fail(`The embedded shell references /assets/${asset}, which is not in apps/web/dist/assets — run \`pnpm run build\`.`);
    }
  }

  // The plugin writes a verbatim copy of dist/index.html, so a disagreement means
  // only one half of the build was refreshed.
  if (!existsSync(DIST_INDEX)) {
    fail('apps/web/dist/index.html is missing — run `pnpm run build`.');
  } else {
    const onDisk = readFileSync(DIST_INDEX, 'utf8');
    if (onDisk !== html) {
      fail('apps/api/src/generated/spa-shell.ts does not match apps/web/dist/index.html — run `pnpm run build`.');
    }
  }
}

if (problems.length > 0) {
  console.error('SPA shell check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('SPA shell check passed (apps/api/src/generated/spa-shell.ts matches apps/web/dist).');
