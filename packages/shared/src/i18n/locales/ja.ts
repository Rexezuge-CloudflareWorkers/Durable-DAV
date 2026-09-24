import type { BackendLocaleStrings } from '../BackendStrings';

const jaStrings: BackendLocaleStrings = {
  common: {
    unauthorized: '認証が必要です。',
    forbidden: 'アクセスが拒否されました。',
    internalError: 'サーバー内部エラー。',
  },
  repo: {
    notFound: 'リポジトリが見つかりません。',
    visibilityDenied: 'このリポジトリはプライベートです。',
    created: 'リポジトリ {fullName} を作成しました。',
    deleted: 'リポジトリを削除しました。',
  },
  token: {
    created: 'トークンを作成しました。今すぐコピーしてください — 二度と表示されません。',
    revoked: 'トークンを取り消しました。',
    limitReached: 'トークンの上限（{max} 件）に達しました。',
  },
  issue: {
    created: 'Issue を作成しました。',
  },
  git: {
    pushRejected: 'プッシュが拒否されました：{reason}。',
  },
  namespace: {
    reserved: 'このユーザー名は予約されています。',
  },
};

export { jaStrings };
