'use strict';
// Deterministic synthetic dataset for the VISTA teaching-assignment system.
//
// Everything here is fictional. No real staff data may ever be added.
// The generator is pure and seeded, so the same version always produces the
// same dataset - which is what makes seeding idempotent and testable.
//
// Consumed by tools/seed-database.js and asserted by tests/seed-dataset.test.js.

// --- deterministic PRNG -----------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACADEMIC_YEAR = '2026-27';
const TERM_START = '2027-01-11'; // Monday, winter term
const TERM_WEEKS = 12;

// --- fictional people -------------------------------------------------------
// Names are intentionally generic and synthetic. They do not identify anyone.

const FACULTY_SEED = [
  {id: 'fac-001', first: 'Avery', last: 'Lindqvist', ucid: '30001001', rank: 'Professor', fte: 1, contract: 40},
  {id: 'fac-002', first: 'Rowan', last: 'Petrov', ucid: '30001002', rank: 'Associate Professor', fte: 1, contract: 40},
  {id: 'fac-003', first: 'Mira', last: 'Okonkwo', ucid: '30001003', rank: 'Professor', fte: 1, contract: 40},
  {id: 'fac-004', first: 'Tobias', last: 'Bergstrom', ucid: '30001004', rank: 'Assistant Professor', fte: 1, contract: 35},
  {id: 'fac-005', first: 'Selin', last: 'Aydin', ucid: '30001005', rank: 'Professor', fte: 1, contract: 40},
  {id: 'fac-006', first: 'Nadia', last: 'Fournier', ucid: '30001006', rank: 'Associate Professor', fte: 1, contract: 40},
  {id: 'fac-007', first: 'Emeka', last: 'Vasquez', ucid: '30001007', rank: 'Assistant Professor', fte: 1, contract: 35},
  {id: 'fac-008', first: 'Ingrid', last: 'Halvorsen', ucid: '30001008', rank: 'Professor', fte: 1, contract: 40},
  {id: 'fac-009', first: 'Kwame', last: 'Baptiste', ucid: '30001009', rank: 'Associate Professor', fte: 0.8, contract: 32},
  {id: 'fac-010', first: 'Petra', last: 'Novak', ucid: '30001010', rank: 'Assistant Professor', fte: 1, contract: 35},
  {id: 'fac-011', first: 'Hassan', last: 'Rahimi', ucid: '30001011', rank: 'Professor', fte: 1, contract: 40},
  {id: 'fac-012', first: 'Clara', last: 'Mbeki', ucid: '30001012', rank: 'Associate Professor', fte: 1, contract: 40},
  {id: 'fac-013', first: 'Jonas', last: 'Weiss', ucid: '30001013', rank: 'Sessional', fte: 0.5, contract: 20},
  {id: 'fac-014', first: 'Leila', last: 'Moreau', ucid: '30001014', rank: 'Assistant Professor', fte: 1, contract: 35}
];

// Accounts. Password-completion and inactive states are represented on purpose
// so tests can prove those gates behave.
const USER_SEED = [
  {uid: 'uid-developer', name: 'VISTA Developer', role: 'developer'},
  {uid: 'uid-owner', name: 'VISTA Owner', role: 'owner'},
  {uid: 'uid-admin', name: 'VISTA Administrator', role: 'administrator'},
  {uid: 'uid-otheroffice', name: 'Other Office', role: 'other_office'},
  {uid: 'uid-adfa-general', name: 'ADFA General', role: 'adfa_general'},
  {uid: 'uid-adfa-regular', name: 'ADFA Regular', role: 'adfa_regular'},
  {uid: 'uid-adc-1', name: 'ADC Coordinator', role: 'adc', office: 'DVM / ADC Office'},
  {uid: 'uid-adc-2', name: 'ADC Backup', role: 'adc', office: 'DVM / ADC Office'},
  {uid: 'uid-lab-1', name: 'LAB Coordinator', role: 'lab', office: 'LAB Office'},
  {uid: 'uid-lab-2', name: 'LAB Backup', role: 'lab', office: 'LAB Office'},
  {uid: 'uid-hicc-1', name: 'HICC Lead', role: 'hicc'},
  {uid: 'uid-hicc-2', name: 'HICC Member', role: 'hicc'},
  {uid: 'uid-visc-1', name: 'VISC Lead', role: 'visc'},
  {uid: 'uid-inactive', name: 'Retired Account', role: 'adc', active: false},
  {uid: 'uid-pwchange', name: 'New Hire', role: 'faculty', facultyId: 'fac-014', mustChangePassword: true}
];

const COURSES = [
  {code: 'VETM 301', name: 'Veterinary Anatomy I'},
  {code: 'VETM 302', name: 'Veterinary Physiology'},
  {code: 'VETM 401', name: 'Clinical Skills I'},
  {code: 'VETM 402', name: 'Small Animal Medicine'},
  {code: 'VETM 501', name: 'Large Animal Surgery'},
  {code: 'VETM 502', name: 'Diagnostic Imaging'},
  {code: 'VETM 503', name: 'Anesthesia and Analgesia'}
];

