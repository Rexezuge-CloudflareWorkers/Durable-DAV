// Copies the QuickJS asyncify wasm binary from the pinned
// `@jitl/quickjs-wasmfile-release-asyncify` package into a stable,
// wrangler-addressable path (`apps/background/wasm/quickjs-async.wasm`).
// Wrangler cannot bundle `.wasm` out of pnpm's isolated node_modules layout,
// so the `QUICKJS_WASM` wasm_modules binding (wrangler template + test
// config) points at this copy instead. Runs on `pnpm install` (postinstall)
// before `typegen`; safe to re-run (skips when the copy is up to date).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'apps/background/wasm/quickjs-async.wasm');

const requireFromBackground = createRequire(resolve(root, 'apps/background/package.json'));
const source = resolve(
  dirname(requireFromBackground.resolve('@jitl/quickjs-wasmfile-release-asyncify/package.json')),
  'dist/emscripten-module.wasm',
);

mkdirSync(dirname(target), { recursive: true });
const sourceSize = statSync(source).size;
if (sourceSize < 100_000) throw new Error(` refusing to copy suspiciously small wasm (${sourceSize} bytes) from ${source}`);
if (existsSync(target) && statSync(target).size === sourceSize) {
  console.log(`quickjs wasm up to date (${sourceSize} bytes)`);
} else {
  copyFileSync(source, target);
  console.log(`quickjs wasm synced (${sourceSize} bytes) -> apps/background/wasm/quickjs-async.wasm`);
}
