import type { BackendLocaleStrings } from '../BackendStrings';

const zhCNStrings: BackendLocaleStrings = {
  common: {
    unauthorized: '需要身份验证。',
    forbidden: '访问被拒绝。',
    internalError: '服务器内部错误。',
  },
  repo: {
    notFound: '仓库不存在。',
    visibilityDenied: '此仓库是私有的。',
    created: '仓库 {fullName} 已创建。',
    deleted: '仓库已删除。',
  },
  token: {
    created: '令牌已创建。请立即复制——之后将不再显示。',
    revoked: '令牌已撤销。',
    limitReached: '已达到令牌数量上限（{max} 个）。',
  },
  issue: {
    created: '议题已创建。',
  },
  git: {
    pushRejected: '推送被拒绝：{reason}。',
  },
  namespace: {
    reserved: '该名称为系统保留名称。',
  },
};

export { zhCNStrings };
