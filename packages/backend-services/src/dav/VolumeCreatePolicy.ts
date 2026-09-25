import { BadRequestError } from '@durable-dav/backend-errors';

const MAX_VOLUME_DESCRIPTION_LENGTH = 500;

function validateVolumePatch(patch: { description?: string | null; isPrivate?: boolean }): void {
  if (typeof patch.description === 'string' && patch.description.length > MAX_VOLUME_DESCRIPTION_LENGTH) {
    throw new BadRequestError('Description must be 500 characters or fewer');
  }
  if (patch.isPrivate !== undefined && typeof patch.isPrivate !== 'boolean') {
    throw new BadRequestError('isPrivate must be a boolean');
  }
}

function checkVolumeQuota(ownedCount: number, max: number): void {
  if (ownedCount >= max) {
    throw new BadRequestError(`Maximum ${max} volumes per user`);
  }
}

export { validateVolumePatch, checkVolumeQuota, MAX_VOLUME_DESCRIPTION_LENGTH };
