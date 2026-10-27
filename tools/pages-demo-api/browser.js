'use strict';
// Browser entry for the Frontend Demo PAWS API.
//
// Installs a fetch interceptor for the PAWS API origin. Each request runs
// through the real Beta API code (server/src) against the demo's in-memory,
// browser-persisted data. Sign-in comes from the existing Frontend Demo
// Firebase runtime (tools/pages-demo-runtime.js), which issues demo tokens.
const { createStore } = require('./store.js');
const { createDemoRuntime } = require('./runtime.js');
const fsShim = require('./shims/fs.js');
const { Buffer } = require('buffer');

(function install(root) {
  if (!root || root.UCVM_PAWS_DEMO_API) return;
  const store = createStore({ storage: root.localStorage });
  const route = createDemoRuntime(store);
  const nativeFetch = root.fetch.bind(root);
  const origin = () => { const value = root.PAWS_API_ORIGIN_CONFIG && root.PAWS_API_ORIGIN_CONFIG.apiOrigin; try { return value ? new URL(value).origin : null; } catch (_) { return null; } };

  async function ensureTemplate() {
    if (fsShim.existsSync('absence-from-campus-app.pdf')) return;
    const response = await nativeFetch('absence-from-campus-app.pdf', { cache: 'force-cache' });
    if (response.ok) fsShim.__preload('absence-from-campus-app.pdf', Buffer.from(new Uint8Array(await response.arrayBuffer())));
  }

  function toResponse(result) {
    const status = Number.isInteger(result && result.status) ? result.status : 503;
    const headers = new Headers({ 'X-PAWS-Frontend-Demo': '1' });
    for (const [name, value] of Object.entries((result && result.headers) || {})) if (value != null) headers.set(name, String(value));
    if (result && result.binaryBody) { headers.set('Content-Type', 'application/pdf'); headers.set('Content-Disposition', headers.get('Content-Disposition') || 'attachment; filename="afc-approved.pdf"'); return new Response(new Uint8Array(result.binaryBody), { status, headers }); }
    if (result && result.body instanceof Uint8Array) { if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/csv; charset=utf-8'); return new Response(new Uint8Array(result.body), { status, headers }); }
    if (status === 204 || status === 304) return new Response(null, { status, headers });
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json; charset=utf-8');
    return new Response(JSON.stringify(result && result.jsonBody !== undefined ? result.jsonBody : {}), { status, headers });
  }

  async function demoFetch(input, init) {
    const target = origin();
    const url = typeof input === 'string' ? input : input && input.url;
    if (!target || !url || !String(url).startsWith(target + '/')) return nativeFetch(input, init);
    const request = new Request(url, init || (typeof input === 'string' ? undefined : input));
    const path = new URL(request.url).pathname;
    if (/\/approved-artifact\/?$/.test(path)) await ensureTemplate();
    try {
      // Mirrors the University HTTP host: method and body pass through unchanged.
      return toResponse(await route(new Request('https://pages-demo.invalid' + new URL(request.url).pathname + new URL(request.url).search, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() })));
    } catch (error) {
      console.error('[PAWS Frontend Demo] request failed', path, error);
      return toResponse({ status: 503, jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The Frontend Demo service could not complete this request.' } } });
    }
  }

  root.fetch = demoFetch;
  root.UCVM_PAWS_DEMO_API = Object.freeze({ store, reset: () => store.reset(), backend: 'browser-memory', authoritative: false });
  // "Reset demo data" in the Role Tester also resets the PAWS tables.
  const hookReset = () => {
    const demo = root.UCVM_PAGES_DEMO;
    if (!demo || demo.__pawsResetHooked) return false;
    const original = demo.reset;
    try { Object.defineProperty(demo, 'reset', { value: () => { store.reset(); return original && original(); } }); } catch (_) { root.addEventListener('beforeunload', () => {}); }
    return true;
  };
  if (!hookReset()) root.addEventListener('DOMContentLoaded', hookReset, { once: true });
})(typeof window !== 'undefined' ? window : null);
