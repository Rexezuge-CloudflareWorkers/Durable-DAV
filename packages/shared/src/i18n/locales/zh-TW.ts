import type { BackendLocaleStrings } from '../BackendStrings';

const zhTWStrings: BackendLocaleStrings = {
  common: {
    unauthorized: '需要驗證。',
    forbidden: '存取被拒絕。',
    internalError: '伺服器內部錯誤。',
  },
  repo: {
    notFound: '倉庫不存在。',
    visibilityDenied: '此倉庫是私人的。',
    created: '倉庫 {fullName} 已建立。',
    deleted: '倉庫已刪除。',
  },
  token: {
    created: '令牌已建立。請立即複製——之後將不再顯示。',
    revoked: '令牌已撤銷。',
    limitReached: '已達到令牌數量上限（{max} 個）。',
  },
  issue: {
    created: '議題已建立。',
  },
  git: {
    pushRejected: '推送被拒絕：{reason}。',
  },
  namespace: {
    reserved: '該名稱為系統保留名稱。',
  },
};

export { zhTWStrings };
