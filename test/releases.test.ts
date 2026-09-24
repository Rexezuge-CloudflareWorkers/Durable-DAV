import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { ReleaseDAO } from '@duradav/backend-data/dao';
import { ReleaseService } from '@duradav/backend-services/release';
import { mapRepoEventToWebhookEvent } from '@duradav/backend-services/webhook';

interface ReleaseState {
  releases: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
}

function createReleaseFakeDb(state: ReleaseState): D1Queryable {
  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM releases WHERE repository_id = ? AND tag_name = ?')) {
          return Promise.resolve(
            (state.releases.find((r) => r.repository_id === params[0] && r.tag_name === params[1]) ?? null) as T | null,
          );
        }
        if (q.includes('FROM releases WHERE id = ? AND repository_id = ?')) {
          return Promise.resolve((state.releases.find((r) => r.id === params[0] && r.repository_id === params[1]) ?? null) as T | null);
        }
        if (q.includes('SELECT COUNT(*) AS count FROM releases')) {
          return Promise.resolve({ count: state.releases.filter((r) => r.repository_id === params[0]).length } as T);
        }
        if (q.includes('SELECT COUNT(*) AS count FROM release_assets')) {
          return Promise.resolve({ count: state.assets.filter((a) => a.release_id === params[0]).length } as T);
        }
        if (q.includes('FROM release_assets WHERE id = ? AND release_id = ?')) {
          return Promise.resolve((state.assets.find((a) => a.id === params[0] && a.release_id === params[1]) ?? null) as T | null);
        }
        if (q.includes('FROM release_assets WHERE release_id = ? AND name = ?')) {
          return Promise.resolve((state.assets.find((a) => a.release_id === params[0] && a.name === params[1]) ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM releases WHERE repository_id = ?')) {
          return Promise.resolve({ results: state.releases.filter((r) => r.repository_id === params[0]) as T[] });
        }
        if (q.includes('FROM release_assets WHERE release_id = ?')) {
          return Promise.resolve({ results: state.assets.filter((a) => a.release_id === params[0]) as T[] });
        }
        return Promise.resolve({ results: [] as T[] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO releases')) {
          const [id, repository_id, tag_name, name, body, is_draft, is_prerelease, created_by, created_at, published_at] = params as Array<
            string | number | null
          >;
          state.releases.push({ id, repository_id, tag_name, name, body, is_draft, is_prerelease, created_by, created_at, published_at });
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('UPDATE releases SET')) {
          const id = params[params.length - 2];
          const repositoryId = params[params.length - 1];
          const row = state.releases.find((r) => r.id === id && r.repository_id === repositoryId);
          if (row) {
            const sets = q.slice('UPDATE releases SET '.length, q.indexOf(' WHERE ')).split(', ');
            const values = params.slice(0, -2);
            for (const [i, set] of sets.entries()) {
              const column = set.split(' = ')[0];
              if (column === 'name' || column === 'body' || column === 'published_at') row[column] = values[i] as string | number | null;
              if (column === 'is_draft' || column === 'is_prerelease') row[column] = values[i] as number;
            }
          }
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('DELETE FROM releases WHERE id = ?')) {
          const [id, repositoryId] = params as string[];
          state.releases = state.releases.filter((r) => !(r.id === id && r.repository_id === repositoryId));
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('INSERT INTO release_assets')) {
          const [id, release_id, repository_id, name, size, content_type, sha256, created_by, created_at] = params as Array<
            string | number
          >;
          state.assets.push({ id, release_id, repository_id, name, size, content_type, sha256, created_by, created_at });
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('DELETE FROM release_assets WHERE id = ?')) {
          const [assetId, releaseId] = params as string[];
          state.assets = state.assets.filter((a) => !(a.id === assetId && a.release_id === releaseId));
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('DELETE FROM release_assets WHERE release_id = ?')) {
          const [releaseId] = params as string[];
          state.assets = state.assets.filter((a) => a.release_id !== releaseId);
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('DELETE FROM release_assets WHERE repository_id = ?')) {
          const [repositoryId] = params as string[];
          state.assets = state.assets.filter((a) => a.repository_id !== repositoryId);
          return Promise.resolve({ success: true });
        }
        if (q.startsWith('DELETE FROM releases WHERE repository_id = ?')) {
          const [repositoryId] = params as string[];
          state.releases = state.releases.filter((r) => r.repository_id !== repositoryId);
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
      },
    };
  }
  return { prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }) } as unknown as D1Queryable;
}

function freshState(): ReleaseState {
  return { releases: [], assets: [] };
}

