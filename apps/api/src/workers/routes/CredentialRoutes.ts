import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import type { ApiApp, ApiContext } from '@/types/ApiContext';
import { VolumeScopedRoute } from './VolumeScopedRoute';
import type { VolumeRequestContext } from './VolumeScopedRoute';

type App = ApiApp;

class ListCredentials extends VolumeScopedRoute {
  protected async run(c: ApiContext, { scope, row }: VolumeRequestContext): Promise<Response> {
    const credentials = await scope.get(Tokens.VolumeCredentialService).listCredentials(row.id);
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
  }
}

class CreateCredential extends VolumeScopedRoute {
  protected async run(c: ApiContext, { scope, row }: VolumeRequestContext): Promise<Response> {
    // Routed through `BaseRoute.readJson` so malformed JSON and an oversize
    // body are distinguished, and so the body is size-capped like every other
    // JSON endpoint.
    const { malformed, oversized, body } = await BaseRoute.readJson<{ name?: string; expiresInDays?: unknown }>(c);
    if (oversized) return c.json({ Exception: { Type: 'PayloadTooLarge', Message: 'Payload too large' } }, 413);
    if (malformed || !body.name) {
      return c.json({ Exception: { Type: 'BadRequest', Message: malformed ? 'Invalid JSON body' : 'name is required' } }, 400);
    }
    const created = await scope.get(Tokens.VolumeCredentialService).createCredential(row.id, row.name, body.name, body.expiresInDays);
    return c.json(
      {
        credentialId: created.metadata.credentialId,
        username: created.metadata.username,
        // Shown exactly once — the client is expected to copy it now.
        password: created.password,
        name: created.metadata.name,
        expiresAt: created.metadata.expiresAt,
        passwordPrefix: created.metadata.passwordPrefix,
        passwordLastFour: created.metadata.passwordLastFour,
      },
      201,
    );
  }
}

class DeleteCredential extends VolumeScopedRoute {
  protected async run(c: ApiContext, { scope, row }: VolumeRequestContext): Promise<Response> {
    await scope.get(Tokens.VolumeCredentialService).deleteCredential(row.id, c.req.param('id') ?? '');
    return c.json({ ok: true });
  }
}

function registerCredentialRoutes(app: App): void {
  const base = '/user/volumes/:owner/:volume/credentials';
  const list = new ListCredentials();
  const create = new CreateCredential();
  const remove = new DeleteCredential();
  app.get(base, (c) => list.handle(c));
  app.post(base, (c) => create.handle(c));
  app.delete(`${base}/:id`, (c) => remove.handle(c));
}

export { registerCredentialRoutes };
