/**
 * The one username/owner-name rule.
 *
 * Previously duplicated four times with drifting constraints: `UserService`
 * required no leading/trailing hyphen and capped at 39 characters, while
 * `VolumeService.assertValidOwner` allowed a trailing hyphen. That let a
 * bucket be created under an owner name (`alice-`) that no username could ever
 * be, orphaning it from `/users/:username` and the dashboard.
 *
 * Layer 0 so both the service layer and the front door can validate with the
 * same predicate.
 */

/**
Lowercase alphanumerics and hyphens; no leading, trailing, or doubled hyphen.
*/
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;

const USERNAME_MAX_LENGTH = 39;

/**
Bucket names are looser than usernames: dots and underscores are allowed.
*/
const VOLUME_NAME_PATTERN = /^[a-z0-9][\w.-]*$/i;

const VOLUME_NAME_MAX_LENGTH = 100;

function isValidUsername(value: string): boolean {
  return value.length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(value);
}

function isValidVolumeName(value: string): boolean {
  return value.length <= VOLUME_NAME_MAX_LENGTH && VOLUME_NAME_PATTERN.test(value);
}

export {
  USERNAME_PATTERN,
  USERNAME_MAX_LENGTH,
  VOLUME_NAME_PATTERN,
  VOLUME_NAME_MAX_LENGTH,
  isValidUsername,
  isValidVolumeName,
};
