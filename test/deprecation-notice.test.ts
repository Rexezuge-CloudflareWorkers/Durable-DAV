import { describe, expect, it } from 'vitest';
import { DEPRECATION_HEADERS, DEPRECATION_HTML, ROUTER_REPO_URL } from '../apps/api/src/workers/deprecationNotice';

describe('deprecation notice', () => {
  it('points at the Router repository, not a stale local UI', () => {
    expect(ROUTER_REPO_URL).toBe('https://github.com/Rexezuge-CloudflareWorkers/Durable-DAV-Router');
    expect(DEPRECATION_HTML).toContain(ROUTER_REPO_URL);
    expect(DEPRECATION_HTML).toMatch(/deprecated/i);
    // The notice is a standalone HTML document: no SPA bundle to go stale.
    expect(DEPRECATION_HTML).toContain('<!doctype html>');
    expect(DEPRECATION_HTML).not.toContain('/assets/');
  });

  it('advertises the successor as a machine-readable deprecation', () => {
    expect(DEPRECATION_HEADERS.Deprecation).toBe('true');
    expect(DEPRECATION_HEADERS.Link).toBe(`<${ROUTER_REPO_URL}>; rel="successor-version"`);
  });
});
