'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../foundation/teaching-assignment/authority');

const responsibility = (patch = {}) => ({
  responsibilityId: 'hicc-surgery', kind: 'hicc', active: true, label: 'Surgery',
  ...patch
});
const group = (patch = {}) => ({
  groupId: 'bovine', active: true, leaderViscResponsibilityId: 'visc-bovine',
  hiccResponsibilityIds: ['hicc-surgery'], ...patch
});
const assignee = (patch = {}) => ({
  responsibilityId: 'hicc-surgery', academicYear: '2026-27', facultyId: 'faculty-1', authenticatedFacultyId: 'faculty-1',
  enabled: true, activeDate: '2026-09-01', expirationDate: '2027-05-01', assignmentMode: 'exclusive', ...patch
});
const packageRecord = (patch = {}) => ({
  packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery',
  academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery',
  status: 'draft', workingRevision: 0, submittedWorkingRevision: null,
  viscApprovedWorkingRevision: null, reviewFingerprint: null, viscApprovedFingerprint: null,
  packageId: 'package-1',
  ...patch
});
const fingerprint = 'a'.repeat(64);

test('Subject keys are canonical and never inferred from Session.Topic', () => {
  assert.equal(authority.normalizeSubjectKey('  Small-Animal_1 '), 'small-animal_1');
  assert.equal(authority.normalizeSubjectKey('Topic text'), '');
  assert.deepEqual(authority.subjectRecord({subjectKey: 'Surgery', label: ' Surgery ', active: true}), {
    subjectKey: 'surgery', label: 'Surgery', active: true
  });
  assert.throws(() => authority.subjectRecord({subjectKey: 'surgery', label: '', active: true}));
});

test('stable responsibility records distinguish HICC and VISC', () => {
  assert.deepEqual(authority.responsibilityRecord({responsibilityId: 'hicc-surgery', kind: 'hicc', label: 'Surgery', active: true}), {
    responsibilityId: 'hicc-surgery', kind: 'hicc', label: 'Surgery', active: true
  });
  assert.throws(() => authority.responsibilityRecord({id: 'VISC-Bovine', kind: 'visc', label: 'VISC', active: true}));
  assert.throws(() => authority.responsibilityRecord({id: 'x', kind: 'faculty', label: 'x', active: true}));
});

test('package identity is deterministic and independent of assignee', () => {
  const input = {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery'};
  assert.equal(authority.packageIdentity(input), 'ta-package-v1__2026-27__bovine__hicc-surgery');
  assert.equal(authority.packageIdentity(input), authority.packageIdentity({...input, facultyId: 'faculty-2'}));
  assert.notEqual(authority.packageIdentity(input), authority.packageIdentity({...input, hiccResponsibilityId: 'hicc-medicine'}));
});

test('package state integrity is separate from submitted and approved freshness', () => {
  assert.equal(authority.packageStateIntegrity(packageRecord()), true);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'changes_requested', workingRevision: 3, submittedWorkingRevision: 2, reviewFingerprint: fingerprint})), true);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'changes_requested', workingRevision: 2, submittedWorkingRevision: 3, reviewFingerprint: fingerprint})), false);
  assert.equal(authority.isSubmittedRevisionFresh(packageRecord({status: 'changes_requested', workingRevision: 3, submittedWorkingRevision: 2, reviewFingerprint: fingerprint})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'visc_review', workingRevision: 2, submittedWorkingRevision: 2, reviewFingerprint: fingerprint})), true);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'visc_review', workingRevision: 2, submittedWorkingRevision: 1, reviewFingerprint: fingerprint})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'visc_review', workingRevision: 2, submittedWorkingRevision: 2, reviewFingerprint: 'invalid'})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'visc_approved', workingRevision: 3, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), true);
  assert.equal(authority.isApprovedRevisionFresh(packageRecord({status: 'visc_approved', workingRevision: 3, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), false);
  assert.equal(authority.hasCurrentViscApproval(packageRecord({status: 'visc_approved', workingRevision: 3, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'visc_approved', workingRevision: 2, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), true);
  assert.equal(authority.isApprovedRevisionFresh(packageRecord({status: 'visc_approved', workingRevision: 2, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), true);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'submitted_to_adfad', workingRevision: 2, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 1, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'adfad_finalized', workingRevision: 2, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: 'b'.repeat(64)})), false);
  assert.equal(authority.packageStateIntegrity(packageRecord({status: 'changes_requested', workingRevision: 2, submittedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedWorkingRevision: 1, viscApprovedFingerprint: fingerprint})), false);
});

