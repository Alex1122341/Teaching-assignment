'use strict';
// Frontend Demo dataset for the PAWS pages.
//
// Everything here is synthetic. Faculty and demo accounts are derived from the
// existing Frontend Demo seed (tools/seed/dataset.js) so names match the rest of
// the test site; course codes come from the public 2026-27 course catalogue.
// The shapes mirror the SQL tables the server repositories read, so the real
// server API code can run against it in the browser.

const { FACULTY_SEED, buildDataset } = require('../seed/dataset.js');
// One retired member, so Active / Inactive filters have something to show.
const RETIRED = { id: 'fac-015', first: 'Morgan', last: 'Ellison', ucid: '30001015', rank: 'Professor', fte: 1, contract: 40 };
const { COURSE_UNITS } = require('../../server/src/domain/doe-course-catalog-2026-27.js');
const { resolveTeachingDoe } = require('../../server/src/domain/doe-calculator.js');
const { uuidFor, mulberry32, addDays, weekday } = require('./ids.js');

const ACADEMIC_YEAR = '2026-27';
const CREATED = '2026-08-01T15:00:00.000Z';

const STREAMS = ['Teaching', 'Teaching & Research', 'Clinical', 'Research', 'Teaching', 'Clinical', 'Teaching & Research'];
const AREAS = ['Anatomy', 'Physiology', 'Small Animal Medicine', 'Large Animal Surgery', 'Diagnostic Imaging', 'Anesthesia', 'Pathology', 'Microbiology', 'Epidemiology', 'Equine Medicine', 'Theriogenology', 'Pharmacology', 'Public Health', 'Behaviour'];
const CATEGORIES = ['Clinician', 'Scientist', 'Clinician / Diagnostician', 'Educator'];

