import type { BackendLocaleStrings } from '../BackendStrings';

const frStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Authentification Requise.',
    forbidden: 'Accès Refusé.',
    internalError: 'Erreur Interne Du Serveur.',
  },
  repo: {
    notFound: 'Dépôt Introuvable.',
    visibilityDenied: 'Ce Dépôt Est Privé.',
    created: 'Dépôt {fullName} Créé.',
    deleted: 'Dépôt Supprimé.',
  },
  token: {
    created: 'Jeton Créé. Copiez-Le Maintenant — Il Ne Sera Plus Affiché.',
    revoked: 'Jeton Révoqué.',
    limitReached: 'Maximum De {max} Jetons Atteint.',
  },
  issue: {
    created: 'Ticket Créé.',
  },
  git: {
    pushRejected: 'Push Rejeté : {reason}.',
  },
  namespace: {
    reserved: "Ce Nom D'Utilisateur Est Réservé.",
  },
};

export { frStrings };
