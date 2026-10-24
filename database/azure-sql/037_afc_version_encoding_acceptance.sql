:ON ERROR EXIT
SET NOCOUNT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53701,'AFC encoding acceptance requires VetMed-Ops.',1;
IF EXISTS(SELECT 1 FROM paws.vAfcRecordUnified WHERE VersionToken IS NULL OR DATALENGTH(VersionToken)<>16 OR VersionToken COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9A-Fa-f]%')
 THROW 53701,'AFC view must expose canonical 16-character hexadecimal tokens.',1;
PRINT 'AFC_VERSION_ENCODING_REGRESSION_OK';
