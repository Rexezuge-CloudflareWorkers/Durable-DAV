#!/usr/bin/env node
/**
 * Validate web locale bundles: JSON-valid, key parity with en (no missing or
 * extra keys), `{{placeholder}}` parity, no empty values, and bundle-dir
 * parity with web `SUPPORTED_LANGUAGES` (parsed from `apps/web/src/i18n.ts`,
 * so a listed-but-unshipped language fails here instead of at runtime in
 * `loadLanguage`). Key order drift vs en is warn-only (keeps diffs reviewable
 * without failing the run).
 *
 * Usage: `pnpm run validate:locales` from the repo root.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'src', 'locales');
const WEB_I18N_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'src', 'i18n.ts');
const PLACEHOLDER = /\{\{[^}]+\}\}/g;

function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

function placeholdersOf(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.match(PLACEHOLDER) ?? [])].sort();
}

let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`FAIL: ${message}`);
};
const warn = (message) => {
  console.warn(`WARN: ${message}`);
};

let tags;
try {
  tags = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  fail(`cannot list locales dir ${LOCALES_DIR}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!tags.includes('en')) {
  fail('missing base locale: en/translation.json');
  process.exit(1);
}

// Every tag in web `SUPPORTED_LANGUAGES` (single source of truth:
// `apps/web/src/i18n.ts`) must ship a bundle dir, and vice versa —
// otherwise `loadLanguage` throws at runtime for a listed language.
let supported;
try {
  const i18nSource = readFileSync(WEB_I18N_FILE, 'utf8');
  const match = i18nSource.match(/SUPPORTED_LANGUAGES\s*=\s*\[([^\]]+)\]/);
  supported = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
} catch (error) {
  fail(`cannot read web i18n.ts ${WEB_I18N_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (supported.length === 0) fail('could not parse SUPPORTED_LANGUAGES from web i18n.ts');
for (const tag of supported.filter((tag) => !tags.includes(tag)))
  fail(`missing locale directory for supported language: ${tag}/translation.json`);
for (const tag of tags.filter((tag) => !supported.includes(tag))) fail(`extra locale directory not in SUPPORTED_LANGUAGES: ${tag}`);

const bundles = new Map();
for (const tag of tags) {
  const file = join(LOCALES_DIR, tag, 'translation.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`${tag}: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  try {
    bundles.set(tag, JSON.parse(raw));
  } catch (error) {
    fail(`${tag}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const enEntries = flatten(bundles.get('en') ?? {}, '', []);
const enKeys = enEntries.map(([key]) => key);
const enSet = new Set(enKeys);
const enByKey = new Map(enEntries);
if (enKeys.length === 0) fail('en bundle is empty or unreadable');

for (const [tag, bundle] of bundles) {
  if (tag === 'en') continue;
  const entries = flatten(bundle ?? {}, '', []);
  const keys = entries.map(([key]) => key);
  const set = new Set(keys);
  const byKey = new Map(entries);

  for (const key of enKeys.filter((key) => !set.has(key)).slice(0, 10)) fail(`${tag}: missing key ${key}`);
  const missingCount = enKeys.filter((key) => !set.has(key)).length;
  for (const key of keys.filter((key) => !enSet.has(key)).slice(0, 10)) fail(`${tag}: extra key ${key} (no en source)`);
  const extraCount = keys.filter((key) => !enSet.has(key)).length;

  const empty = entries.filter(([, value]) => typeof value !== 'string' || value === '').map(([key]) => key);
  for (const key of empty.slice(0, 10)) fail(`${tag}: empty value at ${key}`);

  const phMismatches = keys.filter((key) => {
    if (!enSet.has(key)) return false;
    const a = placeholdersOf(enByKey.get(key));
    const b = placeholdersOf(byKey.get(key));
    return a.length !== b.length || a.some((ph, i) => ph !== b[i]);
  });
  for (const key of phMismatches.slice(0, 10)) {
    fail(
      `${tag}: placeholder mismatch at ${key} (en=${JSON.stringify(placeholdersOf(enByKey.get(key)))} vs ${tag}=${JSON.stringify(placeholdersOf(byKey.get(key)))})`,
    );
  }

  const orderDrift = keys.length !== enKeys.length || keys.some((key, index) => key !== enKeys[index]);
  if (orderDrift) {
    warn(`${tag}: key order differs from en (warn-only)`);
  }

  const status = missingCount === 0 && extraCount === 0 && empty.length === 0 && phMismatches.length === 0 ? 'OK' : 'FAIL';
  console.log(
    `${tag}: keys=${keys.length} missing=${missingCount} extra=${extraCount} empty=${empty.length} ph_mismatch=${phMismatches.length} [${status}]`,
  );
}

console.log(failed ? 'FAILURES PRESENT' : 'ALL OK');
process.exit(failed ? 1 : 0);
