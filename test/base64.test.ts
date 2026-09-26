import { describe, expect, it } from 'vitest';
import { bytesToBase64, base64ToBytes } from '../apps/background/src/dav/Base64';

describe('base64 codec', () => {
  // Known vectors, including every padding length and both alphabet edges.
  const vectors: ReadonlyArray<readonly [string, string]> = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  for (const [plain, encoded] of vectors) {
    it(`encodes ${JSON.stringify(plain)}`, () => {
      expect(bytesToBase64(new TextEncoder().encode(plain))).toBe(encoded);
    });
  }

  it('round-trips arbitrary bytes at every length modulo 3', () => {
    for (let length = 0; length < 200; length += 1) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 37 + length) % 256;
      const round = base64ToBytes(bytesToBase64(bytes));
      expect(Array.from(round), `length ${length}`).toEqual(Array.from(bytes));
    }
  });

  it('agrees with the platform encoder for a large buffer', () => {
    // Guards the hand-rolled 3-byte table against an indexing mistake at scale.
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 251) % 256;
    const viaTable = bytesToBase64(bytes);
    const viaPlatform = btoa(String.fromCharCode(...Array.from(bytes)));
    expect(viaTable).toBe(viaPlatform);
    expect(Array.from(base64ToBytes(viaTable))).toEqual(Array.from(bytes));
  });

  it('handles the full byte range including 0x00 and 0xff', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
