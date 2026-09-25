# Durable-DAV — Web SPA

Scope: `apps/web/**`. Parent index: `../../AGENTS.md`.

- Vite + React 19 SPA (`src/main.tsx`: `BrowserRouter` → `SpaApp`). Build embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (Vite plugin `spa-shell-embed`; never edit generated file; `scripts/ensure-spa-shell-stub.mjs` creates the empty stub on install).
- `SpaApp.tsx` — thin composition root: `useCurrentUser` + `useSpaLanguage` + `useNotice` hook slices, `Header`/`NoticeBar`, then `SpaViewRouter` (no data fetching in router).
- `components/layout/SpaViewRouter.tsx` — routes: `/` (Dashboard or Landing), `/new` (gated by `Unauthorized`), `/:owner/:volume` (`VolumeView`, subpath in `?path=` so deep file URLs never collide with WebDAV `GET`), `/settings` (gated), `/:username` (`ProfileView`), `*` (localized 404 `Card`). Views in `src/views/`; shared `ui/` primitives in `src/components/`.
- API access: `src/lib/api.ts` + `src/services/*` (`volume/token/user/profileService`) + `src/lib/davXml.ts` (PROPFIND multistatus parser) + `src/services/davClient.ts` (PROPFIND/GET/PUT/MKCOL/DELETE/COPY/MOVE over `/:owner/:volume`); `src/lib/format.ts`, `src/lib/constants.ts`, `src/types.ts`.
- i18n: `src/i18n.ts` (i18next + `react-i18next`) — `SUPPORTED_LANGUAGES` (English-only today; grows bundle-by-bundle under `src/locales/<tag>/translation.json`, enforced by `pnpm run validate:locales`), single `canonicalizeLanguageTag` + `normalizeLanguage`, `detectInitialLanguage` (stored `durable-dav-lng` → `navigator.language` → `en`), `loadLanguage` (static `import.meta.glob` per-locale chunks, falls back to `en` for unshipped bundles).
- English UI text uses Title Case. Pure helpers are unit-tested from the root suite (`src/lib/davXml.ts` via `test/web-davxml.test.ts`).