describe('ReleaseService tag validation', () => {
  it('accepts semver-style tags and rejects git-unsafe names', () => {
    expect(ReleaseService.isValidTagName('v1.0.0')).toBe(true);
    expect(ReleaseService.isValidTagName('release/2026-01')).toBe(true);
    expect(ReleaseService.isValidTagName('')).toBe(false);
    expect(ReleaseService.isValidTagName('has space')).toBe(false);
    expect(ReleaseService.isValidTagName('a..b')).toBe(false);
    expect(ReleaseService.isValidTagName('bad~name')).toBe(false);
    expect(ReleaseService.isValidTagName('/leading')).toBe(false);
    expect(ReleaseService.isValidTagName('trailing.')).toBe(false);
  });

  it('requires a tag name on create', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    await expect(svc.createRelease('r1', { tagName: '' }, 'a@b.c')).rejects.toThrow('tagName');
    await expect(svc.createRelease('r1', { tagName: 42 as unknown as string }, 'a@b.c')).rejects.toThrow('tagName');
    await expect(svc.createRelease('r1', { tagName: 'v1', isDraft: 'yes' as unknown as boolean }, 'a@b.c')).rejects.toThrow('isDraft');
  });
});

describe('ReleaseService CRUD', () => {
  it('creates drafts by default and rejects duplicate tags', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    const created = await svc.createRelease('r1', { tagName: 'v1.0.0', name: 'First', body: 'Notes' }, 'Alice@Example.com');
    expect(created.isDraft).toBe(true);
    expect(created.publishedAt).toBeNull();
    expect(created.createdBy).toBe('alice@example.com');
    await expect(svc.createRelease('r1', { tagName: 'v1.0.0' }, 'alice@example.com')).rejects.toThrow('already exists');
    // same tag in another repo is fine
    await expect(svc.createRelease('r2', { tagName: 'v1.0.0' }, 'alice@example.com')).resolves.toBeDefined();
  });

  it('creates published releases with a timestamp and stamps publish on draft transition', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    const live = await svc.createRelease('r1', { tagName: 'v2', isDraft: false }, 'a@b.c');
    expect(live.isDraft).toBe(false);
    expect(live.publishedAt).not.toBeNull();
    await svc.createRelease('r1', { tagName: 'v3' }, 'a@b.c');
    const published = await svc.updateRelease('r1', 'v3', { isDraft: false });
    expect(published.isDraft).toBe(false);
    expect(published.publishedAt).not.toBeNull();
  });

  it('updates name/body/prerelease and reports missing releases', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    await expect(svc.updateRelease('r1', 'nope', { name: 'x' })).rejects.toThrow('not found');
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    const updated = await svc.updateRelease('r1', 'v1', { name: ' titled ', body: 'b'.repeat(20_000), isPrerelease: true });
    expect(updated.name).toBe('titled');
    expect(updated.body.length).toBe(10_000);
    expect(updated.isPrerelease).toBe(true);
    await expect(svc.updateRelease('r1', 'v1', { isPrerelease: 'yes' as unknown as boolean })).rejects.toThrow('isPrerelease');
  });

  it('deletes releases', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    await expect(svc.deleteRelease('r1', 'nope')).rejects.toThrow('not found');
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    await expect(svc.deleteRelease('r1', 'v1')).resolves.toBeDefined();
    await expect(svc.getRelease('r1', 'v1')).rejects.toThrow('not found');
  });

  it('enforces the per-repo cap', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()), MAX_RELEASES_PER_REPO: '1' });
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    await expect(svc.createRelease('r1', { tagName: 'v2' }, 'a@b.c')).rejects.toThrow('Maximum 1 releases');
  });
});

