const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('AFC form values normalize allowlisted dropdown values and contact details', () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'afc-form-values.js'), 'utf8'), context);
  const api = context.window.UCVM_AFC_FORM_VALUES;

  assert.equal(api.PRIMARY_DEPARTMENT, '30060 - Faculty of Veterinary Medicine');
  assert.equal(api.rank(' Assistant Professor '), 'Assistant Professor - AC0003');
  assert.equal(api.rank('Associate Professor (Teaching)'), 'Associate Professor (Teaching) - AC0007');
  assert.equal(api.rank('Unknown'), '');
  assert.equal(api.appointment('Tenure'), 'With Tenure');
  assert.equal(api.appointment('tenure-track'), 'Tenure-track');
  assert.equal(api.appointment('unrecognized'), '');
  const contact = api.contact({contactAddress: ' 2500 University Dr ', contactPhone: ' 403-555-1212 '});
  assert.equal(contact.address, '2500 University Dr');
  assert.equal(contact.phone, '403-555-1212');
});
