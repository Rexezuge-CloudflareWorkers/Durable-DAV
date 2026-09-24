import type { BackendLocaleStrings } from '../BackendStrings';

const esStrings: BackendLocaleStrings = {
  common: {
    unauthorized: 'Autenticación Requerida.',
    forbidden: 'Acceso Denegado.',
    internalError: 'Error Interno Del Servidor.',
  },
  repo: {
    notFound: 'Repositorio No Encontrado.',
    visibilityDenied: 'Este Repositorio Es Privado.',
    created: 'Repositorio {fullName} Creado.',
    deleted: 'Repositorio Eliminado.',
  },
  token: {
    created: 'Token Creado. Cópialo Ahora — No Se Mostrará De Nuevo.',
    revoked: 'Token Revocado.',
    limitReached: 'Máximo De {max} Tokens Alcanzado.',
  },
  issue: {
    created: 'Incidencia Creada.',
  },
  git: {
    pushRejected: 'Push Rechazado: {reason}.',
  },
  namespace: {
    reserved: 'Este Nombre De Usuario Está Reservado.',
  },
};

export { esStrings };
