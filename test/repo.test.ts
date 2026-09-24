import { describe, expect, it } from 'vitest';
import { RepoService } from '@duradav/backend-services/repo';
import { RepoFullName } from '@duradav/shared/utils';

describe('RepoService naming', () => {
  it('strips .git suffix', () => {
    expect(RepoFullName.normalizeRepo('myrepo.git')).toBe('myrepo');
    expect(RepoFullName.normalizeRepo('myrepo')).toBe('myrepo');
  });

  it('validates owner/repo names', () => {
    expect(() => RepoService.validateNames('alice', 'my-repo_1')).not.toThrow();
    expect(() => RepoService.validateNames('alice!', 'repo')).toThrow();
    expect(() => RepoService.validateNames('alice', '')).toThrow();
  });
});
