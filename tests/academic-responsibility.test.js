'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const scopes = require('../academic-responsibility.js');
const hicc = tokens => ({role: 'hicc', academicScopeTokens: tokens});

test('normalization produces canonical Course and Subject keys', () => {
  assert.equal(scopes.normalizeCourse(' vtmd   505 '), 'VTMD 505');
  assert.equal(scopes.normalizeSubjectKey(' Surgery '), 'surgery');
  assert.equal(scopes.scopeToken('hicc', ' vtmd 505 ', ' Surgery '), 'hicc|VTMD 505|surgery');
  assert.equal(scopes.scopeToken('hicc', 'VTMD 505'), 'hicc|VTMD 505|*');
});

test('a course-wide HICC token covers Subjects in only that exact course', () => {
  const profile = hicc(['hicc|VTMD 505|*']);
  for (const subjectKey of ['surgery', 'anesthesia', '']) {
    assert.equal(scopes.hasScope(profile, 'hicc', {course: ' vtmd 505 ', subjectKey}), true, subjectKey);
  }
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 5050', subjectKey: 'surgery'}), false);
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 506', subjectKey: 'surgery'}), false);
});

test('a Subject-limited HICC token requires exact Course and subjectKey', () => {
  const profile = hicc(['hicc|VTMD 506|surgery']);
  assert.equal(scopes.hasScope(profile, 'hicc', {course: ' vtmd 506 ', subjectKey: ' Surgery '}), true);
  for (const resource of [
    {course: 'VTMD 505', subjectKey: 'surgery'},
    {course: 'VTMD 506', subjectKey: 'surgery-core'},
    {course: 'VTMD 506', subjectKey: ''},
    {course: 'VTMD 506'}
  ]) {
    assert.equal(scopes.hasScope(profile, 'hicc', resource), false, JSON.stringify(resource));
  }
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 506', subjectKey: 'surgery', topic: 'other'}), true);
});

test('Topic cannot supply or alter Subject authorization', () => {
  const profile = hicc(['hicc|VTMD 506|surgery']);
  assert.equal(scopes.canHiccEditTopic(profile, {course: 'VTMD 506', topic: 'surgery'}), false);
  assert.equal(scopes.canHiccSuggestFaculty(profile, {course: 'VTMD 506', subjectKey: 'anesthesia', topic: 'surgery'}), false);
  assert.equal(scopes.canHiccEditTopic(profile, {course: 'VTMD 506', subjectKey: 'surgery', topic: 'anesthesia'}), true);
  assert.equal(scopes.canHiccSuggestFaculty(profile, {course: 'VTMD 506', subjectKey: 'surgery', topic: 'anything'}), true);
});

test('role alone and token without HICC role grant no HICC action', () => {
  const resource = {course: 'VTMD 505', subjectKey: 'surgery'};
  for (const profile of [{role: 'hicc'}, hicc([]), hicc('hicc|VTMD 505|*'), {role: 'faculty', academicScopeTokens: ['hicc|VTMD 505|*']}]) {
    assert.equal(scopes.hasScope(profile, 'hicc', resource), false);
    assert.equal(scopes.canHiccEditTopic(profile, resource), false);
    assert.equal(scopes.canHiccSuggestFaculty(profile, resource), false);
  }
});

test('malformed and unknown tokens fail closed', () => {
  const bad = ['', 'hicc', 'hicc|VTMD 505', 'hicc|VTMD 505|*|extra',
    'visc|VTMD 505|*', 'hicc|A|*', 'hicc||*', 'hicc|VTMD 505|',
    'hicc|VTMD 505|surgery*'];
  const resource = {course: 'VTMD 505', subjectKey: 'surgery'};
  for (const token of bad) assert.equal(scopes.hasScope(hicc([token]), 'hicc', resource), false, token);
  assert.deepEqual(scopes.scopesFor(hicc(bad), 'hicc'), []);
  assert.equal(scopes.scopeToken('visc', 'VTMD 505'), '');
});

test('duplicate valid tokens dedupe and malformed neighbors do not expand authority', () => {
  const profile = hicc(['hicc|VTMD 506|surgery', 'hicc|vtmd 506|Surgery',
    'hicc|VTMD 506|surgery|extra', 'hicc|VTMD 505|*']);
  assert.deepEqual(scopes.scopesFor(profile, 'hicc'), [
    'hicc|VTMD 506|surgery', 'hicc|VTMD 505|*'
  ]);
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 506', subjectKey: 'surgery-core'}), false);
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 505', subjectKey: 'surgery-core'}), true);
});

test('rotation coordinator tokens can be parsed without granting HICC rights', () => {
  const profile = hicc(['rotation_coordinator|VTMD 590|*']);
  assert.deepEqual(scopes.scopesFor(profile, 'rotation_coordinator'), ['rotation_coordinator|VTMD 590|*']);
  assert.equal(scopes.hasScope(profile, 'hicc', {course: 'VTMD 590', subjectKey: 'surgery'}), false);
  assert.equal(scopes.canHiccEditTopic(profile, {course: 'VTMD 590'}), false);
});

test('browser helper loads before office capabilities and timetable in static assets', () => {
  const source = fs.readFileSync(path.join(root, 'academic-responsibility.js'), 'utf8');
  const context = {window: {}};
  vm.runInNewContext(source, context);
  assert.equal(context.window.UCVM_ACADEMIC_RESPONSIBILITY.normalizeCourse(' vtmd 505 '), 'VTMD 505');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const assets = JSON.parse(fs.readFileSync(path.join(root, 'tools/static-assets.json'), 'utf8'));
  const bundles = JSON.parse(fs.readFileSync(path.join(root, 'tools/runtime-bundles.json'), 'utf8'));
  const script = '<script src="academic-responsibility.js"></script>';
  assert.ok(assets.includes('academic-responsibility.js'));
  assert.ok(html.includes(script));
  assert.ok(html.indexOf(script) < html.indexOf('office-capabilities.js'));
  assert.ok(html.indexOf(script) < html.indexOf('timetable.js'));
  const timetableBundle = bundles.bundles.find(bundle => bundle.output === 'bundles/timetable-app.bundle.js');
  assert.ok(timetableBundle);
  assert.ok(timetableBundle.sources.includes('academic-responsibility.js'));
  assert.ok(timetableBundle.sources.indexOf('academic-responsibility.js') < timetableBundle.sources.indexOf('office-capabilities.js'));
});
