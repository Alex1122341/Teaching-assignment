'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const forward = fs.readFileSync(path.join(root, 'database/azure-sql/014_doe_rule_book_and_fte_provenance.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'database/azure-sql/rollback_014_doe_rule_book_and_fte_provenance.sql'), 'utf8');

test('014 adds version linkage to existing DOE rules and auditable Faculty FTE provenance idempotently', () => {
  assert.match(forward, /ALTER TABLE\s+paws\.DoeRuleSeed\s+ADD\s+PolicyVersionId\s+uniqueidentifier\s+NULL/i);
  assert.match(forward, /FOREIGN KEY\s*\(PolicyVersionId\)\s*REFERENCES\s+paws\.DoePolicyVersion\s*\(PolicyVersionId\)/i);
  assert.match(forward, /ALTER TABLE\s+paws\.Faculty\s+ADD\s+FteSourceReference\s+nvarchar\(512\)\s+NULL/i);
  assert.match(forward, /FteSourceRow\s+int\s+NULL/i);
  assert.match(forward, /FteSourceUpdatedAtUtc\s+datetime2/i);
  assert.match(forward, /IF\s+COL_LENGTH\s*\(/i);
  assert.match(forward, /BEGIN\s+TRANSACTION/i);
  assert.match(forward, /XACT_ABORT\s+ON/i);
});

test('014 rollback refuses to remove populated provenance or versioned rule references', () => {
  assert.match(rollback, /PolicyVersionId\s+IS\s+NOT\s+NULL/i);
  assert.match(rollback, /FteSourceReference\s+IS\s+NOT\s+NULL/i);
  assert.match(rollback, /THROW/i);
  assert.match(rollback, /DROP\s+COLUMN\s+PolicyVersionId/i);
  assert.match(rollback, /DROP\s+COLUMN\s+FteSourceReference/i);
});
