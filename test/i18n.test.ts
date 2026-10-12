import { describe, expect, it } from 'vitest';
import { LOCALE_STRINGS, SUPPORTED_LOCALES, getLocalizedStrings, normalizeLocale } from '@rexezuge/i18n';

// NOTE: `apps/web/src/i18n.ts` (+ `lib/locale.ts`) is not importable in this
// node unit-test env — it pulls `i18next`/`react-i18next` (web-only deps, not
// resolvable from the repo root) and a Vite `import.meta.glob` locale chunk
// map. Web `normalizeLanguage`/`detectInitialLanguage` are therefore covered
// indirectly here by invoking `pnpm run validate:locales` (key/placeholder
// parity of all 12 bundles + bundle-dir parity with `SUPPORTED_LANGUAGES`)
// below.

describe('backend strings (en)', () => {
  it('serves Title Case English strings', () => {
    const strings = getLocalizedStrings('en');
    expect(strings).toBe(LOCALE_STRINGS.en);
    expect(strings.common.unauthorized).toBe('Authentication Required.');
    expect(strings.common.forbidden).toBe('Access Denied.');
    expect(strings.common.internalError).toBe('Internal Server Error.');
  });

  it('keeps locale bundles structurally identical', () => {
    const enKeys = Object.keys(LOCALE_STRINGS.en).sort();
    expect(SUPPORTED_LOCALES).toEqual(['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko']);
    expect(Object.keys(LOCALE_STRINGS)).toEqual([...SUPPORTED_LOCALES]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(LOCALE_STRINGS[locale]).sort()).toEqual(enKeys);
    }
  });

  it('keeps every locale key set identical to en, all the way down', () => {
    // The bundle is one nested `common` group today. This recurses so that
    // adding a group cannot be shipped to some locales and not others without
    // this failing — the failure mode that made the `repo`/`token`/`git`
    // groups safe to delete in the first place was never caught.
    const keyPath = (node: object, prefix = ''): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        value !== null && typeof value === 'object' ? keyPath(value as object, `${prefix}${key}.`) : `${prefix}${key}`,
      );
    const expected = keyPath(LOCALE_STRINGS.en).sort();
    expect(expected.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      expect(keyPath(LOCALE_STRINGS[locale]).sort(), locale).toEqual(expected);
    }
  });

  it('has no untranslated placeholders left to drift', () => {
    // `formatBackendString` was removed along with its only data. If a message
    // ever needs interpolation again it comes back with a real reader; until
    // then a `{placeholder}` here would be silently printed to a client.
    const collect = (node: object, out: string[]): void => {
      for (const value of Object.values(node)) {
        if (value !== null && typeof value === 'object') collect(value as object, out);
        else if (typeof value === 'string' && /\{\w+\}/.test(value)) out.push(value);
      }
    };
    for (const locale of SUPPORTED_LOCALES) {
      const withPlaceholders: string[] = [];
      collect(LOCALE_STRINGS[locale], withPlaceholders);
      expect(withPlaceholders, locale).toEqual([]);
    }
  });
});

describe('backend strings (zh-CN)', () => {
  it('serves Chinese strings', () => {
    const strings = getLocalizedStrings('zh-CN');
    expect(strings.common.internalError).toBe('服务器内部错误。');
    expect(strings.common.unauthorized).toBe('需要身份验证。');
  });
});

describe('locale fallback', () => {
  it('falls back to en for unknown, empty, or missing locales', () => {
    for (const locale of ['en-US', 'xx', '', null, undefined]) {
      expect(getLocalizedStrings(locale)).toBe(LOCALE_STRINGS.en);
    }
  });

  it('serves every supported locale directly', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getLocalizedStrings(locale)).toBe(LOCALE_STRINGS[locale]);
    }
  });

  it('maps zh variants to zh-CN', () => {
    for (const locale of ['zh', 'zh_CN', 'ZH-cn']) {
      expect(getLocalizedStrings(locale)).toBe(LOCALE_STRINGS['zh-CN']);
    }
  });

  it('base-matches regional variants to their language bundle', () => {
    expect(getLocalizedStrings('de-AT')).toBe(LOCALE_STRINGS.de);
    expect(getLocalizedStrings('fr-CA')).toBe(LOCALE_STRINGS.fr);
    expect(getLocalizedStrings('pt-BR')).toBe(LOCALE_STRINGS.pt);
  });

  it('normalizes tags case- and separator-insensitively', () => {
    expect(normalizeLocale('zh_cn')).toBe('zh-CN');
    expect(normalizeLocale('ZH-CN')).toBe('zh-CN');
    expect(normalizeLocale(' en ')).toBe('en');
    expect(normalizeLocale('pt')).toBe('pt');
    expect(normalizeLocale('xx')).toBe('en');
  });
});
