/* Guarded rollback for read-only Faculty Availability projection.
   Execute only when the API is no longer using this procedure.
   Does not mutate Faculty, Session, Calendar, AFC, Role or audit business data.
*/
IF DB_NAME()<>N'VetMed-Ops' THROW 55600,'Faculty availability rollback requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws_api.ListFacultyAvailability',N'P') IS NULL
 THROW 55600,'The expected availability procedure is missing; do not improvise rollback.',1;
DECLARE @ExpectedDefinitionSha256 varchar(64)=N'$(PAWS_AVAILABILITY_DEFINITION_SHA256)';
DECLARE @Definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListFacultyAvailability'));
IF LEN(@ExpectedDefinitionSha256)<>64 OR @ExpectedDefinitionSha256 LIKE '%[^0-9A-Fa-f]%'
 OR @Definition IS NULL OR CONVERT(varchar(64),HASHBYTES('SHA2_256',@Definition),2)<>@ExpectedDefinitionSha256
 THROW 55608,'Availability definition differs from accepted before-image; retain it for forward repair.',1;
IF EXISTS(SELECT 1 FROM sys.database_permissions WHERE major_id=OBJECT_ID(N'paws_api.ListFacultyAvailability')
 AND (grantee_principal_id<>DATABASE_PRINCIPAL_ID(N'paws_runtime_read') OR type<>'EX' OR state<>'G'))
 THROW 55608,'Availability object permissions changed; inspect before rollback.',1;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
REVOKE EXECUTE ON OBJECT::paws_api.ListFacultyAvailability FROM paws_runtime_read;
DROP PROCEDURE paws_api.ListFacultyAvailability;
COMMIT TRANSACTION;