describe('ReleaseService assets', () => {
  const sha = 'a'.repeat(64);

  it('validates asset input', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    await expect(svc.createAsset('r1', 'nope', { name: 'a.bin', size: 10, sha256: sha }, 'a@b.c')).rejects.toThrow('not found');
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    await expect(svc.createAsset('r1', 'v1', { name: '', size: 10, sha256: sha }, 'a@b.c')).rejects.toThrow('asset name');
    await expect(svc.createAsset('r1', 'v1', { name: '../evil', size: 10, sha256: sha }, 'a@b.c')).rejects.toThrow();
    await expect(svc.createAsset('r1', 'v1', { name: 'a.bin', size: 0, sha256: sha }, 'a@b.c')).rejects.toThrow('size');
    await expect(svc.createAsset('r1', 'v1', { name: 'a.bin', size: 10, sha256: 'zzz' }, 'a@b.c')).rejects.toThrow('sha256');
    await expect(svc.createAsset('r1', 'v1', { name: 'a.bin', size: 10, contentType: 'not-a-type', sha256: sha }, 'a@b.c')).rejects.toThrow(
      'contentType',
    );
  });

  it('creates, lists, gets, and deletes assets', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()) });
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    const asset = await svc.createAsset(
      'r1',
      'v1',
      { name: 'app.tar.gz', size: 12, contentType: 'Application/Gzip', sha256: sha },
      'A@b.c',
    );
    expect(asset.contentType).toBe('application/gzip');
    expect(asset.createdBy).toBe('a@b.c');
    await expect(svc.createAsset('r1', 'v1', { name: 'app.tar.gz', size: 5, sha256: sha }, 'a@b.c')).rejects.toThrow('already exists');
    expect((await svc.listAssets('r1', 'v1')).length).toBe(1);
    expect((await svc.getAsset('r1', 'v1', asset.id)).name).toBe('app.tar.gz');
    await expect(svc.getAsset('r1', 'v1', 'missing')).rejects.toThrow('not found');
    await svc.deleteAsset('r1', 'v1', asset.id);
    expect(await svc.listAssets('r1', 'v1')).toEqual([]);
  });

  it('enforces per-release asset caps and byte caps', async () => {
    const svc = new ReleaseService({ DB: createReleaseFakeDb(freshState()), MAX_ASSETS_PER_RELEASE: '1', MAX_ASSET_BYTES: '100' });
    await svc.createRelease('r1', { tagName: 'v1' }, 'a@b.c');
    await expect(svc.createAsset('r1', 'v1', { name: 'big.bin', size: 101, sha256: 'b'.repeat(64) }, 'a@b.c')).rejects.toThrow('size');
    await svc.createAsset('r1', 'v1', { name: 'a.bin', size: 10, sha256: 'b'.repeat(64) }, 'a@b.c');
    await expect(svc.createAsset('r1', 'v1', { name: 'b.bin', size: 10, sha256: 'c'.repeat(64) }, 'a@b.c')).rejects.toThrow(
      'Maximum 1 assets',
    );
  });
});

describe('ReleaseDAO SQL', () => {
  it('round-trips releases and assets', async () => {
    const state = freshState();
    const dao = new ReleaseDAO(createReleaseFakeDb(state));
    await dao.createRelease({
      id: 'rel-1',
      repositoryId: 'r1',
      tagName: 'v1',
      name: 'V1',
      body: 'notes',
      isDraft: true,
      isPrerelease: false,
      createdBy: 'a@b.c',
      now: 7,
    });
    expect(await dao.countByRepo('r1')).toBe(1);
    expect((await dao.listByRepo('r1')).length).toBe(1);
    expect(await dao.getByTag('r1', 'v1')).toMatchObject({ id: 'rel-1' });
    await dao.updateRelease('rel-1', 'r1', { name: 'V1!', isDraft: false, publishedAt: 9 });
    expect(await dao.getByTag('r1', 'v1')).toMatchObject({ name: 'V1!', is_draft: 0, published_at: 9 });
    await dao.createAsset({
      id: 'a-1',
      releaseId: 'rel-1',
      repositoryId: 'r1',
      name: 'x.bin',
      size: 3,
      contentType: 'application/octet-stream',
      sha256: 'd'.repeat(64),
      createdBy: 'a@b.c',
      now: 8,
    });
    expect(await dao.countAssets('rel-1')).toBe(1);
    expect(await dao.getAssetByName('rel-1', 'x.bin')).toMatchObject({ id: 'a-1' });
    await dao.deleteAsset('a-1', 'rel-1');
    expect(await dao.countAssets('rel-1')).toBe(0);
    await dao.deleteRelease('rel-1', 'r1');
    expect(await dao.countByRepo('r1')).toBe(0);
  });

  it('deletes releases and assets by repo', async () => {
    const state = freshState();
    const dao = new ReleaseDAO(createReleaseFakeDb(state));
    await dao.createRelease({
      id: 'rel-1',
      repositoryId: 'r1',
      tagName: 'v1',
      name: '',
      body: '',
      isDraft: true,
      isPrerelease: false,
      createdBy: 'a@b.c',
      now: 1,
    });
    await dao.createAsset({
      id: 'a-1',
      releaseId: 'rel-1',
      repositoryId: 'r1',
      name: 'x.bin',
      size: 1,
      contentType: 'application/octet-stream',
      sha256: 'e'.repeat(64),
      createdBy: 'a@b.c',
      now: 1,
    });
    await dao.deleteByRepo('r1');
    expect(await dao.countByRepo('r1')).toBe(0);
  });
});

describe('release webhook mapping', () => {
  it('maps release events to the release webhook event', () => {
    expect(mapRepoEventToWebhookEvent('release_created')).toBe('release');
    expect(mapRepoEventToWebhookEvent('release_published')).toBe('release');
  });
});
