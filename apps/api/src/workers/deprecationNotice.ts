/**
 * The built-in web UI is soft-deprecated. Durable-DAV-Router is the supported
 * browser UI for this server; the WebDAV and `/user/*` surfaces are unchanged.
 *
 * Kept as a standalone module (rather than inline in `DurableDavWorker`) so the
 * notice and its link can be asserted without constructing the worker, and so
 * the home page works even when the gitignored SPA shell has never been built.
 */

const ROUTER_REPO_URL = 'https://github.com/Rexezuge-CloudflareWorkers/Durable-DAV-Router';

const DEPRECATION_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Durable-DAV</title></head>
<body>
<h1>Durable-DAV web UI deprecated</h1>
<p>The web interface built into this Durable-DAV worker is deprecated and is no longer served.</p>
<p>Use <a href="${ROUTER_REPO_URL}">Durable-DAV-Router</a> as your web UI instead. It proxies both the WebDAV and management APIs of this server.</p>
<p>WebDAV clients continue to use <code>/&lt;owner&gt;/&lt;volume&gt;/</code> as before.</p>
</body>
</html>
`;

const DEPRECATION_HEADERS: Readonly<Record<string, string>> = {
  Deprecation: 'true',
  Link: `<${ROUTER_REPO_URL}>; rel="successor-version"`,
};

export { DEPRECATION_HTML, DEPRECATION_HEADERS, ROUTER_REPO_URL };
