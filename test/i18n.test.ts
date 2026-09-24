import { describe, expect, it } from 'vitest';
import {
  BACKEND_STRINGS,
  SUPPORTED_BACKEND_LOCALES,
  canonicalizeBackendLocaleTag,
  formatBackendString,
  getBackendStrings,
  normalizeBackendLocale,
  resolveLocalizedStrings,
} from '@duradav/shared/i18n';

// NOTE: `apps/web/src/i18n.ts` (+ `lib/locale.ts`) is not importable in this
// node unit-test env — it pulls `i18next`/`react-i18next` (web-only deps, not
// resolvable from the repo root) and a Vite `import.meta.glob` locale chunk
// map. Web `normalizeLanguage`/`detectInitialLanguage` are therefore covered
// indirectly here by invoking `pnpm run validate:locales` (key/placeholder
// parity of all 12 bundles + bundle-dir parity with `SUPPORTED_LANGUAGES`)
// below.

describe('backend strings (en)', () => {
  it('serves Title Case English strings', () => {
    const strings = getBackendStrings('en');
    expect(strings).toBe(BACKEND_STRINGS.en);
    expect(strings.repo.notFound).toBe('Repository Not Found.');
    expect(strings.token.limitReached).toContain('{max}');
    expect(strings.git.pushRejected).toContain('{reason}');
  });

  it('keeps locale bundles structurally identical', () => {
    const enKeys = Object.keys(BACKEND_STRINGS.en).sort();
    expect(SUPPORTED_BACKEND_LOCALES).toEqual(['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko']);
    expect(Object.keys(BACKEND_STRINGS)).toEqual([...SUPPORTED_BACKEND_LOCALES]);
    for (const locale of SUPPORTED_BACKEND_LOCALES) {
      expect(Object.keys(BACKEND_STRINGS[locale]).sort()).toEqual(enKeys);
    }
  });

  it('keeps {placeholder} parity across all locales', () => {
    const varsOf = (value: string): string[] =>
      [...new Set(value.match(/\{(\w+)\}/g) ?? [])].sort();
    const collect = (node: object, out: Map<string, string[]>): void => {
      for (const [key, value] of Object.entries(node)) {
        if (value !== null && typeof value === 'object') collect(value as object, out);
        else if (typeof value === 'string') out.set(key, varsOf(value));
      }
    };
    const enVars = new Map<string, string[]>();
    collect(BACKEND_STRINGS.en, enVars);
    for (const locale of SUPPORTED_BACKEND_LOCALES) {
      if (locale === 'en') continue;
      const vars = new Map<string, string[]>();
      collect(BACKEND_STRINGS[locale], vars);
      for (const [key, expected] of enVars) {
        expect(vars.get(key), `${locale}:${key}`).toEqual(expected);
      }
    }
  });
});

describe('backend strings (zh-CN)', () => {
  it('serves Chinese strings with matching placeholders', () => {
    const strings = getBackendStrings('zh-CN');
    expect(strings.repo.notFound).toBe('仓库不存在。');
    expect(strings.token.limitReached).toContain('{max}');
    expect(strings.repo.created).toContain('{fullName}');
  });
});

describe('locale fallback', () => {
  it('falls back to en for unknown, empty, or missing locales', () => {
    for (const locale of ['en-US', 'xx', '', null, undefined]) {
      expect(getBackendStrings(locale)).toBe(BACKEND_STRINGS.en);
    }
  });

  it('serves every supported locale directly', () => {
    for (const locale of SUPPORTED_BACKEND_LOCALES) {
      expect(getBackendStrings(locale)).toBe(BACKEND_STRINGS[locale]);
    }
  });

  it('maps zh variants to zh-CN', () => {
    for (const locale of ['zh', 'zh_CN', 'ZH-cn']) {
      expect(getBackendStrings(locale)).toBe(BACKEND_STRINGS['zh-CN']);
    }
  });

  it('base-matches regional variants to their language bundle', () => {
    expect(getBackendStrings('de-AT')).toBe(BACKEND_STRINGS.de);
    expect(getBackendStrings('fr-CA')).toBe(BACKEND_STRINGS.fr);
    expect(getBackendStrings('pt-BR')).toBe(BACKEND_STRINGS.pt);
  });

  it('canonicalizes tags case- and separator-insensitively', () => {
    expect(canonicalizeBackendLocaleTag('zh_cn')).toBe('zh-CN');
    expect(canonicalizeBackendLocaleTag('ZH-CN')).toBe('zh-CN');
    expect(canonicalizeBackendLocaleTag(' en ')).toBe('en');
    expect(normalizeBackendLocale('pt')).toBe('pt');
    expect(normalizeBackendLocale('xx')).toBe('en');
  });

  it('resolveLocalizedStrings prefers the primary locale, then the fallback', () => {
    expect(resolveLocalizedStrings('zh-CN')).toBe(BACKEND_STRINGS['zh-CN']);
    expect(resolveLocalizedStrings('xx', 'zh-CN')).toBe(BACKEND_STRINGS['zh-CN']);
    expect(resolveLocalizedStrings('de', 'zh-CN')).toBe(BACKEND_STRINGS.de);
    expect(resolveLocalizedStrings(null, null)).toBe(BACKEND_STRINGS.en);
    expect(resolveLocalizedStrings('en')).toBe(BACKEND_STRINGS.en);
  });
});

describe('formatBackendString', () => {
  it('substitutes string and number placeholders', () => {
    expect(formatBackendString('Repository {fullName} Created.', { fullName: 'alice/demo' })).toBe('Repository alice/demo Created.');
    expect(formatBackendString('Maximum Of {max} Tokens Reached.', { max: 5 })).toBe('Maximum Of 5 Tokens Reached.');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(formatBackendString('Hello {name}.', {})).toBe('Hello {name}.');
    expect(formatBackendString('No vars here.')).toBe('No vars here.');
  });
});
