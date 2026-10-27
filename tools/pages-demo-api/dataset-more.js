'use strict';
// Roles, AFC, working activities and DOE targets for the Frontend Demo.
const { resolveRoleDoe } = require('../../server/src/domain/doe-calculator.js');
const { uuidFor, mulberry32, addDays } = require('./ids.js');
const { ACADEMIC_YEAR, CREATED } = require('./dataset.js');

const VISC_SUBJECTS = ['Anatomy', 'Physiology', 'Pharmacology', 'Pathology', 'Microbiology', 'Epidemiology'];
const ROTATIONS = ['Small Animal Medicine', 'Equine Medicine', 'Food Animal Practice', 'Diagnostic Imaging', 'Anesthesia'];

function period(start, end) { return [{ startDate: start, endDate: end }]; }

function roleRows(courses, faculty) {
  const active = faculty.filter(row => row.active);
  const rows = [];
  const add = (row) => {
    const role = {
      roleAssignmentId: uuidFor(`role:${row.roleType}:${row.courseOrSubjectOrRotation}:${row.facultyId}`),
      academicYear: ACADEMIC_YEAR,
      roleCategory: row.roleCategory || '',
      scheduleVersion: '',
      facultyResolutionStatus: 'resolved',
      details: '',
      courseName: '',
      sourceAllocationStatus: 'allocated',
      doeMappedValue: null,
      doeOverrideValue: null,
      doeOverrideReason: '',
      specialNotes: '',
      effectiveDate: '2026-07-01',
      expirationDate: '2027-06-30',
      ...row
    };
    role.validityPeriods = null;
    rows.push(role);
  };
  courses.filter(c => c.curriculumYear <= 3).forEach((course, index) => {
    const hicc = active[index % active.length];
    add({ facultyId: hicc.facultyId, roleCategory: 'Course leadership', roleType: 'HICC', courseOrSubjectOrRotation: course.catalogLabel, courseName: course.courseName, details: `HICC for ${course.courseCode}` });
    if (index % 3 === 0) {
      const cc = active[(index + 4) % active.length];
      add({ facultyId: cc.facultyId, roleCategory: 'Course leadership', roleType: 'Course Coordinator', courseOrSubjectOrRotation: course.catalogLabel, courseName: course.courseName, details: 'Course coordination' });
    }
  });
  VISC_SUBJECTS.forEach((subject, index) => {
    const visc = active[(index * 2 + 1) % active.length];
    add({ facultyId: visc.facultyId, roleCategory: 'Curriculum', roleType: 'VISC', courseOrSubjectOrRotation: subject, courseName: subject, details: `VISC – ${subject}`, ...(index === 5 ? { effectiveDate: '', expirationDate: '' } : {}) });
  });
  ROTATIONS.forEach((rotation, index) => {
    const lead = active[(index + 2) % active.length];
    add({ facultyId: lead.facultyId, roleCategory: 'Clinical', roleType: 'Designated Rotation Coordinator', courseOrSubjectOrRotation: rotation, courseName: rotation, details: 'Rotation coordination' });
    add({ facultyId: active[(index + 6) % active.length].facultyId, roleCategory: 'Clinical', roleType: 'Rotation Participant', courseOrSubjectOrRotation: rotation, courseName: rotation, details: '4 rotation weeks', rotationWeeks: 4 });
  });
  active.slice(0, 6).forEach((member, index) => add({ facultyId: member.facultyId, roleCategory: 'Clinical', roleType: 'CCC', courseOrSubjectOrRotation: 'Community Care Clinic', courseName: 'Community Care Clinic', details: `${6 + index} shifts`, shiftCount: 6 + index }));
  // One upcoming appointment and one ended appointment so status filters have data.
  add({ facultyId: active[3].facultyId, roleCategory: 'Curriculum', roleType: 'VISC', courseOrSubjectOrRotation: 'Behaviour', courseName: 'Behaviour', details: 'Starts in Winter', effectiveDate: '2027-01-04', expirationDate: '2027-06-30' });
  add({ facultyId: active[8].facultyId, roleCategory: 'Course leadership', roleType: 'HICC', courseOrSubjectOrRotation: 'VTMD 215: What is a Vet?', courseName: 'What is a Vet?', details: 'Handed over in October', effectiveDate: '2026-07-01', expirationDate: '2026-10-15' });
  for (const role of rows) {
    const doe = resolveRoleDoe(role);
    if (role.roleType === 'HICC' && role.details === 'Handed over in October') role.doeOverrideValue = 2, role.doeOverrideReason = 'Partial year';
    else if (doe.calculatedDoe != null) role.doeMappedValue = doe.calculatedDoe;
  }
  return rows;
}

const AFC_REASONS = [['university_travel', 'University Travel'], ['vacation', 'Vacation'], ['rsl', 'RSL'], ['medical', 'Medical'], ['mat', 'MAT'], ['special', 'Special'], ['other', 'Other']];
function afcRows(faculty) {
  const rand = mulberry32(4401);
  const rows = [];
  faculty.forEach((member, index) => {
    const count = 1 + (index % 3);
    for (let k = 0; k < count; k++) {
      const start = addDays('2026-07-06', Math.floor(rand() * 300));
      const length = [1, 3, 5, 10, 14][Math.floor(rand() * 5)];
      const [code, label] = AFC_REASONS[(index + k) % AFC_REASONS.length];
      const manual = (index + k) % 5 === 0;
      rows.push({
        afcRecordId: uuidFor(`afc:${member.legacyId}:${k}`),
        facultyId: member.facultyId,
        startDate: start,
        endDate: addDays(start, length - 1),
        reasonCode: code,
        reason: label,
        purpose: code === 'university_travel' ? 'Conference travel' : '',
        notes: manual ? 'Entered by the ADFA office' : '',
        legacyPurpose: code === 'university_travel' ? 'Conference travel' : label,
        active: start >= '2026-09-01',
        sourceKind: manual ? 'manual' : 'import',
        createdAtUtc: CREATED,
        createdByName: manual ? 'ADFA General' : 'AFC Tracker import',
        recordKey: `AFC-${member.legacyId}-${k}`,
        versionToken: (index * 16 + k + 4096).toString(16).toUpperCase().padStart(16, '0'),
        documentId: null
      });
    }
  });
  return rows;
}

