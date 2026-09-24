import { describe, expect, it } from 'vitest';
import { decryptData, decryptDataOptional, encryptData, generateAESGCMKey } from '@duradav/backend-data/crypto/aes-gcm';

describe('AES-GCM crypto (per-feature envelope)', () => {
  it('generates unique 256-bit base64 keys', async () => {
    const key1 = await generateAESGCMKey();
    const key2 = await generateAESGCMKey();
    expect(typeof key1).toBe('string');
    expect(key1).not.toBe(key2);
    expect(Uint8Array.from(atob(key1), (c) => c.charCodeAt(0)).length).toBe(32);
  });

  it('round-trips webhook secrets, mirror URLs, and unicode', async () => {
    const key = await generateAESGCMKey();
    for (const plaintext of ['hook-secret-abc123', 'https://github.com/owner/repo.git', '', '日本語テスト 🔐']) {
      const { encrypted, iv } = await encryptData(plaintext, key);
      await expect(decryptData(encrypted, iv, key)).resolves.toBe(plaintext);
    }
  });

  it('uses random IVs per encryption and reuses an explicit IV deterministically', async () => {
    const key = await generateAESGCMKey();
    const first = await encryptData('same', key);
    const second = await encryptData('same', key);
    expect(first.iv).not.toBe(second.iv);
    expect(first.encrypted).not.toBe(second.encrypted);
    const reused = await encryptData('same', key, first.iv);
    expect(reused).toEqual(first);
  });

  it('fails closed with the wrong per-feature key', async () => {
    const webhookKey = await generateAESGCMKey();
    const mirrorKey = await generateAESGCMKey();
    const { encrypted, iv } = await encryptData('secret', webhookKey);
    await expect(decryptData(encrypted, iv, mirrorKey)).rejects.toThrow();
  });

  it('decryptDataOptional returns undefined unless all three inputs are present', async () => {
    const key = await generateAESGCMKey();
    const { encrypted, iv } = await encryptData('secret', key);
    await expect(decryptDataOptional(encrypted, iv, key)).resolves.toBe('secret');
    await expect(decryptDataOptional(undefined, iv, key)).resolves.toBeUndefined();
    await expect(decryptDataOptional(encrypted, undefined, key)).resolves.toBeUndefined();
    await expect(decryptDataOptional(encrypted, iv, undefined)).resolves.toBeUndefined();
    await expect(decryptDataOptional(null, null, undefined)).resolves.toBeUndefined();
  });
});
