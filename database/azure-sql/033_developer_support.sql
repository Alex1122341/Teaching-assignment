:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53300,'Support migration requires VetMed-Ops.',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'paws.SupportContext',N'U') IS NULL
CREATE TABLE paws.SupportContext(ContextId uniqueidentifier PRIMARY KEY,ActorUid nvarchar(128) NOT NULL,TargetUid nvarchar(128) NOT NULL,Reason nvarchar(1000) NOT NULL,CreatedAtUtc datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),ExpiresAtUtc datetime2 NOT NULL,EndedAtUtc datetime2 NULL);
IF OBJECT_ID(N'paws.SupportOperation',N'U') IS NULL
CREATE TABLE paws.SupportOperation(OperationId uniqueidentifier PRIMARY KEY,ContextId uniqueidentifier NOT NULL REFERENCES paws.SupportContext(ContextId),ActorUid nvarchar(128) NOT NULL,TargetUid nvarchar(128) NOT NULL,Route nvarchar(512) NOT NULL,CreatedAtUtc datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),UndoneAtUtc datetime2 NULL,UndoActorUid nvarchar(128) NULL);
IF OBJECT_ID(N'paws.SupportChange',N'U') IS NULL
CREATE TABLE paws.SupportChange(ChangeId bigint IDENTITY PRIMARY KEY,OperationId uniqueidentifier NOT NULL REFERENCES paws.SupportOperation(OperationId),TableName nvarchar(260) NOT NULL,KeyJson nvarchar(max) NOT NULL,BeforeJson nvarchar(max) NULL,AfterJson nvarchar(max) NULL);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.SupportChange') AND name=N'IX_SupportChange_Operation')
CREATE INDEX IX_SupportChange_Operation ON paws.SupportChange(OperationId,ChangeId);
IF OBJECT_ID(N'paws.SupportTable',N'U') IS NULL
CREATE TABLE paws.SupportTable(TableName nvarchar(260) PRIMARY KEY,ColumnsSql nvarchar(max) NOT NULL,TypedSql nvarchar(max) NOT NULL,PredicateSql nvarchar(max) NOT NULL,UpdateSql nvarchar(max) NOT NULL,HasIdentity bit NOT NULL);