test('temporal assignee uses exact FacultyId and half-open date window', () => {
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2026-09-01' }), true);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2027-04-30' }), true);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2027-05-01' }), false);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2026-08-31' }), false);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2026-09-01', authenticatedFacultyId: 'faculty-2' }), false);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), asOfDate: '2026-09-01', enabled: false }), false);
  assert.equal(authority.isCurrentTemporalAssignee({ ...assignee(), activeDate: '2027-05-01', expirationDate: '2026-09-01', asOfDate: '2026-09-01' }), false);
});

test('temporal schedule validates exclusive, concurrent, mixed, faculty and half-open overlap rules', () => {
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee(), assignee({facultyId: 'faculty-2', activeDate: '2027-05-01', expirationDate: '2027-08-01'})
  ]));
  assert.throws(() => authority.validateTemporalAssignees([
    assignee(), assignee({facultyId: 'faculty-2', activeDate: '2027-04-30', expirationDate: '2027-08-01'})
  ]), /overlap/i);
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee({assignmentMode: 'concurrent'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2027-04-30', expirationDate: '2027-08-01'}), assignee({facultyId: 'faculty-3', assignmentMode: 'concurrent', activeDate: '2027-04-30', expirationDate: '2027-08-01'})
  ]));
  assert.throws(() => authority.validateTemporalAssignees([
    assignee({assignmentMode: 'exclusive'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2027-04-30', expirationDate: '2027-08-01'})
  ]), /overlap/i);
  assert.throws(() => authority.validateTemporalAssignees([
    assignee({assignmentMode: 'concurrent'}), assignee({facultyId: 'faculty-1', assignmentMode: 'concurrent', activeDate: '2027-04-30', expirationDate: '2027-08-01'})
  ]), /overlap/i);
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee({assignmentMode: 'concurrent'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2027-05-01', expirationDate: '2027-08-01'})
  ]));
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee({assignmentMode: 'concurrent'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2027-06-01', expirationDate: '2027-08-01'})
  ]));
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee(), assignee({responsibilityId: 'hicc-medicine'}), assignee({academicYear: '2027-28', activeDate: '2026-09-01', expirationDate: '2027-05-01'})
  ]));
});

test('assignment mode is exact and fail-closed', () => {
  assert.equal(authority.isCurrentTemporalAssignee({...assignee(), asOfDate: '2026-09-01', assignmentMode: 'exclusive'}), true);
  for (const assignmentMode of [undefined, '', 'Exclusive', 'CONCURRENT', 'other']) {
    assert.equal(authority.isCurrentTemporalAssignee({...assignee(), asOfDate: '2026-09-01', assignmentMode}), false);
    assert.throws(() => authority.validateTemporalAssignees([assignee({assignmentMode})]), /assignment mode/i);
  }
});

test('temporal partition identity is canonical and fail-closed', () => {
  for (const patch of [
    {responsibilityId: undefined},
    {responsibilityId: 'HICC-SURGERY'},
    {academicYear: '2026-28'},
    {academicYear: '2026'},
    {facultyId: ''},
  ]) assert.throws(() => authority.validateTemporalAssignees([assignee(patch)]), /partition identity/i);
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee(), assignee({facultyId: 'faculty-2', activeDate: '2027-05-01', expirationDate: '2027-08-01'})
  ]));
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee(), assignee({responsibilityId: 'hicc-medicine', activeDate: '2026-09-01', expirationDate: '2027-05-01'})
  ]));
  assert.doesNotThrow(() => authority.validateTemporalAssignees([
    assignee(), assignee({academicYear: '2027-28', activeDate: '2026-09-01', expirationDate: '2027-05-01'})
  ]));
  assert.throws(() => authority.validateTemporalAssignees([
    assignee(), assignee({facultyId: 'faculty-2', activeDate: '2027-04-30', expirationDate: '2027-08-01'})
  ]), /overlap/i);
});

