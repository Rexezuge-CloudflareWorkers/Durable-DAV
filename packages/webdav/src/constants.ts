const DAV_CLASS = '1, 2';

const SUPPORT_METHODS = [
  'OPTIONS',
  'PROPFIND',
  'PROPPATCH',
  'MKCOL',
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'COPY',
  'MOVE',
  'LOCK',
  'UNLOCK',
];

const CORS_ALLOW_HEADERS = [
  'authorization',
  'content-type',
  'depth',
  'overwrite',
  'destination',
  'range',
  'if',
  'lock-token',
  'timeout',
].join(', ');

const CORS_EXPOSE_HEADERS = [
  'content-type',
  'content-length',
  'dav',
  'etag',
  'last-modified',
  'location',
  'date',
  'content-range',
  'lock-token',
].join(', ');

function applyCors(response: Response, request: Request): Response {
  // DO RPC responses arrive with immutable headers — rebuild instead of mutating.
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') ?? '*');
  headers.set('Access-Control-Allow-Methods', SUPPORT_METHODS.join(', '));
  headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  headers.set('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
  headers.set('Access-Control-Allow-Credentials', 'false');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function createdResponse(resourceHref: string, body: BodyInit | null = '', headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', resourceHref);
  return new Response(body, { status: 201, headers: responseHeaders });
}

export { DAV_CLASS, SUPPORT_METHODS, CORS_ALLOW_HEADERS, CORS_EXPOSE_HEADERS, applyCors, createdResponse };
