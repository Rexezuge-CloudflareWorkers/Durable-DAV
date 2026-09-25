import type { DavEntry } from '../types';
import { BackendError, readDav } from '../lib/api';
import { parseMultistatus, stripSlashes } from '../lib/davXml';

function volumeBase(owner: string, volume: string): string {
  // Session-authenticated browser plane (Git read-model pattern):
  // same DO content as the WebDAV plane but authed via the Access session,
  // so private buckets never answer 401 + WWW-Authenticate (no native
  // username/password prompt). External WebDAV clients keep using
  // `/:owner/:volume` with bucket Basic credentials.
  return `/user/volumes/${encodeURIComponent(owner)}/${encodeURIComponent(volume)}/files`;
}

function entryUrl(owner: string, volume: string, innerPath: string): string {
  const clean = stripSlashes(innerPath);
  const suffix = clean === '' ? '/' : `/${clean.split('/').map(encodeURIComponent).join('/')}`;
  return `${volumeBase(owner, volume)}${suffix}`;
}

async function davFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 207) return response;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let type: string | null = null;
    let message = text || `HTTP ${response.status}`;
    try {
      const data = JSON.parse(text) as { Exception?: { Type?: string; Message?: string } };
      if (typeof data?.Exception?.Type === 'string') type = data.Exception.Type;
      if (typeof data?.Exception?.Message === 'string' && data.Exception.Message) message = data.Exception.Message;
    } catch {
      // Plain-text WebDAV errors surface as-is (truncated).
      message = message.length > 500 ? `${message.slice(0, 500)}…` : message;
    }
    throw new BackendError(message, type, response.status);
  }
  return response;
}

export async function listDirectory(owner: string, volume: string, innerPath: string): Promise<DavEntry[]> {
  const url = entryUrl(owner, volume, innerPath);
  const body = `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><allprop/></propfind>`;
  const response = await davFetch(url, {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  const xml = await readDav(response);
  return parseMultistatus(xml, innerPath);
}

export async function createDirectory(owner: string, volume: string, innerPath: string): Promise<void> {
  await davFetch(entryUrl(owner, volume, innerPath), { method: 'MKCOL' });
}

export async function uploadFile(owner: string, volume: string, innerPath: string, file: File | Blob): Promise<void> {
  await davFetch(entryUrl(owner, volume, innerPath), {
    method: 'PUT',
    headers: { 'Content-Type': (file as File).type || 'application/octet-stream' },
    body: file,
  });
}

export async function deleteEntry(owner: string, volume: string, innerPath: string): Promise<void> {
  await davFetch(entryUrl(owner, volume, innerPath), { method: 'DELETE' });
}

export async function moveEntry(
  owner: string,
  volume: string,
  fromPath: string,
  toPath: string,
  overwrite = true,
): Promise<void> {
  const destination = new URL(entryUrl(owner, volume, toPath), globalThis.location.origin).href;
  await davFetch(entryUrl(owner, volume, fromPath), {
    method: 'MOVE',
    headers: { Destination: destination, Overwrite: overwrite ? 'T' : 'F' },
  });
}

export async function copyEntry(
  owner: string,
  volume: string,
  fromPath: string,
  toPath: string,
  overwrite = true,
): Promise<void> {
  const destination = new URL(entryUrl(owner, volume, toPath), globalThis.location.origin).href;
  await davFetch(entryUrl(owner, volume, fromPath), {
    method: 'COPY',
    headers: { Destination: destination, Overwrite: overwrite ? 'T' : 'F' },
  });
}

export function downloadUrl(owner: string, volume: string, innerPath: string): string {
  return entryUrl(owner, volume, innerPath);
}
