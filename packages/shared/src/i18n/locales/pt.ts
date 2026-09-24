import type { BackendLocaleStrings } from '../BackendStrings';

const ptStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Autenticação Necessária.',
    forbidden: 'Acesso Negado.',
    internalError: 'Erro Interno Do Servidor.',
  },
  repo: {
    notFound: 'Repositório Não Encontrado.',
    visibilityDenied: 'Este Repositório É Privado.',
    created: 'Repositório {fullName} Criado.',
    deleted: 'Repositório Excluído.',
  },
  token: {
    created: 'Token Criado. Copie Agora — Não Será Exibido Novamente.',
    revoked: 'Token Revogado.',
    limitReached: 'Máximo De {max} Tokens Atingido.',
  },
  issue: {
    created: 'Issue Criada.',
  },
  git: {
    pushRejected: 'Push Rejeitado: {reason}.',
  },
  namespace: {
    reserved: 'Este Nome De Usuário É Reservado.',
  },
};

export { ptStrings };