test('SQL-shaped package identity interoperates with the pure domain identity', () => {
  const sqlRecord = {AcademicYear: '2026-27', GroupId: 'bovine', HiccResponsibilityId: 'hicc-surgery'};
  assert.equal(authority.packageIdentity({
    academicYear: sqlRecord.AcademicYear,
    groupId: sqlRecord.GroupId,
    hiccResponsibilityId: sqlRecord.HiccResponsibilityId
  }), 'ta-package-v1__2026-27__bovine__hicc-surgery');
});

test('HICC authority requires exact course, optional exact subject, group membership, package identity and fresh metadata', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08',
    responsibility: responsibility(), assignee: assignee(), assignees: [assignee()], group: group(),
    responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}],
    package: packageRecord(), session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee(base), true);
  for (const patch of [
    {session: {...base.session, courseCode: 'VTMD 507'}},
    {session: {...base.session, subjectKey: 'medicine'}},
    {session: {...base.session, subjectKey: 'Pre-operative Management'}},
    {group: group({hiccResponsibilityIds: ['hicc-other']})},
    {package: packageRecord({packageIdentity: 'wrong', hiccResponsibilityId: 'hicc-other'})},
    {assignee: assignee({facultyId: 'faculty-2'}), assignees: [assignee({facultyId: 'faculty-2'})]},
    {responsibility: responsibility({active: false})},
    {package: packageRecord({viscApprovedWorkingRevision: 0, viscApprovedFingerprint: 'old', reviewFingerprint: 'new'})}
  ]) assert.equal(authority.isFacultyCurrentAssignee({...base, ...patch}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, assignee: undefined, assignees: [assignee({assignmentMode: 'concurrent'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2026-09-01', expirationDate: '2027-05-01'})]}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, assignee: undefined, assignees: [assignee({assignmentMode: 'exclusive'}), assignee({facultyId: 'faculty-2', assignmentMode: 'concurrent', activeDate: '2026-09-01', expirationDate: '2027-05-01'})]}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, assignees: undefined}), false);
});

test('HICC responsibility authority survives push-back/edit and approved Working drift', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: responsibility(), assignee: assignee(), assignees: [assignee()], group: group(),
    responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}],
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  const pushedBack = packageRecord({status: 'changes_requested', workingRevision: 3, submittedWorkingRevision: 2, reviewFingerprint: fingerprint});
  assert.equal(authority.packageStateIntegrity(pushedBack), true);
  assert.equal(authority.isSubmittedRevisionFresh(pushedBack), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: pushedBack}), true);
  const editedAfterApproval = packageRecord({status: 'visc_approved', workingRevision: 3, submittedWorkingRevision: 2, viscApprovedWorkingRevision: 2, reviewFingerprint: fingerprint, viscApprovedFingerprint: fingerprint});
  assert.equal(authority.packageStateIntegrity(editedAfterApproval), true);
  assert.equal(authority.isApprovedRevisionFresh(editedAfterApproval), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: editedAfterApproval}), true);
});

test('co-HICC assignees both authorize the same stable package scope', () => {
  const assignees = [
    assignee({assignmentMode: 'concurrent'}),
    assignee({facultyId: 'faculty-2', authenticatedFacultyId: 'faculty-2', assignmentMode: 'concurrent'})
  ];
  const input = {
    asOfDate: '2026-09-08', responsibility: responsibility(), assignee: assignees[0], assignees,
    group: group(), responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}], package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee({...input, authenticatedFacultyId: 'faculty-1'}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...input, authenticatedFacultyId: 'faculty-2', assignee: assignees[1]}), true);
  assert.equal(authority.packageIdentity(input.package), 'ta-package-v1__2026-27__bovine__hicc-surgery');
});

test('authority denies cross-HICC package/session inheritance and wrong groups', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: responsibility(), assignee: assignee(), assignees: [assignee()],
    responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}], group: group(), package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee(base), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, group: group({hiccResponsibilityIds: ['hicc-surgery', 'hicc-medicine']}), package: packageRecord({hiccResponsibilityId: 'hicc-medicine', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-medicine'}), session: {...base.session, hiccResponsibilityId: 'hicc-medicine', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-medicine'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, group: group({groupId: 'equine', hiccResponsibilityIds: ['hicc-surgery']})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: packageRecord({groupId: 'equine', packageIdentity: 'ta-package-v1__2026-27__equine__hicc-surgery'})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, groupId: 'equine', packageIdentity: 'ta-package-v1__2026-27__equine__hicc-surgery'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: packageRecord({packageId: 'package-2'}), session: {...base.session, packageId: 'package-1'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: packageRecord({academicYear: '2027-28', packageIdentity: 'ta-package-v1__2027-28__bovine__hicc-surgery'}), session: {...base.session, academicYear: '2027-28', packageIdentity: 'ta-package-v1__2027-28__bovine__hicc-surgery'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: {...packageRecord(), teachingAssignmentPackageId: 'package-legacy'}}), false);
});

