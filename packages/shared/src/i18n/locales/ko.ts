import type { BackendLocaleStrings } from '../BackendStrings';

const koStrings: BackendLocaleStrings = {
  common: {
    unauthorized: '인증이 필요합니다.',
    forbidden: '액세스가 거부되었습니다.',
    internalError: '서버 내부 오류.',
  },
  repo: {
    notFound: '리포지토리를 찾을 수 없습니다.',
    visibilityDenied: '이 리포지토리는 비공개입니다.',
    created: '리포지토리 {fullName}이(가) 생성되었습니다.',
    deleted: '리포지토리가 삭제되었습니다.',
  },
  token: {
    created: '토큰이 생성되었습니다. 지금 복사하세요 — 다시 표시되지 않습니다.',
    revoked: '토큰이 해지되었습니다.',
    limitReached: '최대 {max}개의 토큰에 도달했습니다.',
  },
  issue: {
    created: '이슈가 생성되었습니다.',
  },
  git: {
    pushRejected: '푸시가 거부되었습니다: {reason}.',
  },
  namespace: {
    reserved: '이 사용자 이름은 예약되어 있습니다.',
  },
};

export { koStrings };
