'use strict';

// App Service managed-identity token acquisition for Azure SQL.
//
// This lived inside the old `sql-session-repository.js`. It is separated out
// because the ported PAWS repositories no longer own credential acquisition:
// `sql-connection.js` takes a token provider, and both the runtime and the
// repositories share one connection. Keeping the token logic inside a
// repository would have tied credentials to whichever repository happened to be
// constructed first.

const SQL_RESOURCE = 'https://database.windows.net/';

const text = value => String(value ?? '').trim();

async function requestManagedIdentityPayload({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = text(env.IDENTITY_ENDPOINT);
  const header = text(env.IDENTITY_HEADER);
  if (!endpoint || !header || typeof fetchImpl !== 'function') {
    throw Object.assign(Error('Azure App Service managed identity is not available.'), { code: 'SQL_IDENTITY_UNAVAILABLE', statusCode: 503 });
  }
  const url = new URL(endpoint);
  url.searchParams.set('resource', SQL_RESOURCE);
  url.searchParams.set('api-version', '2019-08-01');
  const response = await fetchImpl(url, { method: 'GET', headers: { 'X-IDENTITY-HEADER': header } });
  if (!response.ok) {
    throw Object.assign(Error('Azure managed identity token request failed.'), { code: 'SQL_IDENTITY_TOKEN_FAILED', statusCode: 503 });
  }
  const payload = await response.json();
  const token = text(payload?.access_token);
  if (!token) throw Object.assign(Error('Azure managed identity returned no SQL access token.'), { code: 'SQL_IDENTITY_TOKEN_MISSING', statusCode: 503 });
  return { token, expiresOn: payload?.expires_on };
}

// Plain-string contract, retained for callers that only need the token.
async function appServiceManagedIdentityToken(options = {}) {
  const { token } = await requestManagedIdentityPayload(options);
  return token;
}

// Token plus Azure's reported expiry, so the shared connection can rebuild its
// pool before the bound token goes stale.
function appServiceManagedIdentityTokenWithExpiry(options = {}) {
  return requestManagedIdentityPayload(options);
}

module.exports = {
  SQL_RESOURCE,
  appServiceManagedIdentityToken,
  appServiceManagedIdentityTokenWithExpiry,
  requestManagedIdentityPayload
};
