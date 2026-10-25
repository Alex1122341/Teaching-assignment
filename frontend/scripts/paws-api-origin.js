(function (root, factory) {
  'use strict';
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.PAWS_API_ORIGIN_CONFIG = config;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  // The API origin used to be a temporary Cloudflare Tunnel URL committed into
  // this file, which meant the lab broke whenever that tunnel closed and could
  // never be reproduced by anyone else. It now follows paws-runtime-config.js.
  //
  // An empty origin means same-origin: the browser calls `/api/v1/*` on whatever
  // host served the page. That is the intended lab arrangement, and it removes
  // the cross-origin preflight entirely.
  const runtime = (typeof globalThis !== 'undefined' && globalThis.PAWS_RUNTIME_CONFIG) || {};
  const origin = String(runtime.apiOrigin || '').replace(/\/+$/, '');

  return Object.freeze({
    apiOrigin: origin,
    releaseLabel: origin ? 'EXTERNAL API ORIGIN' : 'SAME-ORIGIN API',
    // A tunnel URL must never be committed again; this flag exists so a stray
    // reintroduction is visible in code review and testable.
    temporaryIngress: false
  });
});
