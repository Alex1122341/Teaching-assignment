'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'database/azure-sql/016_session_edit_boundary_reconciliation.sql'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(root, 'database/azure-sql/012_session_edit_api.sql'), 'utf8').replace(/\r\n/g, '\n');
const targetHash = 'F09724E9BF3BD9A2D5286B9F00FF1B88049FFD9173103CE162FA2D7571A9AFB0';

function canonicalizeProcedureDefinition(definition) {
  let canonical = definition.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  const header = /^(CREATE OR ALTER PROCEDURE|CREATE PROCEDURE|CREATE   PROCEDURE|ALTER PROCEDURE)(?=\s)/;
  assert.match(canonical, header, 'procedure header must be one of the explicitly approved forms');
  canonical = canonical.replace(header, 'CREATE OR ALTER PROCEDURE');
  return canonical;
}

function embeddedProcedure() {
  const match = migration.match(/DECLARE @TargetDefinition nvarchar\(max\) = N'([\s\S]*?)';\n\s+EXEC sys\.sp_executesql @TargetDefinition;/);
  assert.ok(match, 'migration must contain the exact procedure body as dynamic SQL');
  return match[1].replace(/''/g, "'");
}

test('migration 016 embeds the exact migration 012 procedure and its reviewed canonical hash', () => {
  const expected = source.slice(source.indexOf('CREATE OR ALTER PROCEDURE paws_api.UpdateCalendarSession')).replace(/\nGO\s*$/s, '').trimEnd() + '\n';
  assert.equal(embeddedProcedure(), expected);
  const canonicalDefinition = canonicalizeProcedureDefinition(expected);
  assert.equal(crypto.createHash('sha256').update(canonicalDefinition, 'utf16le').digest('hex').toUpperCase(), targetHash);
  assert.match(source, /@NextDate\s*<\s*DATEFROMPARTS\(TRY_CONVERT\(int, LEFT\(@AcademicYear, 4\)\), 5, 1\)/i);
  assert.match(source, /@NextDate\s*>=\s*DATEFROMPARTS\(TRY_CONVERT\(int, LEFT\(@AcademicYear, 4\)\) \+ 1, 5, 1\)/i);
});

test('migration 016 canonicalizes only line endings, edge line breaks, and the procedure header', () => {
  const body = 'AS\nBEGIN\n    SELECT  1;\nEND;';
  const acceptedHeaders = [
    'CREATE OR ALTER PROCEDURE',
    'CREATE PROCEDURE',
    'CREATE   PROCEDURE',
    'ALTER PROCEDURE'
  ];
  for (const header of acceptedHeaders) {
    const actual = `\r\n${header} paws_api.UpdateCalendarSession\r\n${body}\r\n`;
    assert.equal(canonicalizeProcedureDefinition(actual), `CREATE OR ALTER PROCEDURE paws_api.UpdateCalendarSession\n${body}`);
  }
  assert.notEqual(
    canonicalizeProcedureDefinition('CREATE PROCEDURE paws_api.UpdateCalendarSession\nAS\nBEGIN\n    SELECT 1;\nEND;'),
    canonicalizeProcedureDefinition('CREATE PROCEDURE paws_api.UpdateCalendarSession\nAS\nBEGIN\n    SELECT  1;\nEND;'),
    'body whitespace must remain significant'
  );
  assert.match(migration, /@ExpectedTargetCanonicalHash/);
  assert.match(migration, /@FinalCanonicalHash/);
  assert.match(migration, /@CurrentRawHash\s*=\s*@ExpectedWeakerHash/);
  assert.match(migration, /@CurrentCanonicalHash\s*<>\s*@ExpectedTargetCanonicalHash/);
  assert.match(migration, /@FinalCanonicalHash\s*<>\s*@ExpectedTargetCanonicalHash/);
  assert.doesNotMatch(migration, /@FinalHash\s*<>\s*@ExpectedTargetHash/);
});

test('migration 016 only accepts the audited weaker definition or an already-compliant definition', () => {
  assert.match(migration, /0A4459A9E254D65144D3E3A0F7097F5C01D20F90365B4BC2F557D34941994E57/);
  assert.match(migration, new RegExp(targetHash));
  assert.match(migration, /IF\s+@CurrentRawHash\s*=\s*@ExpectedWeakerHash[\s\S]*?EXEC\s+sys\.sp_executesql/i);
  assert.match(migration, /IF\s+@CurrentRawHash\s+<>\s*@ExpectedWeakerHash\s+AND\s+@CurrentCanonicalHash\s+<>\s*@ExpectedTargetCanonicalHash[\s\S]*?THROW\s+51602/i);
  assert.match(migration, /IF\s+@FinalCanonicalHash\s+<>\s*@ExpectedTargetCanonicalHash[\s\S]*?THROW\s+51603/i);
  assert.match(migration, /BEGIN TRANSACTION[\s\S]*?COMMIT TRANSACTION[\s\S]*?BEGIN CATCH[\s\S]*?ROLLBACK TRANSACTION/i);
  assert.match(migration, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
});

test('migration 016 preserves audited transaction, actor, audit, allowlist, and no-assignment-mutation invariants', () => {
  const procedure = embeddedProcedure();
  for (const invariant of [/BEGIN TRANSACTION/i, /IF XACT_STATE\(\) <> 0 ROLLBACK TRANSACTION/i, /@ActorFirebaseUid/i, /@ActorName/i, /INSERT paws\.AuditEvent/i, /@Fields[\s\S]*?NOT IN[\s\S]*?date[\s\S]*?room/i, /IF EXISTS\s*\([\s\S]*?THROW 51246/i]) {
    assert.match(procedure, invariant);
  }
  assert.doesNotMatch(procedure, /SessionAssignment|INSERT\s+paws\.SessionAssignment|UPDATE\s+paws\.SessionAssignment|DELETE\s+FROM\s+paws\.SessionAssignment/i);
  assert.doesNotMatch(migration, /\bGRANT\b|\bDENY\b|\bREVOKE\b/i);
});
