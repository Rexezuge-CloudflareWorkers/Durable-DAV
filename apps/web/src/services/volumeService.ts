import type { Volume, VolumeDetail } from '../types';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';

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

export async function loadVolume(owner: string, volume: string): Promise<VolumeDetail> {
  const data = await apiGet<{ owner: string; name: string; description: string | null; isPrivate: boolean; href: string }>(
    `/user/volumes/${encodeURIComponent(owner)}/${encodeURIComponent(volume)}`,
  );
  return {
    owner: data.owner,
    name: data.name,
    fullName: `${data.owner}/${data.name}`,
    description: data.description,
    isPrivate: data.isPrivate,
    href: data.href,
  };
}

export async function updateVolume(
  owner: string,
  volume: string,
  patch: { description?: string | null; isPrivate?: boolean },
): Promise<VolumeDetail> {
  const data = await apiPatch<{ owner: string; name: string; description: string | null; isPrivate: boolean; href: string }>(
    `/user/volumes/${encodeURIComponent(owner)}/${encodeURIComponent(volume)}`,
    patch,
  );
  return {
    owner: data.owner,
    name: data.name,
    fullName: `${data.owner}/${data.name}`,
    description: data.description,
    isPrivate: data.isPrivate,
    href: data.href,
  };
}

export async function createVolume(input: {
  owner?: string;
  name: string;
  description?: string | null;
  isPrivate?: boolean;
}): Promise<Volume> {
  const created = await apiPost<{ owner: string; name: string; href: string }>('/user/volumes', {
    ...input,
    isPrivate: input.isPrivate ?? true,
  });
  return {
    owner: created.owner,
    name: created.name,
    fullName: `${created.owner}/${created.name}`,
    isPrivate: input.isPrivate ?? true,
    href: created.href,
  };
}

export async function deleteVolume(owner: string, volume: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/user/volumes/${encodeURIComponent(owner)}/${encodeURIComponent(volume)}`);
}
