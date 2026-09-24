import type { Volume } from '../types';
import { apiDelete, apiGet, apiPost } from '../lib/api';

export async function listMyVolumes(): Promise<Volume[]> {
  const data = await apiGet<{ volumes?: Array<{ owner: string; name: string; isPrivate: boolean; href: string }> }>(
    '/user/volumes',
  );
  return (data.volumes ?? []).map((v) => ({
    owner: v.owner,
    name: v.name,
    fullName: `${v.owner}/${v.name}`,
    isPrivate: v.isPrivate,
    href: v.href,
  }));
}

export async function createVolume(input: {
  owner?: string;
  name: string;
  description?: string | null;
  isPrivate?: boolean;
}): Promise<Volume> {
  const created = await apiPost<{ owner: string; name: string; href: string }>('/user/volumes', input);
  return { owner: created.owner, name: created.name, fullName: `${created.owner}/${created.name}`, isPrivate: false, href: created.href };
}

export async function deleteVolume(owner: string, volume: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/user/volumes/${encodeURIComponent(owner)}/${encodeURIComponent(volume)}`);
}