test('course-wide HICC scope is a Subject wildcard but never substitutes Topic', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: responsibility(), assignee: assignee(), assignees: [assignee()], group: group(),
    responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: null}], package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: null, topic: 'Surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee(base), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, subjectKey: 'surgery'}}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, subjectKey: 'medicine'}}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, courseCode: 'VTMD 507'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, subjectKey: undefined, topic: 'medicine'}}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}], session: {...base.session, subjectKey: null, topic: 'surgery'}}), false);
});

test('VISC authority requires current leader responsibility and no HICC course token', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: {responsibilityId: 'visc-bovine', kind: 'visc', active: true},
    packageHiccResponsibility: {...responsibility(), groupId: 'bovine'}, assignee: {...assignee(), responsibilityId: 'visc-bovine'}, assignees: [{...assignee(), responsibilityId: 'visc-bovine'}], group: group(), responsibilityScopes: [], package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee(base), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, group: group({leaderViscResponsibilityId: 'visc-other'})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}]}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, asOfDate: '2027-05-01'}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, package: packageRecord({hiccResponsibilityId: 'hicc-other', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-other'})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, session: {...base.session, packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-other'}}), false);
});

test('VISC authority requires independently supplied exact-group HICC evidence', () => {
  const base = {
    authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: {responsibilityId: 'visc-bovine', kind: 'visc', active: true},
    packageHiccResponsibility: {...responsibility(), groupId: 'bovine'}, assignee: {...assignee(), responsibilityId: 'visc-bovine'}, assignees: [{...assignee(), responsibilityId: 'visc-bovine'}], group: group(), package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee(base), true);
  assert.equal(authority.isFacultyCurrentAssignee({...base, packageHiccResponsibility: responsibility({active: false})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, packageHiccResponsibility: responsibility({responsibilityId: 'hicc-medicine'}), group: group({hiccResponsibilityIds: ['hicc-surgery']})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, packageHiccResponsibility: {...responsibility(), groupId: 'equine'}}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, packageHiccResponsibility: undefined}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, group: group({groupId: 'equine', hiccResponsibilityIds: ['hicc-surgery']})}), false);
  assert.equal(authority.isFacultyCurrentAssignee({...base, group: group({groupId: 'bovine', hiccResponsibilityIds: []})}), false);
});