function facultyRows() {
  return [...FACULTY_SEED, RETIRED].map((seed, index) => ({
    facultyId: uuidFor(`faculty:${seed.id}`),
    legacyId: seed.id,
    preferredFirstName: seed.first,
    preferredLastName: seed.last,
    displayName: `${seed.first} ${seed.last}`,
    storedDisplayName: `${seed.last}, ${seed.first}`,
    hrName: `${seed.last}, ${seed.first}`,
    ucid: seed.ucid,
    email: `${seed.first}.${seed.last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.test',
    recordType: 'Faculty',
    stream: STREAMS[index % STREAMS.length],
    rank: seed.rank,
    fte: seed.fte,
    contractTeachingDoe: seed.contract,
    reportsToFacultyId: index === 0 ? null : uuidFor('faculty:fac-001'),
    active: seed.id !== RETIRED.id,
    updatedAtUtc: CREATED,
    versionToken: `v1-${seed.id}`,
    profile: {
      teachingArea: AREAS[index % AREAS.length],
      professionalCategory: CATEGORIES[index % CATEGORIES.length],
      serviceDate: `20${String(10 + (index % 12)).padStart(2, '0')}-07-01`,
      priorYearsExperience: 2 + (index % 9),
      dvmEarnedDate: `20${String(2 + (index % 15)).padStart(2, '0')}-05-15`,
      dvmType: index % 3 ? 'DVM' : 'VMD',
      mastersEarnedDate: index % 2 ? `20${String(5 + (index % 10)).padStart(2, '0')}-06-01` : '',
      mastersArea: index % 2 ? AREAS[(index + 3) % AREAS.length] : '',
      phdEarnedDate: index % 3 === 0 ? `20${String(8 + (index % 8)).padStart(2, '0')}-09-01` : '',
      phdArea: index % 3 === 0 ? AREAS[(index + 5) % AREAS.length] : '',
      boardCertifiedDate: index % 4 === 0 ? '2015-10-01' : '',
      boardCertification: index % 4 === 0 ? 'ACVIM' : '',
      boardCertificationCount: index % 4 === 0 ? 1 : 0,
      abvmaLicenseNumber: `D${4000 + index}`,
      abvmaMemberType: 'General',
      profileVersion: '0x' + (2000 + index).toString(16).toUpperCase().padStart(16, '0')
    }
  }));
}

// Demo accounts: every Firebase user in the existing Frontend Demo seed, each
// given an SQL profile. Faculty-facing users keep the seed's faculty link so
// self-service scopes (My Teaching, AFC Request, SWAP) have data.
function userRows(faculty) {
  const byLegacy = new Map(faculty.map(row => [row.legacyId, row]));
  return buildDataset().documents.filter(doc => String(doc.path).startsWith('users/')).map(doc => {
    const data = doc.data || {}, uid = String(doc.path).slice(6);
    const link = data.facultyId ? byLegacy.get(data.facultyId) : null;
    return { firebaseUid: uid, email: data.email || `${uid}@example.test`, displayName: data.name || uid, baseRole: data.role || 'faculty', facultyId: link ? link.facultyId : null, active: data.active !== false, mustChangePassword: false };
  });
}

// Course catalogue -> curriculum year and term. VTMD 2xx/3xx/4xx are Years 1-3;
// the clinical Vet Med 5xx courses form Year 4 and the Rotation stream.
const FALL = new Set(['200', '202', '204', '206', '302', '304', '306', '308', '401', '420', '422']);
function courseRows() {
  const out = [];
  for (const [label, units] of Object.entries(COURSE_UNITS)) {
    const match = /^(VTMD|Vet Med)\s+(\d{3}):\s*(.+)$/.exec(label);
    if (!match) continue;
    const [, prefix, number, name] = match;
    const first = Number(number[0]);
    const curriculumYear = prefix === 'Vet Med' ? (number === '440' ? 3 : 4) : (first === 5 ? 4 : first - 1);
    if (curriculumYear < 1 || curriculumYear > 4) continue;
    out.push({
      courseCode: `${prefix === 'VTMD' ? 'VTMD' : 'VETM'} ${number}`,
      courseName: name.trim(),
      catalogLabel: label,
      units,
      curriculumYear,
      term: curriculumYear === 4 ? 'rotation' : FALL.has(number) ? 'fall' : 'winter'
    });
  }
  return out;
}

const FALL_START = '2026-08-24';   // Monday, Fall week 1
const WINTER_START = '2027-01-11'; // Monday, Winter week 1
const SLOTS = [['08:30:00', '09:30:00'], ['10:00:00', '11:50:00'], ['13:00:00', '14:50:00'], ['15:00:00', '16:00:00']];
const ROOMS = ['HSB 1401', 'HSB 1403', 'TRW 2E19', 'Clinical Skills Lab', 'Anatomy Lab', 'CCC Clinic Room 2'];
const TOPICS = ['Introduction', 'Case discussion', 'Core concepts', 'Applied practice', 'Clinical reasoning', 'Review', 'Problem-based session', 'Skills practice'];

function hours(start, end) {
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number);
  return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 6) / 10;
}

function sessionRows(courses, faculty) {
  const rand = mulberry32(20262027);
  const active = faculty.filter(row => row.active);
  const pick = () => active[Math.floor(rand() * active.length)];
  const sessions = [];
  const teaching = courses.filter(course => course.term !== 'rotation');
  teaching.forEach((course, courseIndex) => {
    const startMonday = course.term === 'fall' ? FALL_START : WINTER_START;
    const weeks = course.term === 'fall' ? 16 : 15;
    const lead = active[courseIndex % active.length];
    const partner = active[(courseIndex + 5) % active.length];
    for (let week = 0; week < weeks; week++) {
      const monday = addDays(startMonday, week * 7);
      const plan = [];
      if (week === 7) plan.push('Quiz/Midterm');
      else if (week === weeks - 1) plan.push('Exam');
      else {
        plan.push('LEC');
        if (week % 2 === 0) plan.push(course.units >= 6 || courseIndex % 3 === 0 ? 'LAB' : 'SRL');
        if (course.units >= 6 && week % 3 === 1) plan.push('LEC');
        if ((course.courseCode === 'VTMD 206' || course.courseCode === 'VTMD 217') && week === 12) plan.push('OSCE');
      }
      plan.forEach((type, slotIndex) => {
        const day = addDays(monday, (courseIndex + slotIndex * 2) % 5);
        const [startTime, endTime] = SLOTS[(courseIndex + slotIndex + week) % SLOTS.length];
        const unknownTime = (courseIndex * 31 + week * 7 + slotIndex) % 197 === 0;
        const id = uuidFor(`session:${course.courseCode}:${week}:${slotIndex}`);
        const assignments = [];
        if (type === 'LAB') {
          assignments.push({ faculty: lead, teachingRole: 'Lab Primary' }, { faculty: partner, teachingRole: 'Lab Secondary' });
        } else if (type === 'LEC' || type === 'SRL') {
          assignments.push({ faculty: week % 4 === 3 ? pick() : lead, teachingRole: type === 'SRL' ? 'SRL' : 'Lecture' });
        } else if (type === 'OSCE' || type === 'Quiz/Midterm') {
          assignments.push({ faculty: lead, teachingRole: 'Exam Supervisor' });
        }
        const session = {
          id,
          academicYear: ACADEMIC_YEAR,
          curriculumYear: String(course.curriculumYear),
          courseCode: course.courseCode,
          courseName: course.courseName,
          topic: type === 'Exam' ? 'Final examination' : type === 'Quiz/Midterm' ? 'Midterm' : type === 'OSCE' ? 'OSCE stations' : `${TOPICS[(week + slotIndex) % TOPICS.length]} ${week + 1}`,
          sessionType: type,
          date: day,
          startTime: unknownTime ? null : startTime,
          endTime: unknownTime ? null : endTime,
          room: type === 'LAB' ? 'Clinical Skills Lab' : ROOMS[(courseIndex + week) % ROOMS.length],
          updatedAtUtc: CREATED,
          assignments: []
        };
        session.assignments = assignments.map((assignment, index) => {
          const creditedHours = unknownTime ? null : hours(startTime, endTime);
          const resolved = resolveTeachingDoe({ sessionType: type, teachingRole: assignment.teachingRole, creditedHours });
          return {
            sessionAssignmentId: uuidFor(`assignment:${id}:${index}`),
            facultyId: assignment.faculty.facultyId,
            teachingRole: assignment.teachingRole,
            labLead: assignment.teachingRole === 'Lab Primary' ? 'Yes' : '',
            creditedHours,
            doeRate: resolved.rate ?? null,
            doeQuantity: resolved.quantity ?? creditedHours,
            doeUnit: resolved.unit || 'credited hour',
            doeCredit: resolved.calculatedDoe ?? null,
            doeStatus: resolved.calculatedDoe == null ? (resolved.applicable === false ? 'not_applicable' : 'needs_review') : 'calculated',
            sourceFacultyName: assignment.faculty.displayName
          };
        });
        sessions.push(session);
      });
    }
  });
  return sessions.sort((a, b) => (a.date + (a.startTime || '99')).localeCompare(b.date + (b.startTime || '99')));
}

module.exports = { ACADEMIC_YEAR, CREATED, facultyRows, userRows, courseRows, sessionRows, hours };
