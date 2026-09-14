const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'faculty-dashboard.html'), 'utf8');

test('faculty dashboard exposes the AFC request and review tab', () => {
  assert.match(html, /id="afc-tab"/);
  assert.match(html, /id="afc-panel"/);
  assert.match(html, /asset-loader\.js/);
  assert.doesNotMatch(html, /pdf-lib/);
  assert.match(html, /afc-workflow\.js/);
});

test('AFC UI collects dates, conditional details, coverage, and electronic signature', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  for (const field of ['startDate','endDate','reason','purposeDestination','coverage','applicantSignature','UCVM_SIGNATURE']) assert.match(source, new RegExp(field));
  assert.match(fs.readFileSync(path.join(root, 'afc-actions.js'), 'utf8'), /pdf_chunks/);
});

test('AFC UI requires contact details for each new request', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  assert.match(source, /name="contactAddress"[^>]*required[^>]*maxlength="500"/);
  assert.match(source, /name="contactPhone"[^>]*required[^>]*maxlength="50"/);
  assert.match(source, /contactAddress=String\(d\.get\('contactAddress'\)\|\|''\)\.trim\(\)/);
  assert.match(source, /contactPhone=String\(d\.get\('contactPhone'\)\|\|''\)\.trim\(\)/);
  assert.match(source, /coverage,contactAddress,contactPhone,workDays/);
});

test('AFC teaching matches render as a vertical sorted list', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  assert.match(source, /class="afc-teaching-list"/);
  assert.match(source, /String\(a\.date\|\|''\)\.localeCompare\(String\(b\.date\|\|''\)\)/);
  assert.match(source, /String\(a\.start\|\|''\)\.localeCompare\(String\(b\.start\|\|''\)\)/);
  assert.match(source, /String\(a\.course\|\|''\)\.localeCompare\(String\(b\.course\|\|''\)\)/);
  assert.match(source, /String\(a\.topic\|\|a\.type\|\|''\)\.localeCompare\(String\(b\.topic\|\|b\.type\|\|''\)\)/);
  assert.doesNotMatch(source, /teaching assignment\(s\) found:.*\.join/);
});
