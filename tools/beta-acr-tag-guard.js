'use strict';

const fs = require('node:fs');

const ABSENT_TAG_ERROR = /MANIFEST_UNKNOWN|manifest[^\r\n]*(?:not found|does not exist)|tag[^\r\n]*not found|the specified tag does not exist/i;

function classifyAcrTagLookup({ status, stderr }) {
  if (Number(status) === 0) {
    return 'EXISTS';
  }

  return ABSENT_TAG_ERROR.test(String(stderr ?? '')) ? 'ABSENT' : 'UNKNOWN_ERROR';
}

if (require.main === module) {
  const status = Number(process.argv[2]);
  const stderrPath = process.argv[3];

  if (!Number.isInteger(status) || !stderrPath) {
    throw new Error('Usage: node tools/beta-acr-tag-guard.js <status> <stderr-file>');
  }

  const classification = classifyAcrTagLookup({
    status,
    stderr: fs.readFileSync(stderrPath, 'utf8'),
  });
  process.stdout.write(`${classification}\n`);
}

module.exports = { classifyAcrTagLookup };
