-- SQLCMD/apply-time variable. Example value is the App Service managed-identity principal name.
-- :setvar PAWS_API_PRINCIPAL "paws-api-app-service"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(PAWS_API_PRINCIPAL)')
BEGIN
    EXEC(N'CREATE USER [' + REPLACE(N'$(PAWS_API_PRINCIPAL)', N']', N']]') + N'] FROM EXTERNAL PROVIDER');
END;

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::paws TO [$(PAWS_API_PRINCIPAL)];
GRANT EXECUTE ON SCHEMA::paws TO [$(PAWS_API_PRINCIPAL)];
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::staging TO [$(PAWS_API_PRINCIPAL)];
