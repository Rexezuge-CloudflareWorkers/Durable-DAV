import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';

type CredentialApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerCredentialRoutes(app: CredentialApp): void {
  app.get('/user/volumes/:owner/:volume/credentials', async (c) => {
    const scope = BaseRoute.getScope(c);
    const email = c.get('AuthenticatedUserEmailAddress');
    const owner = (c.req.param('owner') ?? '').trim();
    const volume = (c.req.param('volume') ?? '').trim();
    const row = await scope.get(Tokens.VolumeService).getVolume(owner, volume).catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
    const svc = scope.get(Tokens.VolumeCredentialService);
    const credentials = await svc.listCredentials(row.id);
    return c.json({
      credentials: credentials.map((cred) => ({
        credentialId: cred.credentialId,
        name: cred.name,
        username: cred.username,
        passwordPrefix: cred.passwordPrefix,
        passwordLastFour: cred.passwordLastFour,
        createdAt: cred.createdAt,
        expiresAt: cred.expiresAt,
        lastUsedAt: cred.lastUsedAt,
      })),
    });
  });

  app.post('/user/volumes/:owner/:volume/credentials', async (c) => {
    const scope = BaseRoute.getScope(c);
    const email = c.get('AuthenticatedUserEmailAddress');
    const owner = (c.req.param('owner') ?? '').trim();
    const volume = (c.req.param('volume') ?? '').trim();
    const row = await scope.get(Tokens.VolumeService).getVolume(owner, volume).catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
    const body = (await c.req.json().catch(() => null)) as { name?: string; expiresInDays?: unknown } | null;
    if (!body) return c.json({ Exception: { Type: 'BadRequest', Message: 'Invalid JSON body' } }, 400);
    if (!body.name) return c.json({ Exception: { Type: 'BadRequest', Message: 'name is required' } }, 400);
    try {
      const svc = scope.get(Tokens.VolumeCredentialService);
      const created = await svc.createCredential(row.id, row.name, body.name, body.expiresInDays);
      return c.json(
        {
          credentialId: created.metadata.credentialId,
          username: created.metadata.username,
          password: created.password,
          name: created.metadata.name,
          expiresAt: created.metadata.expiresAt,
          passwordPrefix: created.metadata.passwordPrefix,
          passwordLastFour: created.metadata.passwordLastFour,
        },
        201,
      );
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });

  app.delete('/user/volumes/:owner/:volume/credentials/:id', async (c) => {
    const scope = BaseRoute.getScope(c);
    const email = c.get('AuthenticatedUserEmailAddress');
    const owner = (c.req.param('owner') ?? '').trim();
    const volume = (c.req.param('volume') ?? '').trim();
    const row = await scope.get(Tokens.VolumeService).getVolume(owner, volume).catch(() => null);
    if (!row) return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
    if (row.owner_email.toLowerCase() !== email.toLowerCase()) {
      return c.json({ Exception: { Type: 'Forbidden', Message: 'Forbidden' } }, 403);
    }
    try {
      const svc = scope.get(Tokens.VolumeCredentialService);
      await svc.deleteCredential(row.id, c.req.param('id') ?? '');
      return c.json({ ok: true });
    } catch (error) {
      return BaseRoute.toErrorResponse(c as never, error);
    }
  });
}

export { registerCredentialRoutes };
