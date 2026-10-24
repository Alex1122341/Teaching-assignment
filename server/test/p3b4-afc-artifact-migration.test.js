'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', '..', 'database', 'azure-sql', '011_afc_approved_artifact.sql');
const rollbackPath = path.join(__dirname, '..', '..', 'database', 'azure-sql', 'rollback_011_afc_approved_artifact.sql');

function readSql(filePath, label) {
  assert.ok(fs.existsSync(filePath), `${label} must exist; this test reads SQL text and never executes it`);
  return fs.readFileSync(filePath, 'utf8');
}

function procedure(sql, name) {
  const start = sql.search(new RegExp(`CREATE\\s+PROCEDURE\\s+paws_api\\.${name}\\b`, 'i'));
  assert.notEqual(start, -1, `procedure paws_api.${name} must be defined`);
  const endMatch = /^GO\s*$/gim;
  endMatch.lastIndex = start;
  const end = endMatch.exec(sql)?.index ?? sql.length;
  return sql.slice(start, end);
}

test('011 is additive and defines one immutable, size-bounded SQL artifact row per AFC request', () => {
  const sql = readSql(migrationPath, 'forward migration');
  for (const token of [
    "SCHEMA_ID(N'paws')",
    "SCHEMA_ID(N'paws_api')",
    "OBJECT_ID(N'paws.AfcRequest', N'U')",
    "OBJECT_ID(N'paws.AfcApproval', N'U')",
    "OBJECT_ID(N'paws.AuditEvent', N'U')",
    'CREATE TABLE paws.AfcArtifact',
    'AfcArtifactId uniqueidentifier NOT NULL',
    'AfcRequestId uniqueidentifier NOT NULL',
    'CONSTRAINT UQ_AfcArtifact_AfcRequest UNIQUE (AfcRequestId)',
    'ContentType varchar(64) NOT NULL',
    'PdfBytes varbinary(max) NOT NULL',
    'PdfSha256 binary(32) NOT NULL',
    'ByteLength int NOT NULL',
    'SourceSnapshotSha256 binary(32) NOT NULL',
    'TemplateSha256 binary(32) NOT NULL',
    'RendererVersion nvarchar(64) NOT NULL',
    'CreatedAtUtc datetime2(7) NOT NULL',
    'CreatedByFirebaseUid nvarchar(128) NOT NULL',
    'DATALENGTH(PdfBytes) = ByteLength',
    'DATALENGTH(PdfBytes) <= 8388608',
  ]) assert.ok(sql.includes(token), token);
  assert.deepEqual(
    [...sql.matchAll(/CREATE\s+PROCEDURE\s+paws_api\.([A-Za-z0-9_]+)/gi)].map((match) => match[1]),
    ['GetApprovedAfcArtifactSource', 'CreateOrGetApprovedAfcArtifact', 'GetApprovedAfcArtifact'],
  );
  assert.match(sql, /CONSTRAINT\s+FK_AfcArtifact_AfcRequest\s+FOREIGN KEY\s*\(AfcRequestId\)\s+REFERENCES\s+paws\.AfcRequest\s*\(AfcRequestId\)/i);
  assert.match(sql, /ContentType\s+COLLATE\s+Latin1_General_100_BIN2\s*=\s*'application\/pdf'/i);
  assert.match(sql, /OBJECT_ID\(N'paws\.AfcArtifact',\s*N'U'\)\s+IS\s+NOT\s+NULL/i);
  assert.match(sql, /OBJECT_ID\(N'paws_api\.GetApprovedAfcArtifactSource',\s*N'P'\)\s+IS\s+NOT\s+NULL/i);
  assert.doesNotMatch(sql, /\bGRANT\s+/i);
});

test('source and artifact procedures use active profiles, final SQL approval, and actor scope', () => {
  const sql = readSql(migrationPath, 'forward migration');
  for (const name of ['GetApprovedAfcArtifactSource', 'CreateOrGetApprovedAfcArtifact', 'GetApprovedAfcArtifact']) {
    const body = procedure(sql, name);
    assert.ok(body.includes('@ActorFirebaseUid'), `${name} accepts the actor UID as its identity input`);
    assert.match(body, /@RequestStatus\s+COLLATE[\s\S]*?<>\s*N?'approved'/i, `${name} requires final request approval`);
    assert.match(body, /RequesterFirebaseUid|ApproverFirebaseUid/i, `${name} checks request/actual approver scope`);
    assert.match(body, /Active\s*=\s*1/i, `${name} requires an active SQL profile`);
    assert.match(body, /MustChangePassword\s*=\s*0/i, `${name} rejects password-change-required profiles`);
    assert.match(body, /N'owner'.*N'administrator'.*N'adfa_general'.*N'adfa_regular'.*N'admin'/is, `${name} uses the established active administrator roles`);
  }
  const source = procedure(sql, 'GetApprovedAfcArtifactSource');
  assert.match(source, /Stage\s+COLLATE[\s\S]*?=\s*N?'admin'[\s\S]*?Status\s+COLLATE[\s\S]*?=\s*N?'approved'/i);
  assert.match(source, /@ReportToFirebaseUid\s+IS\s+NOT\s+NULL[\s\S]*?Stage\s+COLLATE[\s\S]*?=\s*N?'report_to'[\s\S]*?Status\s+COLLATE[\s\S]*?=\s*N?'approved'/i);
});