-- Registry and capture are fixed to the schema present at this reviewed migration.
-- A future business table needs an explicit migration before delegated writes.
DECLARE @id int,@name nvarchar(260),@columns nvarchar(max),@typed nvarchar(max),@pk nvarchar(max),@join nvarchar(max),@key nvarchar(max),@update nvarchar(max),@identity bit,@unsupported bit,@sql nvarchar(max),@first nvarchar(260);
DECLARE tables_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT t.object_id,QUOTENAME(s.name)+N'.'+QUOTENAME(t.name) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name=N'paws' AND t.name NOT LIKE N'Support%' AND t.name<>N'AuditEvent';
OPEN tables_cursor; FETCH NEXT FROM tables_cursor INTO @id,@name;
WHILE @@FETCH_STATUS=0
BEGIN
 SELECT @columns=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)),N',') WITHIN GROUP(ORDER BY c.column_id),
 @typed=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)+N' '+ty.name+CASE WHEN ty.name IN(N'nvarchar',N'nchar') THEN N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(nvarchar(10),c.max_length/2) END+N')' WHEN ty.name IN(N'varchar',N'char') THEN N'('+CASE WHEN c.max_length=-1 THEN N'max' ELSE CONVERT(nvarchar(10),c.max_length) END+N')' WHEN ty.name IN(N'decimal',N'numeric') THEN N'('+CONVERT(nvarchar(10),c.precision)+N','+CONVERT(nvarchar(10),c.scale)+N')' WHEN ty.name IN(N'datetime2',N'datetimeoffset',N'time') THEN N'('+CONVERT(nvarchar(10),c.scale)+N')' ELSE N'' END+N' ''$."'+REPLACE(c.name,N'''',N'''''')+N'"'''),N',') WITHIN GROUP(ORDER BY c.column_id)
 FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=@id AND c.is_computed=0 AND ty.name NOT IN(N'timestamp',N'rowversion');
 SELECT @unsupported=CASE WHEN EXISTS(SELECT 1 FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=@id AND c.is_computed=0 AND ty.name NOT IN(N'timestamp',N'rowversion',N'uniqueidentifier',N'nvarchar',N'varchar',N'nchar',N'char',N'bit',N'int',N'bigint',N'smallint',N'tinyint',N'decimal',N'numeric',N'float',N'real',N'money',N'smallmoney',N'date',N'datetime',N'datetime2',N'datetimeoffset',N'smalldatetime',N'time')) THEN 1 ELSE 0 END;
 SELECT @pk=STRING_AGG(CONVERT(nvarchar(max),N't.'+QUOTENAME(c.name)+N'=k.'+QUOTENAME(c.name)),N' AND '),@join=STRING_AGG(CONVERT(nvarchar(max),N'i.'+QUOTENAME(c.name)+N'=d.'+QUOTENAME(c.name)),N' AND '),@key=STRING_AGG(CONVERT(nvarchar(max),N'COALESCE(i.'+QUOTENAME(c.name)+N',d.'+QUOTENAME(c.name)+N') AS '+QUOTENAME(c.name)),N','),@first=MIN(QUOTENAME(c.name)) FROM sys.indexes ix JOIN sys.index_columns ic ON ic.object_id=ix.object_id AND ic.index_id=ix.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ix.object_id=@id AND ix.is_primary_key=1;
 SELECT @update=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)+N'=r.'+QUOTENAME(c.name)),N',') WITHIN GROUP(ORDER BY c.column_id) FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=@id AND c.is_computed=0 AND c.is_identity=0 AND ty.name NOT IN(N'timestamp',N'rowversion') AND NOT EXISTS(SELECT 1 FROM sys.indexes ix JOIN sys.index_columns ic ON ix.object_id=ic.object_id AND ix.index_id=ic.index_id WHERE ix.object_id=@id AND ix.is_primary_key=1 AND ic.column_id=c.column_id);
 SET @identity=CASE WHEN EXISTS(SELECT 1 FROM sys.columns WHERE object_id=@id AND is_identity=1) THEN 1 ELSE 0 END;
 IF @pk IS NULL OR @update IS NULL SET @unsupported=1;
 IF @unsupported=0
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM paws.SupportTable WHERE TableName=@name) INSERT paws.SupportTable VALUES(@name,@columns,@typed,@pk,@update,@identity);
  ELSE UPDATE paws.SupportTable SET ColumnsSql=@columns,TypedSql=@typed,PredicateSql=@pk,UpdateSql=@update,HasIdentity=@identity WHERE TableName=@name;
 END;
 SET @sql=N'CREATE OR ALTER TRIGGER paws.'+QUOTENAME(N'SupportCapture_'+CONVERT(nvarchar(12),@id))+N' ON '+@name+N' AFTER INSERT,UPDATE,DELETE AS BEGIN SET NOCOUNT ON; DECLARE @op uniqueidentifier=TRY_CONVERT(uniqueidentifier,SESSION_CONTEXT(N''paws_support_operation'')); IF @op IS NULL RETURN; '+
 CASE WHEN @unsupported=1 THEN N'THROW 53302,''This table is not supported for reversible support operations.'',1;' ELSE
 N'IF NOT EXISTS(SELECT 1 FROM paws.SupportOperation WHERE OperationId=@op AND UndoneAtUtc IS NULL) THROW 53302,''Support operation is not active.'',1;
 INSERT paws.SupportChange(OperationId,TableName,KeyJson,BeforeJson,AfterJson)
 SELECT @op,N'''+REPLACE(@name,N'''',N'''''')+N''',(SELECT '+@key+N' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
 CASE WHEN d.'+@first+N' IS NOT NULL THEN (SELECT '+REPLACE(@columns,N'[',N'd.[')+N' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) END,
 CASE WHEN i.'+@first+N' IS NOT NULL THEN (SELECT '+REPLACE(@columns,N'[',N'i.[')+N' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) END
 FROM inserted i FULL JOIN deleted d ON '+@join+N';' END+N' END;';
 EXEC sys.sp_executesql @sql;
 SET @pk=NULL; SET @join=NULL; SET @key=NULL; SET @update=NULL;
 FETCH NEXT FROM tables_cursor INTO @id,@name;
END;
CLOSE tables_cursor; DEALLOCATE tables_cursor;
COMMIT;
GO
CREATE OR ALTER PROCEDURE paws_api.UndoSupportOperation @OperationId uniqueidentifier,@ActorUid nvarchar(128)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=@ActorUid AND BaseRole=N'developer' AND Active=1 AND MustChangePassword=0) THROW 53303,'Developer identity required.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM paws.SupportOperation WITH(UPDLOCK,HOLDLOCK) WHERE OperationId=@OperationId AND ActorUid=@ActorUid AND UndoneAtUtc IS NULL) THROW 53304,'Operation is absent, already undone or belongs to another developer.',1;
 DECLARE @table nvarchar(260),@key nvarchar(max),@before nvarchar(max),@after nvarchar(max),@current nvarchar(max),@cols nvarchar(max),@typed nvarchar(max),@pk nvarchar(max),@set nvarchar(max),@identity bit,@sql nvarchar(max);
 DECLARE changes_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT TableName,KeyJson,BeforeJson,AfterJson FROM paws.SupportChange WHERE OperationId=@OperationId ORDER BY ChangeId DESC;
 OPEN changes_cursor; FETCH NEXT FROM changes_cursor INTO @table,@key,@before,@after;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SELECT @cols=ColumnsSql,@typed=TypedSql,@pk=PredicateSql,@set=UpdateSql,@identity=HasIdentity FROM paws.SupportTable WHERE TableName=@table;
  IF @cols IS NULL THROW 53302,'Recovery schema is unavailable.',1;
  SET @current=NULL;
  SET @sql=N'SELECT @current=(SELECT '+REPLACE(@cols,N'[',N't.[')+N' FROM '+@table+N' t WITH(UPDLOCK,HOLDLOCK) CROSS JOIN OPENJSON(@key) WITH('+@typed+N') k WHERE '+@pk+N' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);';
  EXEC sys.sp_executesql @sql,N'@key nvarchar(max),@current nvarchar(max) OUTPUT',@key,@current OUTPUT;
  SET @current=NULLIF(@current,N'');
  IF (@current IS NULL AND @after IS NOT NULL) OR (@current IS NOT NULL AND @after IS NULL) OR @current COLLATE Latin1_General_100_BIN2 <> @after COLLATE Latin1_General_100_BIN2 THROW 53305,'Records changed after this operation. Undo refused; no changes restored.',1;
  IF @before IS NULL SET @sql=N'DELETE t FROM '+@table+N' t CROSS JOIN OPENJSON(@key) WITH('+@typed+N') k WHERE '+@pk+N';';
  ELSE IF @after IS NOT NULL SET @sql=N'UPDATE t SET '+@set+N' FROM '+@table+N' t CROSS JOIN OPENJSON(@key) WITH('+@typed+N') k CROSS JOIN OPENJSON(@row) WITH('+@typed+N') r WHERE '+@pk+N';';
  ELSE SET @sql=CASE WHEN @identity=1 THEN N'SET IDENTITY_INSERT '+@table+N' ON;' ELSE N'' END+N'INSERT '+@table+N' ('+@cols+N') SELECT '+@cols+N' FROM OPENJSON(@row) WITH('+@typed+N');'+CASE WHEN @identity=1 THEN N'SET IDENTITY_INSERT '+@table+N' OFF;' ELSE N'' END;
  EXEC sys.sp_executesql @sql,N'@key nvarchar(max),@row nvarchar(max)',@key,@before;
  SET @cols=NULL;
  FETCH NEXT FROM changes_cursor INTO @table,@key,@before,@after;
 END;
 CLOSE changes_cursor; DEALLOCATE changes_cursor;
 UPDATE paws.SupportOperation SET UndoneAtUtc=SYSUTCDATETIME(),UndoActorUid=@ActorUid WHERE OperationId=@OperationId;
 INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson) VALUES(NEWID(),N'developer_support_undo',N'support_operation',CONVERT(nvarchar(36),@OperationId),@ActorUid,SYSUTCDATETIME(),N'{"guarded":true}');
 COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; THROW; END CATCH;
END;
