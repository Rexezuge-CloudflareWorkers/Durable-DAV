import type { BackendLocaleStrings } from '../BackendStrings';

const nlStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Authenticatie Vereist.',
    forbidden: 'Toegang Geweigerd.',
    internalError: 'Interne Serverfout.',
  },
  repo: {
    notFound: 'Repository Niet Gevonden.',
    visibilityDenied: 'Deze Repository Is Privé.',
    created: 'Repository {fullName} Aangemaakt.',
    deleted: 'Repository Verwijderd.',
  },
  token: {
    created: 'Token Aangemaakt. Kopieer Het Nu — Het Wordt Niet Opnieuw Getoond.',
    revoked: 'Token Ingetrokken.',
    limitReached: 'Maximum Van {max} Tokens Bereikt.',
  },
  issue: {
    created: 'Issue Aangemaakt.',
  },
  git: {
    pushRejected: 'Push Geweigerd: {reason}.',
  },
  namespace: {
    reserved: 'Deze Gebruikersnaam Is Gereserveerd.',
  },
};

export { nlStrings };
