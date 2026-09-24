import { describe, expect, it } from 'vitest';
import { AuthConfig } from '@duradav/backend-runtime/config/sections/AuthConfig';
import { AppConfiguration } from '@duradav/backend-runtime/config/AppConfiguration';
import { CronTasksWorker } from '@duradav/background/CronTasksWorker';

describe('coverage push: AuthConfig', () => {
  it('defaults to production (bypass denied)', () => {
    const c = new AuthConfig({});
    expect(c.getEnvironment()).toBe('production');
    expect(c.isBypassAllowed()).toBe(false);
    expect(c.isDemoMode()).toBe(false);
    expect(c.getDevAuthEmail()).toBeNull();
    expect(c.getTeamDomain()).toBeNull();
    expect(c.getPolicyAud()).toBeNull();
    expect(c.getDemoUserEmail()).toBeNull();
  });

  it('allows bypass in development', () => {
    const c = new AuthConfig({
      ENVIRONMENT: 'development',
      DEMO_MODE: 'true',
      DEV_AUTH_EMAIL: 'a@b.co',
      TEAM_DOMAIN: 'https://x',
      POLICY_AUD: 'aud',
      DEMO_USER_EMAIL: 'd@e.co',
    });
    expect(c.getEnvironment()).toBe('development');
    expect(c.isBypassAllowed()).toBe(true);
    expect(c.isDemoMode()).toBe(true);
    expect(c.getDevAuthEmail()).toBe('a@b.co');
    expect(c.getTeamDomain()).toBe('https://x');
    expect(c.getPolicyAud()).toBe('aud');
    expect(c.getDemoUserEmail()).toBe('d@e.co');
  });

  it('trims empty env to defaults', () => {
    const c = new AuthConfig({ ENVIRONMENT: '  ' });
    expect(c.getEnvironment()).toBe('production');
  });
});

describe('coverage push: AppConfiguration git limits', () => {
  it('reads git limits with defaults and overrides', () => {
    const d = new AppConfiguration({});
    expect(d.getMaxPushCommands()).toBeGreaterThan(0);
    expect(d.getMaxPackBytes()).toBeGreaterThan(0);
    expect(d.getMaxFetchBodyBytes()).toBeGreaterThan(0);
    expect(d.getMaxPackObjects()).toBeGreaterThan(0);
    const o = new AppConfiguration({ MAX_PUSH_COMMANDS: '11', MAX_PACK_BYTES: '13', MAX_FETCH_BODY_BYTES: '14', MAX_PACK_OBJECTS: '15' });
    expect(o.getMaxPushCommands()).toBe(11);
    expect(o.getMaxPackBytes()).toBe(13);
  });
});

describe('coverage push: CronTasksWorker', () => {
  it('404s non-/run and handles per-schedule single-flight', async () => {
    const w = Object.create(CronTasksWorker.prototype) as InstanceType<typeof CronTasksWorker>;
    (w as unknown as { runs: Map<string, Promise<void>> }).runs = new Map();
    const notFound = await (w as unknown as { fetch(r: Request): Promise<Response> }).fetch(
      new Request('https://do/nope', { method: 'GET' }),
    );
    expect(notFound.status).toBe(404);
    // single-flight: an in-flight run for the same cron → 202 Already running
    (w as unknown as { runs: Map<string, Promise<void>> }).runs.set('', Promise.resolve());
    // need ctx/env for fetch? fetch checks pathname first, then the runs map before touching env.
    const busy = await (w as unknown as { fetch(r: Request): Promise<Response> }).fetch(new Request('https://do/run', { method: 'POST' }));
    expect(busy.status).toBe(202);
    // a different schedule is independent and proceeds to Started.
    (w as unknown as { ctx: unknown }).ctx = {};
    (w as unknown as { env: unknown }).env = {};
    const other = await (w as unknown as { fetch(r: Request): Promise<Response> }).fetch(
      new Request('https://do/run', { method: 'POST', body: JSON.stringify({ cron: '7 */4 * * *' }) }),
    );
    expect(other.status).toBe(202);
  });
});
