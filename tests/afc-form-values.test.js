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

test('AFC PDF loader loads canonical form values before the renderer', () => {
  const loader = fs.readFileSync(path.join(root, 'asset-loader.js'), 'utf8');
  const valuesPosition = loader.indexOf("loadScriptOnce('afc-form-values.js'");
  const rendererPosition = loader.indexOf("loadScriptOnce('afc-pdf-browser.js'");
  assert.ok(valuesPosition >= 0, 'loader includes canonical AFC form values');
  assert.ok(rendererPosition > valuesPosition, 'canonical values load before PDF renderer');
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'tools/static-assets.json'), 'utf8')).includes('afc-form-values.js'));
});
