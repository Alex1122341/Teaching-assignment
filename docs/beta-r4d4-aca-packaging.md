# PAWS BETA-R4D-4 ACA packaging

Status: **NOT YET DEPLOYED**

This change prepares, but does not deploy, the PAWS Functions-on-Azure-Container-Apps package.

## Runtime boundary

```text
Browser
  ↓ HTTPS
Firebase Authentication
  ↓ Firebase ID token
PAWS Functions on Azure Container Apps
  ↓ UAMI: paws-sql-beta-mi
Azure SQL
```

The SQL runtime accepts `PAWS_SQL_CONNECTION_STRING` for the endpoint/database
and optionally `PAWS_SQL_MI_CLIENT_ID` for the user-assigned managed identity.
When the MI variable is present, the `mssql`/Tedious configuration uses
`azure-active-directory-default`, passes the client ID, enables encryption, and
disables trusting the server certificate. The endpoint configuration must not
contain a SQL username, SQL password, client secret, or static access token.
Without the MI variable, the existing legacy connection-string mode remains
available for the current test contract.

Firebase Authentication is unchanged: `verifyIdToken(token, true)` is still
used before the exact Firebase UID is authorized through SQL `UserProfile`.

## Image packaging

Build the deterministic API artifact first:

```text
node tools/build-swa-api.js --output .azure-production/api
```

The image in `deploy/aca/Dockerfile` copies that artifact to
`/home/site/wwwroot` and runs `npm ci --omit=dev` from its locked package.
The image uses the official `mcr.microsoft.com/azure-functions/node:4-node22`
base. No local `node_modules`, Firebase credentials, Azure identifiers, or SQL
credentials belong in the build context.

The separate host identity `paws-function-host-mi` is intended for ACR image
pull and Functions host storage. It is not the SQL identity.

## Explicit non-goals

- No App Registration.
- No client secret.
- No SQL password.
- No direct browser-to-SQL connection.
- No ACR login or image push.
- No Container App, Function App, revision, ingress, SQL principal, or Azure deployment.

