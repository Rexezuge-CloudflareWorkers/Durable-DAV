import type { BackendLocaleStrings } from '../BackendStrings';

const deStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Authentifizierung Erforderlich.',
    forbidden: 'Zugriff Verweigert.',
    internalError: 'Interner Serverfehler.',
  },
  repo: {
    notFound: 'Repository Nicht Gefunden.',
    visibilityDenied: 'Dieses Repository Ist Privat.',
    created: 'Repository {fullName} Erstellt.',
    deleted: 'Repository Gelöscht.',
  },
  token: {
    created: 'Token Erstellt. Kopieren Sie Es Jetzt — Es Wird Nicht Erneut Angezeigt.',
    revoked: 'Token Widerrufen.',
    limitReached: 'Maximum Von {max} Tokens Erreicht.',
  },
  issue: {
    created: 'Issue Erstellt.',
  },
  git: {
    pushRejected: 'Push Abgelehnt: {reason}.',
  },
  namespace: {
    reserved: 'Benutzername Ist Reserviert.',
  },
};

export { deStrings };
