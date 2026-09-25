import type { Context } from 'hono';
import { ServiceError, DatabaseError, DefaultInternalServerError } from '@durable-dav/backend-errors';
import { getBackendStrings } from '@durable-dav/shared/i18n';
import { ErrorSanitizationUtil, canonicalizeLanguageTag } from '@durable-dav/shared/utils';
import { createRequestScope } from '@durable-dav/backend-services/composition';
import { getRequestScope, asScopedContext } from '@durable-dav/backend-runtime/di';
import { toServiceStatus as toMappedStatus } from '@durable-dav/backend-services/errors';

type HonoContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
 * Template Method base for Hono route handlers (Otter `IBaseRoute` pattern).
 * Subclasses implement `handleRequest`; the base owns error mapping so
 * handlers stop duplicating `catch(()=>null)` / status-code switches and
 * private-repo existence hiding stays consistent.
 *
 * Backend `Message` stays English (translate display-side per Otter i18n
 * guidance); `getBackendStrings` is wired here so the shared backend locale
 * bundle is live code, not dead code.
 *
 * Shared statics (`getScope`, `readJson`, `parseLimit`, `toServiceStatus`,
 * `toSafeErrorMessage`, `toErrorResponse`) are the single source of truth;
 * `PublicViewerResolver` delegates to them so both stay consistent.
 */
abstract class BaseRoute {
  protected abstract handleRequest(c: HonoContext): Promise<Response>;

  public async handle(c: HonoContext): Promise<Response> {
    try {
      return await this.handleRequest(c);
    } catch (error) {
      return BaseRoute.toErrorResponse(c, error);
    }
  }

  /**
   * Single-scope resolution (Otter pattern). Prefers the per-request container
   * installed by `scopeMiddleware`; falls back to a fresh scope for call sites
   * outside middleware ordering (tests, git auth helpers).
   */
  public static getScope(c: { get(key: string): unknown; env: unknown }): ReturnType<typeof createRequestScope> {
    try {
      return getRequestScope(asScopedContext(c));
    } catch {
      return createRequestScope(c.env as Env);
    }
  }

  /**
   * Strict JSON body reader. Distinguishes malformed JSON (`malformed: true`)
   * from a valid empty object — callers must return 400 on malformed instead
   * of collapsing to `{}` and surfacing a misleading `required` error.
   */
  public static async readJson<T>(
    c: HonoContext | Context | { req: { json: () => Promise<unknown>; header?: (name: string) => string | undefined } },
  ): Promise<{ malformed: boolean; oversized: boolean; body: T }> {
    try {
      const contentLength = (() => {
        try {
          const header = (c as { req?: { header?: (n: string) => string | undefined } }).req?.header;
          const raw = typeof header === 'function' ? header('content-length') : undefined;
          const n = raw === undefined ? NaN : Number(raw);
          return Number.isFinite(n) ? n : NaN;
        } catch {
          return NaN;
        }
      })();
      if (Number.isFinite(contentLength) && (contentLength) > 1_048_576) {
        return { malformed: false, oversized: true, body: {} as T };
      }
      const body = (await (c as { req: { json: () => Promise<unknown> } }).req.json()) as T;
      return { malformed: false, oversized: false, body };
    } catch {
      return { malformed: true, oversized: false, body: {} as T };
    }
  }

  /**
   * Clamped `?limit=` parser. Returns `def` when missing/unparsable, clamped
   * to `[1, max]` otherwise. Trims whitespace so `?limit= 20 ` and
   * `?limit=` both fall back to `def` instead of producing 0/1 via
   * `Number("   ")`.
   */
  public static parseLimit(url: string, def = 100, max = 100): number {
    try {
      const raw = new URL(url).searchParams.get('limit');
      if (raw === null || raw.trim() === '') return def;
      const n = Number(raw.trim());
      if (!Number.isFinite(n)) return def;
      return Math.min(max, Math.max(1, Math.floor(n)));
    } catch {
      return def;
    }
  }

  public static toServiceStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 {
    return toMappedStatus(error);
  }

  /**
   * Mask internal details on 500: callers must use this instead of echoing
   * `error.message` directly, otherwise D1/DO internals leak to clients.
   */
  public static toSafeErrorMessage(error: unknown, fallback: string): string {
    const status = this.toServiceStatus(error);
    if (status === 500) return fallback;
    return error instanceof Error && error.message ? error.message : fallback;
  }

  /**
   * Status → AWS `Exception.Type` mapping for direct validation returns.
   * Call sites that previously wrote `c.json({ error: msg }, status)` must
   * use `jsonError` so the wire shape stays `{Exception:{Type,Message}}`.
   *
   * Why a registry over `switch`: the mapping is data, not branching logic —
   * a `Record` keeps the 8-entry table scannable and unit-testable as data
   * (see `ERROR_TYPE_REGISTRY`), and unknown codes fall through to
   * `InternalServerError` without a `default:` branch.
   */
  private static readonly ERROR_TYPE_REGISTRY: Readonly<Record<number, string>> = {
    400: 'BadRequest',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'NotFound',
    409: 'Conflict',
    413: 'PayloadTooLarge',
    429: 'RateLimited',
  };

  public static toErrorType(status: number): string {
    return this.ERROR_TYPE_REGISTRY[status] ?? 'InternalServerError';
  }

  public static toErrorBody(status: number, message: string): { Exception: { Type: string; Message: string } } {
    return { Exception: { Type: this.toErrorType(status), Message: message } };
  }

  public static jsonError(c: HonoContext, message: string, status: number): Response;
  public static jsonError(c: HonoContext, type: string, message: string, status: number): Response;
  public static jsonError(c: HonoContext, typeOrMessage: string, messageOrStatus: string | number, status = 400): Response {
    if (typeof messageOrStatus === 'number') {
      return c.json({ Exception: { Type: this.toErrorType(messageOrStatus), Message: typeOrMessage } }, messageOrStatus as 400);
    }
    return c.json({ Exception: { Type: typeOrMessage, Message: messageOrStatus } }, status as 400);
  }

  public static toErrorResponse(c: HonoContext, error: unknown): Response {
    if (error instanceof DatabaseError) {
      console.error('Caught database error during execution:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      return Response.json(
        { Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } },
        { status: error.getErrorCode() },
      );
    }
    if (error instanceof ServiceError) {
      const code = error.getErrorCode();
      const body = { Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } };
      if (code < 500) {
        console.warn(`Responding with ${error.getErrorType()}:`, ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      } else {
        console.error('Caught service error during execution:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      }
      return Response.json(body, { status: code });
    }
    // Untyped errors are masked as 500; log the cause server-side only.
    console.error('Unhandled route error', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
    const locale = this.resolveLocale(c);
    const strings = getBackendStrings(locale);
    return Response.json(
      {
        Exception: {
          Type: DefaultInternalServerError.getErrorType(),
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

  protected json(c: HonoContext, data: unknown, status = 200): Response {
    return c.json(data, status as 200);
  }

  protected fail(message: string, status = 400): Response {
    return Response.json({ Exception: { Type: 'BadRequest', Message: message } }, { status });
  }
}

export { BaseRoute };
export type { HonoContext };