test('authoritative snapshot JSON is deterministic and hashes the UTF-16LE NVARCHAR bytes', () => {
  const sql = readSql(migrationPath, 'forward migration');
  const source = procedure(sql, 'GetApprovedAfcArtifactSource');
  assert.match(source, /FOR\s+JSON\s+PATH[\s\S]*?INCLUDE_NULL_VALUES/i, 'source procedure preserves a fixed null-inclusive JSON shape');
  assert.match(source, /ORDER\s+BY[\s\S]*?Stage/i, 'source procedure orders approval stages deterministically');
  assert.match(source, /ApplicantSignatureImageDataUrl/i);
  assert.match(source, /SignatureImageDataUrl/i);
  assert.match(source, /INNER\s+JOIN\s+paws\.Faculty\s+AS\s+f/i);
  for (const column of ['f.Ucid AS employeeId', 'f.PreferredFirstName AS preferredFirstName', 'f.PreferredLastName AS preferredLastName', 'f.Rank AS rank']) {
    assert.ok(source.includes(column), column);
  }
  assert.match(source, /CONVERT\s*\(\s*varbinary\s*\(\s*max\s*\)\s*,\s*@SourceSnapshotJson\s*\)/i, 'source procedure hashes SQL NVARCHAR code units');
  assert.match(source, /HASHBYTES\s*\(\s*'SHA2_256'/i);
  const create = procedure(sql, 'CreateOrGetApprovedAfcArtifact');
  assert.match(create, /INSERT\s+INTO\s+@CurrentSource\s*\([\s\S]*?EXEC\s+paws_api\.GetApprovedAfcArtifactSource/i);
  const specPath = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'specs', '2026-10-04-p3b4-afc-approved-artifact.md');
  const spec = readSql(specPath, 'approved specification');
  assert.match(spec, /UTF-16LE/i, 'Node must use Buffer.from(snapshotJson, \'utf16le\') to match SQL CONVERT(varbinary(max), nvarchar)');
  assert.match(spec, /Buffer\.from\(sourceSnapshotJson,\s*['"]utf16le['"]\)/, 'specification names the exact Node encoding');
  assert.match(spec, /UTF-8 must not be substituted/i, 'specification rules out a different hash encoding');
});

test('known snapshot hash fixture matches SQL NVARCHAR UTF-16LE bytes and differs from UTF-8', () => {
  const sourceSnapshotJson = '{"facultyName":"Zoë Faculty 🐾","approvals":[]}';
  const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const sqlNvarcharBytes = Buffer.from(sourceSnapshotJson, 'utf16le');

  assert.equal(hash(sqlNvarcharBytes), 'ef8758574c4644671cb99d2d107ad53cb618bfccf9ddf436595d329d6cd51f76');
  assert.notEqual(hash(Buffer.from(sourceSnapshotJson, 'utf8')), hash(sqlNvarcharBytes));

  const sql = readSql(migrationPath, 'forward migration');
  assert.match(sql, /HASHBYTES\s*\(\s*'SHA2_256'\s*,\s*CONVERT\s*\(\s*varbinary\s*\(\s*max\s*\)\s*,\s*@SourceSnapshotJson\s*\)\s*\)/i);
});

test('create-if-absent validates binary integrity, serializes requests, inserts once, and audits without PDF or signature PII', () => {
  const sql = readSql(migrationPath, 'forward migration');
  const body = procedure(sql, 'CreateOrGetApprovedAfcArtifact');
  for (const token of [
    '@SourceSnapshotSha256 binary(32)',
    '@PdfBytes varbinary(max)',
    '@PdfSha256 binary(32)',
    '@ByteLength int',
    '@TemplateSha256 binary(32)',
    "'Exclusive'",
    "'Transaction'",
    'BEGIN TRANSACTION',
    'paws.AfcArtifact',
    'afc_artifact_created',
    'HASHBYTES',
    'DATALENGTH(@PdfBytes)',
    '8388608',
    'SourceSnapshotSha256',
  ]) assert.ok(body.includes(token), token);
  assert.match(body, /IF\s+EXISTS\s*\([\s\S]*?FROM\s+paws\.AfcArtifact[\s\S]*?SELECT[\s\S]*?PdfBytes/i, 'retries return the existing bytes');
  assert.match(body, /@CurrentSourceSnapshotSha256\s*<>\s*@SourceSnapshotSha256/i, 'a stale source snapshot fails closed');
  assert.match(body, /INSERT\s+INTO\s+paws\.AfcArtifact/i);
  const auditStart = body.lastIndexOf('INSERT INTO paws.AuditEvent');
  assert.notEqual(auditStart, -1, 'creation writes one audit event');
  const auditEnd = body.indexOf(');', auditStart);
  assert.notEqual(auditEnd, -1, 'audit values statement is complete');
  const audit = body.slice(auditStart, auditEnd);
  assert.match(audit, /N'afc_artifact_created'/i);
  assert.doesNotMatch(audit, /PdfBytes|SignatureImageDataUrl|ApplicantSignatureImageDataUrl|ContactAddress|ContactPhone|RequesterEmail|Coverage/i);
  assert.doesNotMatch(body, /UPDATE\s+paws\.AfcArtifact|DELETE\s+FROM\s+paws\.AfcArtifact/i);
});

test('GET procedure reads only stored artifact rows and rollback refuses data loss', () => {
  const sql = readSql(migrationPath, 'forward migration');
  const getArtifact = procedure(sql, 'GetApprovedAfcArtifact');
  assert.match(getArtifact, /SELECT[\s\S]*?PdfBytes[\s\S]*?FROM\s+paws\.AfcArtifact/i);
  assert.doesNotMatch(getArtifact, /INSERT\s+INTO\s+paws\.AfcArtifact|UPDATE\s+paws\.AfcArtifact|DELETE\s+FROM\s+paws\.AfcArtifact|INSERT\s+INTO\s+paws\.AuditEvent/i);

  const rollback = readSql(rollbackPath, 'rollback migration');
  assert.match(rollback, /IF\s+OBJECT_ID\(N'paws\.AfcArtifact',[\s\S]*?EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+paws\.AfcArtifact[\s\S]*?THROW/i);
  assert.doesNotMatch(rollback, /^\s*GO\s*$/im, 'rollback data guard and drops must stay in one batch so a client cannot continue past THROW');
  for (const name of ['GetApprovedAfcArtifactSource', 'CreateOrGetApprovedAfcArtifact', 'GetApprovedAfcArtifact']) {
    assert.match(rollback, new RegExp(`DROP\\s+PROCEDURE\\s+paws_api\\.${name}`, 'i'));
  }
  assert.match(rollback, /DROP\s+TABLE\s+paws\.AfcArtifact/i);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|PROCEDURE|INDEX|VIEW)\s+paws\.(?:AfcRequest|AfcApproval|AfcRecord|AfcManualRecord)\b/i);
  assert.doesNotMatch(rollback, /\bGRANT\s+/i);
});

test('011 identity and audit field widths match the established foundation schema', () => {
  const migration = readSql(migrationPath, 'forward migration');
  const foundation = readSql(path.join(__dirname, '..', '..', 'database', 'azure-sql', '001_foundation.sql'), 'foundation schema');
  assert.match(foundation, /CREATE TABLE paws\.UserProfile\s*\([\s\S]*?FirebaseUid\s+nvarchar\(128\)[\s\S]*?MustChangePassword\s+bit\s+NOT NULL/i);
  assert.match(foundation, /CREATE TABLE paws\.AuditEvent\s*\([\s\S]*?ActorFirebaseUid\s+nvarchar\(128\)[\s\S]*?ActorName\s+nvarchar\(260\)\s+NULL/i);
  assert.equal([...migration.matchAll(/@ActorFirebaseUid\s+nvarchar\((\d+)\)/gi)].every((match) => match[1] === '128'), true);
  assert.match(migration, /CreatedByFirebaseUid\s+nvarchar\(128\)\s+NOT NULL/i);
  assert.match(migration, /@ActorFirebaseUid\s*,\s*NULL\s*,\s*@Now/i, 'artifact audit actor name is nullable and receives no untrusted name');
});

test('011 remains additive and uses only the 009/010 AFC request, approval, profile, faculty and audit contracts', () => {
  const migration = readSql(migrationPath, 'forward migration');
  assert.match(migration, /CREATE TABLE\s+paws\.AfcArtifact/i);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\s+paws\.(?:AfcRequest|AfcApproval|UserProfile|AuditEvent|Faculty)\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|PROCEDURE|INDEX|VIEW)\s+paws\.(?:AfcRequest|AfcApproval|UserProfile|AuditEvent|Faculty|vAfcRecordUnified)\b/i);
  assert.doesNotMatch(migration, /\bGRANT\s+/i);
  for (const procedureName of ['GetApprovedAfcArtifactSource', 'CreateOrGetApprovedAfcArtifact', 'GetApprovedAfcArtifact']) {
    assert.match(migration, new RegExp(`CREATE\\s+PROCEDURE\\s+paws_api\\.${procedureName}\\b`, 'i'));
  }
  assert.doesNotMatch(migration, /CREATE\s+OR\s+ALTER\s+PROCEDURE/i, '011 must never replace an existing procedure definition');
});
