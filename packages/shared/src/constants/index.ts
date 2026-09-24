export const ZERO_OID = '0000000000000000000000000000000000000000';
export { RESERVED_NAMESPACE_NAMES, RESERVED_NAMESPACE_NAMES_LIST, isReservedNamespaceName } from './reservedNames';
export const DEFAULT_BRANCH = 'main';
export const MAX_REF_NAME_LENGTH = 255;

export const GIT_SERVICES = ['git-upload-pack', 'git-receive-pack'] as const;
export type GitServiceName = (typeof GIT_SERVICES)[number];

export const DEMO_USER_EMAIL = 'demo@example.com';