// Calendar working activities: Rotation blocks, CCC shifts and other work, in
// the shape returned by paws_api.ListCalendarActivities.
function activityRows(roles, faculty) {
  const rows = [];
  const byId = new Map(faculty.map(row => [row.facultyId, row]));
  let n = 0;
  const add = row => { n += 1; rows.push({ version: (4096 + n).toString(16).padStart(16, '0'), staffingKind: 'assigned', staffingLabel: null, blockLabel: null, courseCode: null, timeStatus: row.timeEvidence && row.timeEvidence.length ? 'verified' : 'unverified', timeEvidence: [], ...row }); };
  const days = (start, end) => { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w > 0 && w < 6) out.push(d); } return out; };
  roles.filter(role => role.roleType === 'Rotation Participant' || role.roleType === 'Designated Rotation Coordinator').forEach((role, index) => {
    for (let block = 0; block < 4; block++) {
      const start = addDays('2026-08-31', (index * 21 + block * 56) % 210), end = addDays(start, 4);
      add({ activityId: uuidFor(`activity:rot:${role.roleAssignmentId}:${block}`), academicYear: ACADEMIC_YEAR, facultyKey: role.facultyId, facultyDisplayName: byId.get(role.facultyId)?.displayName || '', category: 'rotation_participant', label: `Rotation – ${role.courseOrSubjectOrRotation}`, startDate: start, endDate: end, courseCode: 'VETM 581', blockLabel: `Rotation block ${block + 1}`, timeStatus: 'default' });
    }
  });
  roles.filter(role => role.roleType === 'CCC').forEach((role, index) => {
    for (let shift = 0; shift < (role.shiftCount || 6); shift++) {
      const date = addDays('2026-09-01', index * 3 + shift * 14), morning = shift % 2 === 0;
      add({ activityId: uuidFor(`activity:ccc:${role.roleAssignmentId}:${shift}`), academicYear: ACADEMIC_YEAR, facultyKey: role.facultyId, facultyDisplayName: byId.get(role.facultyId)?.displayName || '', category: 'ccc', label: `CCC – ${morning ? 'AM' : 'PM'} half day`, startDate: date, endDate: date, courseCode: 'CCC', blockLabel: `Block ${1 + (shift % 4)} · ${morning ? 'AM' : 'PM'}`, timeEvidence: [{ date, startTime: morning ? '08:30' : '13:00', endTime: morning ? '12:00' : '16:30' }] });
    }
  });
  for (let k = 0; k < 4; k++) { const date = addDays('2026-10-06', k * 21); add({ activityId: uuidFor(`activity:ccc:locum:${k}`), academicYear: ACADEMIC_YEAR, facultyKey: null, facultyDisplayName: 'Locum', staffingKind: 'unassigned', staffingLabel: 'Locum', category: 'ccc', label: 'CCC – PM half day', startDate: date, endDate: date, courseCode: 'CCC', blockLabel: 'Block 2 · PM', timeEvidence: [{ date, startTime: '13:00', endTime: '16:30' }] }); }
  const other = [['clinical_day', 'Clinical day / PPVM', ''], ['vetm581_rounds', 'VETM 581 clinical rounds', 'VETM 581'], ['vetm571_clinical_pharmacology', 'VETM 571 clinical pharmacology', 'VETM 571'], ['vetm591_presentations', 'VETM 591 IM presentations', 'VETM 591'], ['teaching_excellence', 'Teaching excellence', '']];
  faculty.filter(row => row.active).forEach((member, index) => {
    const [category, label, course] = other[index % other.length];
    for (let k = 0; k < 3; k++) {
      const date = addDays('2026-09-08', index * 5 + k * 35);
      add({ activityId: uuidFor(`activity:other:${member.legacyId}:${k}`), academicYear: ACADEMIC_YEAR, facultyKey: member.facultyId, facultyDisplayName: member.displayName, category, label, startDate: date, endDate: k === 1 ? addDays(date, 2) : date, courseCode: course || null, timeEvidence: k === 2 ? [] : [{ date, startTime: '09:00', endTime: '12:00' }] });
    }
  });
  rows.forEach(row => { if (row.timeStatus !== 'default') row.timeStatus = row.timeEvidence.length ? 'verified' : 'unverified'; row.days = days(row.startDate, row.endDate).length; });
  return rows;
}

function targetRows(faculty) {
  return faculty.filter(row => row.active).map((member, index) => ({
    doeFacultyTargetId: uuidFor(`target:${member.legacyId}`),
    facultyId: member.facultyId,
    academicYear: ACADEMIC_YEAR,
    contractTeachingDoe: member.contractTeachingDoe,
    overrideDoe: index === 4 ? member.contractTeachingDoe - 5 : null,
    effectiveTargetDoe: index === 4 ? member.contractTeachingDoe - 5 : member.contractTeachingDoe,
    overrideReason: index === 4 ? 'RSL' : null,
    overrideNotes: null,
    source: 'Faculty Master List 2026-27 (synthetic)',
    policyVersionId: null,
    active: true,
    updatedAtUtc: CREATED
  }));
}

module.exports = { roleRows, afcRows, activityRows, targetRows, VISC_SUBJECTS, ROTATIONS };
