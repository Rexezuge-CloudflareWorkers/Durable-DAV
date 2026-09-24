import type { BackendLocaleStrings } from '../BackendStrings';

const plStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Wymagana Autoryzacja.',
    forbidden: 'Odmowa Dostępu.',
    internalError: 'Wewnętrzny Błąd Serwera.',
  },
  repo: {
    notFound: 'Nie Znaleziono Repozytorium.',
    visibilityDenied: 'To Repozytorium Jest Prywatne.',
    created: 'Utworzono Repozytorium {fullName}.',
    deleted: 'Usunięto Repozytorium.',
  },
  token: {
    created: 'Utworzono Token. Skopiuj Go Teraz — Nie Zostanie Pokazany Ponownie.',
    revoked: 'Unieważniono Token.',
    limitReached: 'Osiągnięto Maksimum {max} Tokenów.',
  },
  issue: {
    created: 'Utworzono Zgłoszenie.',
  },
  git: {
    pushRejected: 'Odrzucono Push: {reason}.',
  },
  namespace: {
    reserved: 'Ta Nazwa Użytkownika Jest Zarezerwowana.',
  },
};

export { plStrings };
