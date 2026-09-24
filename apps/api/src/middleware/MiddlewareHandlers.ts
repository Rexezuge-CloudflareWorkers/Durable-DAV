import type { Context, Next } from 'hono';
import { Tokens } from '@duradav/backend-services/composition';
import type { AccessIdentityContext } from '@duradav/backend-services/auth';
import { UnauthorizedError, ForbiddenError, DefaultInternalServerError } from '@duradav/backend-errors';
import { ErrorSanitizationUtil } from '@duradav/shared/utils';
import { BaseRoute } from '../endpoints/IBaseRoute';

type RequestContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function getScope(c: RequestContext): ReturnType<typeof BaseRoute.getScope> {
  return BaseRoute.getScope(c);
}

async function authenticateUserIdentity(c: RequestContext): Promise<string> {
  const scope = getScope(c);
  const email = await scope
    .get(Tokens.AccessAuthService)
    .getAuthenticatedUserEmail(c.req.raw, c.executionCtx as unknown as AccessIdentityContext);
  await scope.get(Tokens.UserService).upsertUser(email);
  return email;
}

async function userAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  try {
    const userEmail = await authenticateUserIdentity(c);
    c.set('AuthenticatedUserEmailAddress', userEmail);
    await next();
  } catch (error: unknown) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    if (status === 500) {
      console.error('userAuthentication failed:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      return c.json(
        {
          Exception: {
            Type: DefaultInternalServerError.getErrorType(),
            Message: DefaultInternalServerError.getErrorMessage(),
          },
        },
        500,
      );
    }
    const type = error instanceof ForbiddenError ? 'Forbidden' : 'Unauthorized';
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return c.json({ Exception: { Type: type, Message: message } }, status as 401);
  }
}

class MiddlewareHandlers {
  public static userAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return userAuthenticationHandler;
  }

  public static async requireUser(c: RequestContext): Promise<string | Response> {
    try {
      const existing = c.get('AuthenticatedUserEmailAddress') as string | undefined;
      if (existing) return existing;
      const email = await authenticateUserIdentity(c);
      c.set('AuthenticatedUserEmailAddress', email);
      return email;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
        const message = error instanceof Error ? error.message : 'Unauthorized';
        const type = error instanceof ForbiddenError ? 'Forbidden' : 'Unauthorized';
        const status = error instanceof ForbiddenError ? 403 : 401;
        return c.json({ Exception: { Type: type, Message: message } }, status as 401);
      }
      console.error('requireUser failed:', ErrorSanitizationUtil.sanitizeErrorForLogging(error));
      return c.json(
        {
          Exception: {
            Type: DefaultInternalServerError.getErrorType(),
            Message: DefaultInternalServerError.getErrorMessage(),
          },
        },
        500,
      );
    }
  }
}

export { MiddlewareHandlers };
export type { RequestContext };
