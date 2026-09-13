const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'faculty-admin.html'), 'utf8');

test('Assigned AD is removed from faculty lookup, editor, filters, and exports', () => {
  assert.doesNotMatch(source, /id="filter-ad"|field\('Assigned AD'|\['assignedAD'|\['assignedAD','Assigned AD'/);
});

test('an existing DOE override is highlighted beside the faculty name', () => {
  assert.match(source, /doeOverride2026_27/);
  assert.match(source, /function overrideOf\(r\)\{const o=r\?\.doeOverride2026_27;return o&&numeric\(o\.value\)!==null\?o:null\}/);
  assert.match(source, /Override DOE \$\{Number\(o\.value\)\.toFixed\(2\)\}%/);
  assert.match(source, /override-badge/);
  assert.match(source, /Office DOE Override/);
});
