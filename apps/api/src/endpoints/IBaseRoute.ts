import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { readCappedBody } from '@durable-dav/webdav';
import { CATALOG, ServiceError, DatabaseError, DefaultInternalServerError } from '@rexezuge/errors';
import type { ApiContext } from '@/types/ApiContext';
import { getLocalizedStrings } from '@rexezuge/i18n';
import { ErrorSanitizationUtil, canonicalizeLanguageTag } from '@rexezuge/shared';
import { createRequestScope } from '@durable-dav/backend-services/composition';
import { getRequestScope, asScopedContext } from '@rexezuge/runtime';

type HonoContext = ApiContext;

/**
Largest JSON request body the API accepts.
*/
const MAX_JSON_BODY_BYTES = 1_048_576;

/**
 * Shared statics for Hono route handlers.
 *
 * A namespace, not a base class: the Template Method it used to be
 * (`abstract handleRequest` + `handle()` owning the try/catch) had **zero**
 * subclasses — `VolumeScopedRoute` reimplements the same try/catch against the
 * same `toErrorResponse` — so it advertised an inheritance contract nothing was
 * using while the doc comment claimed handlers "stop duplicating" error mapping.
 *
 * `getScope`, `readJson`, `jsonError` and `toErrorResponse` are the single
 * source of truth for scope resolution, body reading, and the AWS-style
 * `{Exception:{Type,Message}}` wire shape. `VolumeScopedRoute` is the template
 * method for volume-scoped handlers; these are the parts it is built from.
 */
abstract class BaseRoute {
  /**
   * Single-scope resolution. Prefers the per-request container installed by
   * `scopeMiddleware`; falls back to a fresh scope for call sites outside
   * middleware ordering (tests, git auth helpers).
   */
  public static getScope(c: { get(key: string): unknown; env: unknown }): ReturnType<typeof createRequestScope> {
    try {
      return getRequestScope(asScopedContext(c));
    } catch {
      return createRequestScope(c.env as Env);
    }
  }

  /**
   * Strict, size-capped JSON body reader.
   *
   * Distinguishes malformed JSON (`malformed: true`) from a valid empty object —
   * callers must return 400 on malformed instead of collapsing to `{}` and
   * surfacing a misleading `required` error.
   *
   * The cap is enforced on the *stream*, not just the declared
   * `Content-Length`. A header probe alone is advisory: a chunked request omits
   * it, and `fetch` may drop an explicitly-set one, so the previous check let an
   * unbounded body through to `req.json()`.
   */
  public static async readJson<T>(c: HonoContext | Context): Promise<{ malformed: boolean; oversized: boolean; body: T }> {
    const contentLength = (() => {
      const raw = c.req.header('content-length');
      const n = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : NaN;
    })();
    if (contentLength > MAX_JSON_BODY_BYTES) {
      return { malformed: false, oversized: true, body: {} as T };
    }
    const raw = await readCappedBody(c.req.raw, MAX_JSON_BODY_BYTES);
    if (!raw.ok) return { malformed: false, oversized: true, body: {} as T };
    const text = new TextDecoder().decode(raw.bytes);
    if (text.trim() === '') return { malformed: false, oversized: false, body: {} as T };
    try {
      return { malformed: false, oversized: false, body: JSON.parse(text) as T };
    } catch {
      return { malformed: true, oversized: false, body: {} as T };
    }
  }

  /**
   * Status → AWS `Exception.Type` naming for direct validation returns.
   * Call sites that previously wrote `c.json({ error: msg }, status)` must
   * use `jsonError` so the wire shape stays `{Exception:{Type,Message}}`.
   *
   * The name comes from the kit's catalog rather than a local table, so a
   * direct return and a thrown `ServiceError` spell the same fault the same
   * way (see `TYPE_BY_STATUS`). Unknown statuses fall through to
   * `internalServerError` without a `default:` branch.
   */
  /**
   * The kit's catalog, read backwards.
   *
   * `jsonError` has a status and a message but no error object, so the
   * envelope's `Type` still needs a name for the fault. It used to be a local
   * table spelling the type as the class name (`NotFound`), while a *thrown*
   * `ServiceError` answered the same field from the kit's catalog key
   * (`notFound`) — one wire field naming the same fault two ways, and the
   * client that keyed off the string would have had to know both.
   *
   * The kit's `CATALOG` is the family's single table (status, code, default
   * message) and is strictly one status per key, so reading it backwards
   * removes the second table instead of re-spelling it. An unknown status
   * answers `internalServerError`, the 500 the envelope is already returning.
   */
  private static readonly TYPE_BY_STATUS: ReadonlyMap<number, string> = new Map(
    Object.entries(CATALOG).map(([type, definition]) => [definition.status, type]),
  );

  public static toErrorType(status: number): string {
    return this.TYPE_BY_STATUS.get(status) ?? 'internalServerError';
  }

  public static jsonError(c: HonoContext, message: string, status: number): Response {
    return c.json({ Exception: { Type: this.toErrorType(status), Message: message } }, status as ContentfulStatusCode);
  }

  /**
   * The answer to a `readJson` that failed to produce a body.
   *
   * Six call sites previously wrote the oversized/malformed pair by hand while
   * `UserRoutes` used `jsonError` for the same two cases — two competing
   * builders for one wire shape, and the hand-written ones had already drifted
   * away from the kit catalog that decides the `Type`. Returns `null`
   * for a body that parsed, so a handler is one `if` rather than two.
   */
  public static rejectUnreadableBody(
    c: HonoContext,
    read: { malformed: boolean; oversized: boolean },
  ): Response | null {
    if (read.oversized) return this.jsonError(c, 'Payload too large', 413);
    return read.malformed ? this.jsonError(c, 'Invalid JSON body', 400) : null;
  }

  public static toErrorResponse(c: HonoContext, error: unknown): Response {
    if (error instanceof DatabaseError) {
      console.error('Caught database error during execution:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      // `retryable` is the only distinction between "try again" and "this will
      // keep failing", and nothing consulted it: every `DatabaseError` answered
      // 500. `DavAuth` already answers 503 for the same type, so this aligns the
      // JSON plane with the DAV plane instead of leaving a retryable outage
      // indistinguishable from a permanent one.
      return Response.json(
        { Exception: { Type: error.type, Message: error.message } },
        { status: error.retryable ? 503 : error.status },
      );
    }
    if (error instanceof ServiceError) {
      const code = error.status;
      const body = { Exception: { Type: error.type, Message: error.message } };
      if (code < 500) {
        console.warn(`Responding with ${error.type}:`, ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      } else {
        console.error('Caught service error during execution:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      }
      return Response.json(body, { status: code });
    }
    // Untyped errors are masked as 500; log the cause server-side only.
    console.error('Unhandled route error', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
    const locale = this.resolveLocale(c);
    const strings = getLocalizedStrings(locale);
    return Response.json(
      {
        Exception: {
          Type: DefaultInternalServerError.type,
          Message: strings.common.internalError,
        },
      },
      { status: 500 },
    );
  }

  private static resolveLocale(c: HonoContext): string {
    try {
      const header = c.req.header('Accept-Language');
      if (!header) return 'en';
      const first = header.split(',', 1)[0]?.split(';', 1)[0]?.trim();
      if (!first) return 'en';
      // Canonicalize (`en_us` → `en-US`) so backend string lookup and logs
      // see one tag shape; unknown tags still fall back to `en` downstream
      // via `normalizeBackendLocale`.
      return canonicalizeLanguageTag(first);
    } catch {
      return 'en';
    }
  }
}

export { BaseRoute };
export type { HonoContext };
