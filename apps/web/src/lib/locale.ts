import { canonicalizeLanguageTag, normalizeLanguage } from '../i18n';

export function normalizeLocale(tag: string | null | undefined): string {
  return normalizeLanguage(tag ?? undefined);
}

export function resolveLocale(lng?: string | null): string {
  return canonicalizeLanguageTag(normalizeLanguage(lng ?? undefined));
}
