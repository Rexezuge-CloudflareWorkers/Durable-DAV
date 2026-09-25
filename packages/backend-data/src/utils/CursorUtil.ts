import { BadRequestError } from '@durable-dav/backend-errors';

class CursorUtil {
  public static encode(value: unknown): string {
    return btoa(JSON.stringify(value));
  }

  public static decode<T>(cursor: string | undefined): T | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(atob(cursor)) as T;
    } catch {
      return undefined;
    }
  }

  public static decodeOrThrow<T>(cursor: string | undefined): T | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(atob(cursor)) as T;
    } catch {
      throw new BadRequestError('Invalid cursor');
    }
  }

  public static isValidCursor(cursor: string | undefined): boolean {
    if (!cursor) return true;
    try {
      JSON.parse(atob(cursor));
      return true;
    } catch {
      return false;
    }
  }
}

export { CursorUtil };
