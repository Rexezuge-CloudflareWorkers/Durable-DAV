import type { BackendLocaleStrings } from '../BackendStrings';

const itStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Autenticazione Richiesta.',
    forbidden: 'Accesso Negato.',
    internalError: 'Errore Interno Del Server.',
  },
  repo: {
    notFound: 'Repository Non Trovato.',
    visibilityDenied: 'Questo Repository È Privato.',
    created: 'Repository {fullName} Creato.',
    deleted: 'Repository Eliminato.',
  },
  token: {
    created: 'Token Creato. Copialo Ora — Non Verrà Mostrato Di Nuovo.',
    revoked: 'Token Revocato.',
    limitReached: 'Massimo Di {max} Token Raggiunto.',
  },
  issue: {
    created: 'Issue Creata.',
  },
  git: {
    pushRejected: 'Push Rifiutato: {reason}.',
  },
  namespace: {
    reserved: 'Questo Nome Utente È Riservato.',
  },
};

export { itStrings };
