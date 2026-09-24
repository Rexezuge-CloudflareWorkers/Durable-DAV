import type { Hono } from 'hono';
import { Tokens } from '@duradav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';

type UserApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerUserProfileRoutes(app: UserApp): void {
  app.get('/user/me', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const scope = BaseRoute.getScope(c as never);
    const profile = await scope.get(Tokens.UserService).getProfileByEmail(email).catch(() => null);
    return c.json({ email, username: (profile as { username?: string } | null)?.username ?? null });
  });

  app.get('/users/:username', async (c) => {
    const username = c.req.param('username') ?? '';
    const scope = BaseRoute.getScope(c as never);
    try {
      const user = await scope.get(Tokens.UserService).getByUsername(username);
      return c.json({ username: (user as { username?: string })?.username ?? username });
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });
}

export { registerUserProfileRoutes };
