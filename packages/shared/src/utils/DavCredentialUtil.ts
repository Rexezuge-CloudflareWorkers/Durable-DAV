import { CryptoUtil } from './CryptoUtil';

const CREDENTIAL_ANIMALS = [
  'alpaca',
  'badger',
  'beaver',
  'bobcat',
  'buffalo',
  'camel',
  'cheetah',
  'cougar',
  'coyote',
  'dolphin',
  'eagle',
  'falcon',
  'ferret',
  'fox',
  'gazelle',
  'giraffe',
  'gorilla',
  'hamster',
  'heron',
  'jaguar',
  'koala',
  'lemur',
  'leopard',
  'llama',
  'lynx',
  'meerkat',
  'moose',
  'otter',
  'panda',
  'panther',
  'penguin',
  'puma',
  'rabbit',
  'raccoon',
  'raven',
  'seal',
  'tiger',
  'walrus',
  'weasel',
  'zebra',
] as const;

const CREDENTIAL_ADJECTIVES = [
  'swift',
  'bright',
  'calm',
  'clever',
  'crisp',
  'daring',
  'eager',
  'frosty',
  'gentle',
  'glacial',
  'golden',
  'granite',
  'harbor',
  'iron',
  'jade',
  'keen',
  'lunar',
  'maple',
  'marble',
  'misty',
  'nimble',
  'noble',
  'onyx',
  'pebble',
  'pine',
  'quartz',
  'quiet',
  'rapid',
  'rocky',
  'sandy',
  'shady',
  'silky',
  'solar',
  'spruce',
  'stony',
  'sunny',
  'tidal',
  'timber',
  'velvet',
  'willow',
] as const;

function slugifyVolume(volumeName: string): string {
  const lower = volumeName.toLowerCase();
  let out = '';
  let lastDash = false;
  for (const ch of lower) {
    const alnum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (alnum) {
      out += ch;
      lastDash = false;
    } else if (!lastDash && out.length > 0) {
      out += '-';
      lastDash = true;
    }
  }
  while (out.endsWith('-')) out = out.slice(0, -1);
  if (out === '') return 'volume';
  let truncated = out.slice(0, 16);
  while (truncated.endsWith('-')) truncated = truncated.slice(0, -1);
  return truncated || 'volume';
}

/* eslint-disable unicorn/class-reference-in-static-methods -- explicit class ref keeps stubbing simple */
class DavCredentialUtil {
  public static generatePassword(): string {
    return `ddav_${CryptoUtil.randomBase64Url(32)}`;
  }

  public static generateUsername(volumeName: string): string {
    const slug = slugifyVolume(volumeName);
    const adjective = CREDENTIAL_ADJECTIVES[DavCredentialUtil.randomInteger(CREDENTIAL_ADJECTIVES.length)];
    const animal = CREDENTIAL_ANIMALS[DavCredentialUtil.randomInteger(CREDENTIAL_ANIMALS.length)];
    const digits = DavCredentialUtil.randomInteger(10_000).toString().padStart(4, '0');
    return `${slug}-${adjective}-${animal}-${digits}`;
  }

  public static async hashPassword(password: string): Promise<string> {
    return CryptoUtil.sha256Hex(password);
  }

  public static getPrefix(password: string): string {
    return password.slice(0, 10);
  }

  public static getLastFour(password: string): string {
    return password.slice(-4);
  }

  private static randomInteger(maxExclusive: number): number {
    const values = new Uint32Array(1);
    const limit = Math.floor(0xff_ff_ff_ff / maxExclusive) * maxExclusive;
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % maxExclusive;
  }
}
/* eslint-enable unicorn/class-reference-in-static-methods */

export { DavCredentialUtil, CREDENTIAL_ANIMALS, CREDENTIAL_ADJECTIVES, slugifyVolume };