const LAB_TOPICS = ['Suturing', 'Radiograph positioning', 'Venipuncture', 'Anesthetic circuit', 'Instrument identification'];
const LECTURE_TOPICS = ['Foundations', 'Applied principles', 'Case discussion', 'Current evidence'];
const ROOMS = ['HMRB 101', 'HMRB 204', 'TRW 1-040', 'Clinical Skills Lab', ''];

const DEFAULT_RATE = {'Lecture': 0.30, 'SRL': 0.30, 'Lab Lead': 0.21, 'Lab Primary': 0.21, 'Lab Support': 0.19, 'Lab Secondary': 0.19};

// --- helpers ----------------------------------------------------------------

function isoDate(baseIso, dayOffset) {
  const base = new Date(`${baseIso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

function stamp(minutesFromNow) {
  return new Date(Date.UTC(2026, 8, 18, 12, 0, 0) + minutesFromNow * 60000);
}

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

function fullName(person) {
  return `${person.first} ${person.last}`;
}

function emailFor(person) {
  return `${person.first}.${person.last}@example.test`.toLowerCase();
}

// Normalised alias strings used to match assignment instructor text against a
// person. Derived from the name and the email local part so that the sanitized
// people index can preserve matching behaviour without publishing the address.
function aliasesFor(person) {
  const first = person.first.toLowerCase();
  const last = person.last.toLowerCase();
  return [...new Set([`${first}.${last}`, `${first}${last}`, first])];
}

function credit(hours, rate) {
  return Number((hours * rate).toFixed(6));
}

// --- builders ---------------------------------------------------------------

function buildUsers() {
  const users = [];
  for (const entry of USER_SEED) {
    const isFacultyRole = ['faculty', 'hicc', 'visc'].includes(entry.role);
    const doc = {
      name: entry.name,
      email: `${entry.uid}@example.test`,
      role: entry.role,
      active: entry.active !== false,
      mustChangePassword: entry.mustChangePassword === true,
      updatedBy: 'uid-owner',
      updatedByName: 'VISTA Owner',
      updatedAt: stamp(0),
      createdAt: stamp(0)
    };
    if (isFacultyRole) {
      doc.facultyId = entry.facultyId || `fac-${String(USER_SEED.indexOf(entry) + 1).padStart(3, '0')}`;
      doc.facultyRoles = [entry.role];
    } else {
      doc.officeName = entry.office || '';
      doc.officeEmail = entry.office ? `${entry.uid}-office@example.test` : '';
    }
    users.push({path: `users/${entry.uid}`, data: doc});
  }
  // Faculty accounts for the remaining directory entries.
  for (const person of FACULTY_SEED) {
    const uid = `uid-${person.id}`;
    if (users.some(u => u.path === `users/${uid}`)) continue;
    users.push({
      path: `users/${uid}`,
      data: {
        name: fullName(person),
        email: emailFor(person),
        role: 'faculty',
        facultyId: person.id,
        facultyRoles: ['faculty'],
        active: true,
        mustChangePassword: false,
        updatedBy: 'uid-owner',
        updatedByName: 'VISTA Owner',
        updatedAt: stamp(0),
        createdAt: stamp(0)
      }
    });
  }
  return users;
}

function buildFaculty() {
  return FACULTY_SEED.map((person, index) => {
    const hasOverride = person.id === 'fac-009';
    const data = {
      firstName: person.first,
      lastName: person.last,
      email: emailFor(person),
      ucid: person.ucid,
      appointmentType: person.rank === 'Sessional' ? 'Sessional' : 'Full-time',
      rank: person.rank,
      currentTitle: person.rank,
      expiryDate: person.rank === 'Sessional' ? '2027-06-30' : '',
      fte: person.fte,
      doe: person.contract,
      doeTeaching: person.contract,
      teachingDOE: person.contract,
      contractTeachingDOE: person.contract,
      teachingDoeModel2026_27: 'contract-v1',
      managedRoles2026_27: person.id === 'fac-003' ? ['visc'] : [],
      roleMigration2026_27: {
        schemaVersion: 'ucvm-managed-roles-v1',
        migratedBy: 'uid-owner',
        migratedAt: stamp(0)
      },
      awayFromCampusRecords: person.id === 'fac-005'
        ? [{start: '2027-02-15', end: '2027-02-19', kind: 'conference'}]
        : [],
      awayFromCampusSource: 'seed-2026-27',
      awayFromCampusImportedAt: stamp(0),
      awayFromCampusImportedBy: 'uid-owner',
      facultySummary2026_27: {assignedTeachingDOE: person.contract, sourceScheduledTeachingDOE: person.contract, sourceNonTimetableTeachingDOE: 0},
      facultySummarySource2026_27: 'seed-2026-27',
      facultySummaryStatus2026_27: 'imported',
      facultySummaryImportedAt: stamp(0),
      facultySummaryImportedBy: 'uid-owner',
      workloadPolicy2026_27: {guideline: 'UCVM Workload Guideline 2026-27'},
      workloadPolicySource2026_27: 'seed-2026-27',
      workloadPolicyImportedAt2026_27: stamp(0),
      workloadPolicyImportedBy2026_27: 'uid-owner',
      bulkImportedAt: stamp(0),
      bulkImportedBy: 'uid-owner',
      updatedBy: 'uid-owner',
      updatedByName: 'VISTA Owner',
      updatedAt: stamp(0)
    };
    if (hasOverride) {
      // Part-time administrative appointment: a defensible explicit override.
      data.doeOverride2026_27 = {
        value: 28,
        reason: 'Approved 0.8 FTE administrative appointment',
        notes: 'Dean approval on file'
      };
      data.overrideDOE = 28;
      data.overrideReason = 'Approved 0.8 FTE administrative appointment';
    }
    return {path: `faculty/${person.id}`, data};
  });
}

function buildSessionsAndCalendar() {
  const random = mulberry32(20260918);
  const sessions = [];
  const calendar = [];
  let counter = 0;

  for (let week = 1; week <= TERM_WEEKS; week += 1) {
    for (const course of COURSES) {
      counter += 1;
      const id = `sess-${String(counter).padStart(4, '0')}`;
      const dayOffset = (week - 1) * 7 + Math.floor(random() * 5);
      const date = isoDate(TERM_START, dayOffset);
      const isLab = course.code.endsWith('01') || course.code.endsWith('03') || random() < 0.4;
      const startHour = 9 + Math.floor(random() * 6);
      const start = `${String(startHour).padStart(2, '0')}:${random() < 0.5 ? '00' : '30'}`;
      const end = `${String(startHour + 2).padStart(2, '0')}:${start.endsWith('30') ? '30' : '00'}`;
      const timeUnknown = random() < 0.05;
      // Session type uses the canonical application vocabulary (LEC / SRL / LAB).
      // 'Lecture' is a teaching ROLE, not a session type, so it must not be used here.
      const type = isLab ? 'LAB' : (random() < 0.2 ? 'SRL' : 'LEC');
      const topic = isLab ? pick(LAB_TOPICS, random) : pick(LECTURE_TOPICS, random);
      const room = isLab ? 'Clinical Skills Lab' : pick(ROOMS.slice(0, 4), random);
      const lead = FACULTY_SEED[Math.floor(random() * FACULTY_SEED.length)];
      const support = FACULTY_SEED[Math.floor(random() * FACULTY_SEED.length)];
      const role = isLab ? 'Lab Lead' : 'Lecture';
      const hours = timeUnknown ? 2 : 2;
      const rate = DEFAULT_RATE[role];
      const assignments = [{
        ucid: lead.id,
        facultyId: lead.id,
        name: fullName(lead),
        role,
        topic,
        creditedHours: hours,
        doeRate: rate,
        doeCredit: credit(hours, rate),
        source: 'Seed dataset'
      }];
      if (isLab && support.id !== lead.id) {
        assignments.push({
          ucid: support.id,
          facultyId: support.id,
          name: fullName(support),
          role: 'Lab Support',
          topic,
          creditedHours: hours,
          doeRate: DEFAULT_RATE['Lab Support'],
          doeCredit: credit(hours, DEFAULT_RATE['Lab Support']),
          source: 'Seed dataset'
        });
      }
      const instructorNames = assignments.map(a => a.name);

      sessions.push({
        path: `sessions/${id}`,
        data: {
          course: course.code,
          courseName: course.name,
          academicYear: ACADEMIC_YEAR,
          year: 2,
          semester: 'winter',
          week,
          date,
          start: timeUnknown ? '' : start,
          end: timeUnknown ? '' : end,
          timeUnknown,
          type,
          topic,
          room,
          instructor: instructorNames.join(', '),
          instructorNames,
          facultyIds: assignments.map(a => a.facultyId),
          assignments,
          updatedBy: 'uid-adfa-regular',
          updatedByName: 'ADFA Regular',
          updatedAt: stamp(counter)
        }
      });

      // Public projection: exactly the allowlisted keys, nothing private.
      calendar.push({
        path: `calendar_sessions/${id}`,
        data: {
          sessionId: id,
          course: course.code,
          courseName: course.name,
          year: 2,
          semester: 'winter',
          week,
          date,
          start: timeUnknown ? '' : start,
          end: timeUnknown ? '' : end,
          timeUnknown,
          type,
          topic,
          room,
          instructor: instructorNames.join(', '),
          instructorNames
        }
      });
    }
  }
  return {sessions, calendar};
}

function buildLabGroupsAndRosters() {
  const groups = [], rosters = [];
  COURSES.forEach((course, index) => {
    const groupId = `lab-group-${String(index + 1).padStart(2, '0')}-a`;
    groups.push({
      path: `lab_groups/${groupId}`,
      data: {
        groupId, academicYear: ACADEMIC_YEAR, course: course.code,
        groupCode: 'A', colorKey: 'group-a', active: true,
        updatedBy: 'uid-lab-1', updatedByName: 'LAB Coordinator', updatedAt: stamp(0)
      }
    });
    rosters.push({
      path: `lab_group_rosters/${groupId}`,
      data: {
        groupId,
        studentIds: [`39${String(index + 1).padStart(6, '0')}`, `49${String(index + 1).padStart(6, '0')}`],
        updatedBy: 'uid-lab-1', updatedByName: 'LAB Coordinator', updatedAt: stamp(0)
      }
    });
  });
  return {groups, rosters};
}

function buildSettings(sessions, faculty) {
  const facultyIndexEntries = faculty.map(record => ({
    key: record.path.replace('faculty/', ''),
    name: `${record.data.firstName} ${record.data.lastName}`,
    rank: record.data.rank
  }));

  // Sanitized projection: key, display name, aliases and coarse date ranges only.
  // No ucid, no email, no facultyId, no DOE, no reason, no conflict detail.
  const swapEntries = faculty.map((record, index) => ({
    key: `cand-${String(index + 1).padStart(3, '0')}`,
    name: `${record.data.firstName} ${record.data.lastName}`,
    aliases: aliasesFor(FACULTY_SEED[index]),
    unavailableRanges: record.data.awayFromCampusRecords.map(r => ({startDate: r.start, endDate: r.end}))
  }));

  const swapMapEntries = swapEntries.map((entry, index) => ({
    key: entry.key,
    facultyId: faculty[index].path.replace('faculty/', '')
  }));

  const perCourse = {};
  for (const session of sessions) {
    const code = session.data.course;
    perCourse[code] = perCourse[code] || {sessions: 0, labSessions: 0, creditedHours: 0};
    perCourse[code].sessions += 1;
    if (session.data.type === 'LAB') perCourse[code].labSessions += 1;
    for (const assignment of session.data.assignments) {
      perCourse[code].creditedHours = Number((perCourse[code].creditedHours + assignment.creditedHours).toFixed(4));
    }
  }

  return [
    {
      path: 'settings/system_state',
      data: {
        teachingDataWriteLocked: false,
        maintenanceMode: 'none',
        activeImportId: '',
        maintenanceOwnerUid: '',
        maintenanceOwnerName: '',
        maintenanceStartedAt: null,
        lastCompletedImportId: 'import-seed-001',
        lastCompletedAt: stamp(-60)
      }
    },
    {
      path: 'settings/faculty_index',
      data: {entries: facultyIndexEntries, generatedAt: stamp(0)}
    },
    {
      path: 'settings/schedule_stats',
      data: {perCourse, sessionCount: sessions.length, generatedAt: stamp(0)}
    },
    {
      // Sanitized projection: no ucid, no email, no facultyId, no DOE, no reason.
      path: 'settings/faculty_swap_index',
      data: {schemaVersion: 'ucvm-faculty-swap-index-v1', entries: swapEntries, generatedAt: stamp(0)}
    },
    {
      // Private resolution map: admin-only.
      path: 'settings/faculty_swap_map',
      data: {schemaVersion: 'ucvm-faculty-swap-map-v1', entries: swapMapEntries, generatedAt: stamp(0)}
    },
    {
      path: 'settings/faculty_summary_2026_27',
      data: {academicYear: ACADEMIC_YEAR, imported: true, generatedAt: stamp(0)}
    },
    {
      // Closes the /users enumeration gap: identity needed by the HICC people
      // picker only. No email, no active flag, no mustChangePassword, no office
      // fields. `aliases` are normalised strings, not the address itself.
      path: 'settings/people_index',
      data: {
        schemaVersion: 'ucvm-people-index-v1',
        entries: [
          {uid: 'uid-hicc-1', name: 'HICC Lead', role: 'hicc', facultyId: '', aliases: ['hicc.lead', 'hicclead']},
          {uid: 'uid-hicc-2', name: 'HICC Member', role: 'hicc', facultyId: '', aliases: ['hicc.member', 'hiccmember']},
          {uid: 'uid-visc-1', name: 'VISC Lead', role: 'visc', facultyId: '', aliases: ['visc.lead', 'visclead']},
          ...FACULTY_SEED.map(person => ({
            uid: `uid-${person.id}`,
            name: fullName(person),
            role: 'faculty',
            facultyId: person.id,
            aliases: aliasesFor(person)
          }))
        ],
        generatedAt: stamp(0)
      }
    }
  ];
}

function buildGroups() {
  return [
    {
      path: 'faculty_groups/group-neuro',
      data: {
        name: 'Neurology Rotation',
        ownerUid: 'uid-hicc-1',
        courseIds: ['VETM 401', 'VETM 402'],
        memberUids: ['uid-hicc-1', 'uid-hicc-2', 'uid-visc-1'],
        updatedBy: 'uid-hicc-1',
        updatedByName: 'HICC Lead',
        updatedAt: stamp(0),
        createdAt: stamp(-600)
      }
    },
    {
      path: 'faculty_groups/group-surgery',
      data: {
        name: 'Surgery Rotation',
        ownerUid: 'uid-hicc-2',
        courseIds: ['VETM 501'],
        memberUids: ['uid-hicc-2', 'uid-fac-003'],
        updatedBy: 'uid-hicc-2',
        updatedByName: 'HICC Member',
        updatedAt: stamp(0),
        createdAt: stamp(-500)
      }
    }
  ];
}

function publicSessionMap(session) {
  const d = session.data;
  return {
    course: d.course, courseName: d.courseName, year: d.year, semester: d.semester,
    week: d.week, date: d.date, start: d.start, end: d.end,
    timeUnknown: d.timeUnknown, type: d.type, topic: d.topic, room: d.room,
    instructor: d.instructor
  };
}

function buildRequests(sessions, calendar) {
  const random = mulberry32(4242);
  const docs = [];
  const targets = sessions.filter(s => s.data.type === 'LAB').slice(0, 3);

  const specs = [
    {id: 'req-001', status: 'pending', offices: ['lab'], scopes: {lab: ['topic']}, fields: ['topic'], editableFields: [], revision: 1, lab: true},
    {id: 'req-002', status: 'update_required', offices: ['adc', 'lab'], scopes: {adc: ['date'], lab: ['topic']}, fields: ['date', 'topic'], editableFields: ['date'], approvalStatus: {adc: 'push_back', lab: 'pending'}, revision: 2, lab: true},
    {id: 'req-003', status: 'approved', offices: ['adc', 'lab', 'adfa'], scopes: {adc: ['date'], lab: ['topic'], adfa: ['assignments', 'instructor']}, fields: ['date', 'topic', 'assignments', 'instructor'], editableFields: [], revision: 1, lab: true}
  ];

  specs.forEach((spec, index) => {
    const session = targets[index];
    const d = session.data;
    const base = publicSessionMap(session);
    const patch = {...base};
    if (spec.scopes.adc) patch.date = isoDate(d.date, 2);
    if (spec.scopes.lab) patch.topic = 'Advanced ' + d.topic;
    if (spec.scopes.adfa) {
      const replacement = FACULTY_SEED[2];
      patch.instructor = [fullName(replacement), ...d.assignments.slice(1).map(row => row.name)].filter(Boolean).join(', ');
    }

    docs.push({
      path: `change_requests/${spec.id}`,
      data: {
        requestSchema: 'office-routing-v1',
        requesterUid: 'uid-hicc-1',
        requesterName: 'HICC Lead',
        requesterRole: 'hicc',
        sessionId: session.path.replace('sessions/', ''),
        requestType: spec.scopes.adfa ? 'faculty_swap' : 'session_edit',
        scope: 'hicc',
        groupId: 'group-neuro',
        groupName: 'Neurology Rotation',
        status: spec.status,
        revision: spec.revision,
        basePublic: base,
        patchPublic: patch,
        currentFacultyName: d.instructor,
        proposedFacultyName: spec.scopes.adfa ? 'Mira Okonkwo' : '',
        editableFields: spec.editableFields || [],
        requesterMessage: spec.status === 'update_required' ? 'Please revise the rotation date.' : '',
        reason: spec.scopes.adfa ? 'Coverage conflict with clinical duty.' : '',
        course: d.course,
        date: d.date,
        topic: d.topic,
        requestedAt: stamp(-300 + index * 10),
        updatedAt: stamp(-200 + index * 10),
        withdrawnBy: '',
        withdrawnAt: null,
        appliedRevision: spec.status === 'approved' ? spec.revision : 0,
        appliedAt: spec.status === 'approved' ? stamp(-100) : null
      }
    });

    const scopes = {};
    const signatures = {};
    for (const office of ['adc', 'lab', 'adfa']) {
      scopes[office] = spec.scopes[office] || [];
      signatures[office] = spec.scopes[office] ? `${office}-sig-${spec.id}-r${spec.revision}` : '';
    }

    docs.push({
      path: `change_request_workflow/${spec.id}`,
      data: {
        requestId: spec.id,
        revision: spec.revision,
        requiredOffices: spec.offices,
        hasFacultyChange: Boolean(spec.scopes.adfa),
        finalType: d.type,
        scopes,
        scopeSignatures: signatures,
        updatedAt: stamp(-200 + index * 10)
      }
    });

    for (const office of spec.offices) {
      const status = spec.approvalStatus?.[office] || (spec.status === 'approved' ? 'approved' : 'pending');
      const decided = ['approved', 'push_back', 'rejected'].includes(status);
      docs.push({
        path: `change_request_approvals/${spec.id}_${office}`,
        data: {
          id: `${spec.id}_${office}`,
          requestId: spec.id,
          office,
          revision: spec.revision,
          fields: scopes[office],
          scopeSignature: signatures[office],
          status,
          decidedBy: decided ? `uid-${office === 'adfa' ? 'adfa-regular' : office + '-1'}` : '',
          decidedByName: decided ? `${office.toUpperCase()} Reviewer` : '',
          decidedAt: decided ? stamp(-150) : null,
          pushBackReason: status === 'push_back' ? 'Please revise the rotation date.' : '',
          updatedAt: stamp(-150)
        }
      });
    }

    docs.push({
      path: `change_request_private/${spec.id}`,
      data: {
        requestId: spec.id,
        requesterUid: 'uid-hicc-1',
        revision: spec.revision,
        assignmentChange: {
          assignmentIndex: 0,
          from: {facultyId: d.assignments[0]?.facultyId || '', candidateKey: '', kind: ''},
          to: spec.scopes.adfa ? {facultyId: '', candidateKey: 'cand-003', kind: ''} : {facultyId: d.assignments[0]?.facultyId || '', candidateKey: '', kind: ''}
        },
        updatedAt: stamp(-200 + index * 10)
      }
    });

    docs.push({
      path: `change_request_audit/${spec.id}_submitted`,
      data: {
        requestId: spec.id,
        event: 'request_submitted',
        revision: 1,
        status: 'pending',
        office: '',
        message: 'Request submitted.',
        changedFields: spec.fields,
        changedBy: 'uid-hicc-1',
        changedByName: 'HICC Lead',
        changedAt: stamp(-300 + index * 10)
      }
    });

    if (spec.status === 'approved') {
      docs.push({
        path: `change_request_audit/${spec.id}_applied`,
        data: {
          requestId: spec.id,
          event: 'request_applied',
          revision: spec.revision,
          status: 'approved',
          office: 'adfa',
          message: 'Applied after all required approvals.',
          changedFields: spec.fields,
          changedBy: 'uid-adfa-regular',
          changedByName: 'ADFA Regular',
          changedAt: stamp(-100)
        }
      });
    }

    if (spec.status === 'approved') {
      const replacement = FACULTY_SEED[2], outgoing = d.assignments[0] || {};
      const replacementRole = outgoing.role || 'Lab Lead';
      const replacementHours = Number(outgoing.creditedHours) || 2;
      const replacementRate = Number(outgoing.doeRate) || DEFAULT_RATE[replacementRole] || DEFAULT_RATE['Lab Lead'];
      const assignments = [
        {
          ucid: replacement.id,
          facultyId: replacement.id,
          name: fullName(replacement),
          role: replacementRole,
          topic: patch.topic,
          creditedHours: replacementHours,
          doeRate: replacementRate,
          doeCredit: credit(replacementHours, replacementRate),
          source: 'Seed approved request'
        },
        ...d.assignments.slice(1).map(row => ({...row, topic: patch.topic}))
      ];
      Object.assign(d, {
        date: patch.date,
        topic: patch.topic,
        instructor: patch.instructor,
        instructorNames: assignments.map(row => row.name),
        facultyIds: assignments.map(row => row.facultyId),
        assignments,
        approvalRequestId: spec.id,
        approvalRevision: spec.revision,
        updatedBy: 'uid-adfa-regular',
        updatedByName: 'ADFA Regular',
        updatedAt: stamp(-100)
      });
      const sessionId = session.path.replace('sessions/', '');
      const calendarRow = calendar.find(row => row.path === `calendar_sessions/${sessionId}`);
      if (!calendarRow) throw new Error(`Missing calendar projection for approved request session ${sessionId}`);
      Object.assign(calendarRow.data, {
        date: d.date,
        topic: d.topic,
        instructor: d.instructor,
        instructorNames: [...d.instructorNames]
      });
    }
  });

  return docs;
}

function buildNotifications(sessions, requests) {
  const request = requests.find(row => row.path === 'change_requests/req-001');
  if (!request) throw new Error('Missing req-001 fixture for workflow notification.');
  const sessionId = request.data.sessionId;
  const session = sessions.find(row => row.path === `sessions/${sessionId}`);
  if (!session) throw new Error(`Missing canonical session ${sessionId} for workflow notification.`);
  const d = session.data;
  return [{
    path: 'workflow_notifications/notif-001',
    data: {
      recipientOffice: 'lab',
      kind: 'request_assigned',
      requestId: request.path.replace('change_requests/', ''),
      sessionId,
      course: d.course,
      date: d.date,
      start: d.start,
      end: d.end,
      type: d.type,
      topic: d.topic,
      facultyDisplayName: d.instructor,
      message: 'A LAB topic change needs your review.',
      createdAt: stamp(-290),
      readBy: []
    }
  }];
}

function buildAfc() {
  const docs = [];
  const specs = [
    {id: 'afc-001', status: 'pending_report_to', reportTo: 'uid-fac-001'},
    {id: 'afc-002', status: 'pending_admin', reportTo: 'uid-fac-002'},
    {id: 'afc-003', status: 'approved', reportTo: 'uid-fac-003'}
  ];
  specs.forEach((spec, index) => {
    const person = FACULTY_SEED[index];
    const approved = spec.status === 'approved';
    docs.push({
      path: `afc_requests/${spec.id}`,
      data: {
        requesterUid: `uid-${person.id}`,
        facultyId: person.id,
        reportToUid: spec.reportTo,
        status: spec.status,
        workDays: 5,
        startDate: '2027-03-08',
        endDate: '2027-03-12',
        appointmentType: person.rank === 'Sessional' ? 'Sessional' : 'Full-time',
        rank: person.rank,
        reason: 'vacation',
        purposeDestination: 'Personal leave',
        coverage: 'No teaching assignments during this period.',
        facultyName: fullName(person),
        reportsTo: 'Avery Lindqvist',
        contactAddress: '1 Example Road, Calgary',
        contactPhone: '403-555-0100',
        applicantSignature: {uid: `uid-${person.id}`, attested: true, signedAt: stamp(-800)},
        reportToSignature: spec.status === 'pending_report_to' ? null : {uid: spec.reportTo, name: 'Avery Lindqvist', signedAt: stamp(-700)},
        adminSignature: approved ? {uid: 'uid-adfa-regular', name: 'ADFA Regular', signedAt: stamp(-600)} : null,
        rejectionReason: '',
        withdrawnBy: '',
        withdrawnAt: null,
        pdfChunkCount: approved ? 1 : 0,
        pdfSha256: approved ? 'seed-sha256-0000000000000000000000000000000000000000000000000000000000' : '',
        pdfByteLength: approved ? 1024 : 0,
        submittedAt: stamp(-800),
        approvedAt: approved ? stamp(-600) : null,
        updatedAt: stamp(-600 + index * 10)
      }
    });
    docs.push({
      path: `afc_audit/${spec.id}_submitted`,
      data: {
        action: 'afc_submitted',
        requesterUid: `uid-${person.id}`,
        reportToUid: spec.reportTo,
        changedBy: `uid-${person.id}`,
        changedAt: stamp(-800)
      }
    });
  });
  return docs;
}

function buildAuditLogs(sessions) {
  const session = sessions.find(s => s.data.type === 'LAB');
  return [
    {
      path: 'session_change_log/log-001',
      data: {
        action: 'session_updated',
        override: false,
        requestId: '',
        sessionId: session.path.replace('sessions/', ''),
        course: session.data.course,
        date: session.data.date,
        topic: session.data.topic,
        instructors: [],
        changes: [{field: 'room', before: 'HMRB 101', after: 'Clinical Skills Lab'}],
        changedBy: 'uid-adfa-regular',
        changedByName: 'ADFA Regular',
        changedByEmail: 'uid-adfa-regular@example.test',
        changedAt: stamp(-400)
      }
    },
    {
      path: 'faculty_change_log/flog-001',
      data: {
        action: 'update_doe_roles',
        facultyId: 'fac-003',
        facultyName: 'Mira Okonkwo',
        changes: [{field: 'managedRoles2026_27', label: 'DOE-linked faculty roles', before: [], after: ['visc']}],
        changedBy: 'uid-owner',
        changedByName: 'VISTA Owner',
        changedByEmail: 'uid-owner@example.test',
        changedAt: stamp(-500)
      }
    },
    {
      path: 'account_audit/aalog-001',
      data: {
        action: 'account_provisioned',
        targetUid: 'uid-fac-014',
        changedBy: 'uid-owner',
        changedByName: 'VISTA Owner',
        changedAt: stamp(-900)
      }
    },
    {
      path: 'audit_events/ae-001',
      data: {
        action: 'index_rebuilt',
        detail: 'Derived indexes rebuilt after import.',
        changedBy: 'uid-owner',
        changedByName: 'VISTA Owner',
        changedAt: stamp(-590)
      }
    }
  ];
}

function buildBulkImport() {
  return [
    {
      path: 'bulk_import_jobs/import-seed-001',
      data: {
        importId: 'import-seed-001',
        startedBy: 'uid-owner',
        startedAt: stamp(-700),
        status: 'COMPLETED',
        sourceFingerprint: 'seed-fingerprint-001',
        sourceWorkbook: 'seed-2026-27.xlsx',
        schemaVersion: 'ucvm-bulk-v1',
        backupFingerprint: 'seed-backup-001',
        lastUpdatedAt: stamp(-590)
      }
    },
    {
      path: 'bulk_import_jobs/import-seed-001/events/event-001',
      data: {action: 'apply_started', changedBy: 'uid-owner', changedAt: stamp(-700)}
    },
    {
      path: 'bulk_import_jobs/import-seed-001/events/event-002',
      data: {action: 'apply_completed', changedBy: 'uid-owner', changedAt: stamp(-590)}
    }
  ];
}

function buildDoePolicy() {
  const policyId = 'lab-synthetic-2026-27';
  const policyVersionId = 'lab-synthetic-2026-27-v1';
  const note = 'TEST ONLY - synthetic VISTA lab fixture; not an approved UCVM workload policy.';
  const createdAt = stamp(-800);
  const documents = [
    {
      path: `doe_policies/${policyId}`,
      data: {
        policyId,
        academicYear: ACADEMIC_YEAR,
        name: 'VISTA Lab Synthetic DOE Policy',
        description: note,
        currentActiveVersionId: policyVersionId,
        testOnly: true,
        createdBy: 'seed',
        createdAt,
        updatedBy: 'seed',
        updatedAt: createdAt
      }
    },
    {
      path: `doe_policy_versions/${policyVersionId}`,
      data: {
        policyVersionId,
        policyId,
        academicYear: ACADEMIC_YEAR,
        versionNumber: 1,
        status: 'active',
        revision: 1,
        name: 'VISTA Lab Synthetic DOE Policy v1',
        description: note,
        sourceType: 'synthetic_test_fixture',
        testOnly: true,
        publishedBy: 'seed',
        publishedByName: 'Synthetic Seed',
        publishedAt: createdAt,
        createdBy: 'seed',
        createdByName: 'Synthetic Seed',
        createdAt,
        updatedBy: 'seed',
        updatedByName: 'Synthetic Seed',
        updatedAt: createdAt
      }
    }
  ];

  const rules = [
    {key: 'lecture', name: 'Synthetic Lecture / SRL', teachingRole: 'Lecture', rate: DEFAULT_RATE.Lecture},
    {key: 'lab-lead', name: 'Synthetic Lab Lead', teachingRole: 'Lab Lead', rate: DEFAULT_RATE['Lab Lead']},
    {key: 'lab-support', name: 'Synthetic Lab Support', teachingRole: 'Lab Support', rate: DEFAULT_RATE['Lab Support']}
  ];

  for (const [index, spec] of rules.entries()) {
    const ruleId = `lab-rule-${spec.key}`;
    documents.push({
      path: `doe_rules/${ruleId}`,
      data: {
        ruleId,
        policyVersionId,
        ruleKey: `test.teaching.${spec.key}`,
        category: 'teaching',
        name: spec.name,
        calculationMode: 'per_hour',
        resultKind: 'credit',
        priority: 100 - index,
        enabled: true,
        sourceType: 'synthetic_test_fixture',
        reviewStatus: 'test_only',
        adminNote: note
      }
    });
    documents.push({
      path: `doe_rule_selectors/${ruleId}-selector-role`,
      data: {
        selectorId: `${ruleId}-selector-role`,
        ruleId,
        policyVersionId,
        field: 'teachingRole',
        operator: 'equals',
        valueText: spec.teachingRole,
        order: 1
      }
    });
    documents.push({
      path: `doe_rule_inputs/${ruleId}-input-hours`,
      data: {
        ruleInputId: `${ruleId}-input-hours`,
        ruleId,
        policyVersionId,
        inputName: 'hours',
        inputType: 'number',
        required: true,
        source: 'session.creditedHours',
        unit: 'hours',
        order: 1
      }
    });
    documents.push({
      path: `doe_rule_parameters/${ruleId}-param-rate`,
      data: {
        parameterId: `${ruleId}-param-rate`,
        ruleId,
        policyVersionId,
        name: 'rate',
        valueNumber: spec.rate,
        unit: 'synthetic_doe_per_hour',
        required: true,
        order: 1
      }
    });
  }

  return documents;
}

function buildPublicInfo() {
  return [
    {
      path: 'public_info/notice-board',
      data: {
        messages: [
          {title: 'Winter term schedule published', body: 'The 2026-27 winter term timetable is now available.', level: 'info'},
          {title: 'Clinical skills lab closed', body: 'Closed for maintenance on 2027-02-19.', level: 'warning'}
        ],
        updatedBy: 'uid-owner',
        updatedAt: stamp(-100)
      }
    },
    {
      path: 'public_schedule/ccc_events',
      data: {
        events: [
          {facultyId: 'fac-005', startDate: '2027-02-15', endDate: '2027-02-19', availability: 'Unavailable'}
        ],
        count: 1,
        facultyCount: 1,
        source: 'seed-2026-27',
        updatedBy: 'uid-owner',
        updatedByName: 'VISTA Owner',
        updatedAt: stamp(-100)
      }
    }
  ];
}

// --- public API -------------------------------------------------------------

function buildDataset() {
  const users = buildUsers();
  const faculty = buildFaculty();
  const {sessions, calendar} = buildSessionsAndCalendar();
  const requests = buildRequests(sessions, calendar);
  // Apply approved synthetic workflow state before computing derived settings
  // and notifications so every demo surface observes the same canonical data.
  const settings = buildSettings(sessions, faculty);
  const {groups: labGroups, rosters: labRosters} = buildLabGroupsAndRosters();
  const notifications = buildNotifications(sessions, requests);
  const afc = buildAfc();
  const audit = buildAuditLogs(sessions);
  const bulkImport = buildBulkImport();
  const doe = buildDoePolicy();
  const publicInfo = buildPublicInfo();

  const documents = [
    ...users,
    ...faculty,
    ...sessions,
    ...calendar,
    ...settings,
    ...labGroups,
    ...labRosters,
    ...buildGroups(),
    ...requests,
    ...notifications,
    ...afc,
    ...audit,
    ...bulkImport,
    ...doe,
    ...publicInfo
  ];

  return {
    projectId: 'vista-teaching-lab',
    academicYear: ACADEMIC_YEAR,
    generatedFrom: 'tools/seed/dataset.js',
    counts: {
      users: users.length,
      faculty: faculty.length,
      sessions: sessions.length,
      calendarSessions: calendar.length,
      settings: settings.length,
      labGroups: labGroups.length,
      labRosters: labRosters.length,
      requests: requests.length,
      notifications: notifications.length,
      afc: afc.length,
      audit: audit.length,
      bulkImport: bulkImport.length,
      doe: doe.length,
      publicInfo: publicInfo.length,
      total: documents.length
    },
    documents
  };
}

module.exports = {buildDataset, mulberry32, ACADEMIC_YEAR, FACULTY_SEED, USER_SEED, COURSES};