test('co-VISC assignees both authorize the same group package evidence', () => {
  const visc = {responsibilityId: 'visc-bovine', kind: 'visc', active: true};
  const assignees = [
    assignee({responsibilityId: 'visc-bovine', assignmentMode: 'concurrent'}),
    assignee({responsibilityId: 'visc-bovine', facultyId: 'faculty-2', authenticatedFacultyId: 'faculty-2', assignmentMode: 'concurrent'})
  ];
  const input = {
    asOfDate: '2026-09-08', responsibility: visc, assignee: assignees[0], assignees,
    packageHiccResponsibility: {...responsibility(), groupId: 'bovine'}, group: group(), package: packageRecord(),
    session: {academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', courseCode: 'VTMD 506', subjectKey: 'surgery'}
  };
  assert.equal(authority.isFacultyCurrentAssignee({...input, authenticatedFacultyId: 'faculty-1'}), true);
  assert.equal(authority.isFacultyCurrentAssignee({...input, authenticatedFacultyId: 'faculty-2', assignee: assignees[1]}), true);
});

test('normalized repository DTOs interoperate with authority without PascalCase remapping', () => {
  const ownership = authority.workingSessionOwnership({
    sessionId: 'session-1', academicYear: '2026-27', groupId: 'bovine', hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', subjectKey: 'surgery', courseCode: 'VTMD 506'
  });
  const normalizedResponsibility = {responsibilityId: 'hicc-surgery', kind: 'hicc', label: 'Surgery', active: true};
  const normalizedAssignee = {...assignee(), responsibilityId: 'hicc-surgery', activeDate: '2026-09-01', expirationDate: '2027-05-01'};
  const normalizedGroup = {groupId: 'bovine', active: true, leaderViscResponsibilityId: 'visc-bovine', hiccResponsibilityIds: ['hicc-surgery']};
  const normalizedPackage = {...packageRecord(), packageId: 'package-1'};
  assert.equal(ownership.packageId, 'package-1');
  assert.equal(authority.isFacultyCurrentAssignee({authenticatedFacultyId: 'faculty-1', asOfDate: '2026-09-08', responsibility: normalizedResponsibility, assignee: normalizedAssignee, assignees: [normalizedAssignee], group: normalizedGroup, responsibilityScopes: [{courseCode: 'VTMD 506', subjectKey: 'surgery'}], package: normalizedPackage, session: {...ownership, subjectKey: 'surgery', courseCode: 'VTMD 506'}}), true);
});

test('working session ownership is separate from final SessionAssignment', () => {
  assert.deepEqual(authority.workingSessionOwnership({
    sessionId: 'session-1', academicYear: '2026-27', groupId: 'bovine',
    hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', subjectId: null
  }), {
    sessionId: 'session-1', academicYear: '2026-27', groupId: 'bovine',
    hiccResponsibilityId: 'hicc-surgery', packageId: 'package-1', packageIdentity: 'ta-package-v1__2026-27__bovine__hicc-surgery', subjectId: null, subjectKey: null, courseCode: null
  });
  const source = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/005_teaching_assignment_authority_foundation.sql'), 'utf8');
  assert.match(source, /TeachingSessionOwnership/);
  assert.doesNotMatch(source, /CREATE TABLE[^;]*SessionAssignment/i);
});

test('migration is additive, paws-only, and cannot perform data writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/005_teaching_assignment_authority_foundation.sql'), 'utf8');
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|MERGE|DROP)\b/i);
  assert.doesNotMatch(source, /staging\./i);
  assert.match(source, /IF OBJECT_ID\(N'paws\./i);
  for (const table of ['Subject', 'TeachingResponsibility', 'TeachingResponsibilityScope', 'TeachingResponsibilityAssignee', 'TeachingAssignmentGroup', 'TeachingAssignmentGroupHicc', 'TeachingAssignmentPackage', 'TeachingSessionOwnership']) {
    assert.match(source, new RegExp(`CREATE TABLE paws\\.${table}`, 'i'));
  }
  assert.match(source, /SessionAssignment remains authoritative/i);
});

test('concurrent assignee migration is additive and exact-mode constrained', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/006_teaching_responsibility_concurrent_assignees.sql'), 'utf8');
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|MERGE|DROP)\b/i);
  assert.doesNotMatch(source, /staging\./i);
  assert.doesNotMatch(source, /CREATE\s+(TRIGGER|PROCEDURE)/i);
  const existingRowGuard = source.indexOf('IF EXISTS (SELECT 1 FROM paws.TeachingResponsibilityAssignee)');
  const columnAddition = source.indexOf('ALTER TABLE paws.TeachingResponsibilityAssignee');
  assert.ok(existingRowGuard >= 0 && existingRowGuard < columnAddition, 'existing-row guard must precede column addition');
  assert.match(source, /THROW\s+51001[^;]*Existing responsibility assignees require explicit AssignmentMode classification/i);
  assert.match(source, /IF EXISTS \(SELECT 1 FROM paws\.TeachingResponsibilityAssignee\)[\s\S]*THROW[\s\S]*DEFAULT \(N'exclusive'\)[\s\S]*WITH VALUES/i);
  assert.match(source, /ALTER\s+TABLE\s+paws\.TeachingResponsibilityAssignee/i);
  assert.match(source, /AssignmentMode\s+nvarchar\s*\(\s*16\s*\)/i);
  assert.match(source, /AssignmentMode[^;]+NOT NULL/i);
  assert.match(source, /DEFAULT[^;]+N'exclusive'/i);
  assert.match(source, /AssignmentMode\s+COLLATE\s+Latin1_General_100_BIN2\s+IN\s*\(\s*N'exclusive'\s*,\s*N'concurrent'\s*\)/i);
});
