import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'duradav-lng';

const baseResources = {
  en: { translation: en },
} as const;

function canonicalizeTag(tag: string): string {
  // Same BCP 47-ish normalization as `../Git` (web ships with 0
  // `@duradav/*` runtime deps, so the body is intentionally local).
  const normalized = tag.trim().replaceAll('_', '-');
  const parts = normalized.split('-').filter(Boolean);
  if (parts.length === 0) return 'en';
  const language = (parts[0] ?? 'en').toLowerCase();
  if (parts.length === 1) return language;
  const rest = parts.slice(1).map((part: string) => (part.length === 2 ? part.toUpperCase() : part.toLowerCase()));
  return [language, ...rest].join('-');
}

// Single canonicalizer for BCP 47-ish tags (`en_us` → `en-US`).
// `lib/locale.ts` delegates here so normalization lives in one place.
export function canonicalizeLanguageTag(tag: string): string {
  return canonicalizeTag(tag);
}

export function normalizeLanguage(tag: string | null | undefined): SupportedLanguage {
  if (!tag || typeof tag !== 'string') return 'en';
  const canonical = canonicalizeTag(tag);
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(canonical)) {
    return canonical as SupportedLanguage;
  }
  const base = canonical.split('-', 1)[0]?.toLowerCase() ?? 'en';
  const match = (SUPPORTED_LANGUAGES as readonly string[]).find((l) => l.toLowerCase() === base);
  if (match) return match as SupportedLanguage;
  return 'en';
}

export function detectInitialLanguage(): SupportedLanguage {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch {
    // Ignore storage errors (private mode) and fall through.
  }
  try {
    const nav = typeof navigator === 'undefined' ? null : navigator.language;
    if (nav) return normalizeLanguage(nav);
  } catch {
    // Ignore and fall through to default.
  }
  return 'en';
}

const loadedLanguages = new Set<string>(['en']);

// Static glob so Vite emits one chunk per locale instead of relying on a
// variable dynamic import (which warns INEFFECTIVE_DYNAMIC_IMPORT and can 404
// under Workers Assets serving).
const localeModules = import.meta.glob('./locales/*/translation.json');

export async function loadLanguage(lng: string): Promise<void> {
  const normalized = normalizeLanguage(lng);
  if (loadedLanguages.has(normalized)) {
    await i18n.changeLanguage(normalized);
    return;
  }
  const loader = localeModules[`./locales/${normalized}/translation.json`];
  if (!loader) {
    // Bundle not shipped yet — stay on English instead of failing.
    await i18n.changeLanguage('en');
    return;
  }
  let dict: Record<string, unknown>;
  try {
    const mod = (await loader()) as { default: Record<string, unknown> };
    dict = mod.default;
  } catch (error) {
    console.error(`Failed to load language bundle: ${normalized}`, error);
    throw error instanceof Error ? error : new Error(`Failed to load language bundle: ${normalized}`);
  }
  i18n.addResourceBundle(normalized, 'translation', dict, true, true);
  loadedLanguages.add(normalized);
  await i18n.changeLanguage(normalized);
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: baseResources,
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}
