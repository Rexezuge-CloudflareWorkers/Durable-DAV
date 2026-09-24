import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HEX_ID } from '../scripts/wrangler-config/types';
import { ensureRequiredKvBindings, getRequiredKvBindings } from '../scripts/wrangler-config/resources';

describe('ensureRequiredKvBindings', () => {
  it('requires the CACHE binding', () => {
    expect(getRequiredKvBindings()).toContain('CACHE');
  });

  it('injects kv_namespaces when the section is missing', () => {
    const content = JSON.stringify({ name: 'duradav' }, null, 2);
    const output = ensureRequiredKvBindings(content, parse(content));
    const config = parse(output) as { kv_namespaces?: Array<{ binding?: string; id?: string }> };
    expect(config.kv_namespaces).toEqual([{ binding: 'CACHE', id: DEFAULT_HEX_ID }]);
  });

  it('appends the missing binding while preserving existing entries', () => {
    const content = JSON.stringify({ kv_namespaces: [{ binding: 'OTHER', id: 'abc' }] }, null, 2);
    const output = ensureRequiredKvBindings(content, parse(content));
    const config = parse(output) as { kv_namespaces?: Array<{ binding?: string; id?: string }> };
    expect(config.kv_namespaces).toEqual([
      { binding: 'OTHER', id: 'abc' },
      { binding: 'CACHE', id: DEFAULT_HEX_ID },
    ]);
  });

  it('leaves configs with a placeholder CACHE entry untouched', () => {
    const content = JSON.stringify({ kv_namespaces: [{ binding: 'CACHE', id: DEFAULT_HEX_ID }] }, null, 2);
    expect(ensureRequiredKvBindings(content, parse(content))).toBe(content);
  });

  it('leaves configs with a provisioned CACHE entry untouched', () => {
    const content = JSON.stringify({ kv_namespaces: [{ binding: 'CACHE', id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' }] }, null, 2);
    expect(ensureRequiredKvBindings(content, parse(content))).toBe(content);
  });
});
