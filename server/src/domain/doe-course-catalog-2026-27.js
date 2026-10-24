'use strict';

const SOURCE = 'Teaching Assignments 2026-27 MASTER.xlsx · Course Coordinator / HICCs';
const ACADEMIC_YEAR = '2026-27';

const COURSE_UNITS = Object.freeze({
  'VETM 601: Professional Skills in Health Science Research': 3,
  'VETM 602: Wildlife Health and Disease Ecology': 3,
  'VETM 604: Experiential Learning in Wildlife Health Ecology': 3,
  'VETM 606/607: Seminar Wildlife Health Ecology I and II': 3,
  'VETM 612: Animal Health Policy': 3,
  'VETM 650: Advanced Virology': 3,
  'VETM 690: Veterinary Genomics': 3,
  'VETM 702: Advanced Topics in Stem Cell Biology and Regenerative Medicine': 3,
  'VETM 706/707: Seminar Wildlife Health Ecology III and IV': 3,
  'VETM/MDCH 605: Introduction to Biotat Methods': 3,
  'VTMD 200: Intro to VetMed': 3,
  'VTMD 202: Professional Identity Formation 1': 3,
  'VTMD 204: Exploring VetMed 1': 3,
  'VTMD 206: Healthy Animals 1': 6,
  'VTMD 211: Practical Work Experience 1': 3,
  'VTMD 213: Animals as Populations': 3,
  'VTMD 215: What is a Vet?': 3,
  'VTMD 217: Healthy Animals 2': 6,
  'VTMD 302: Professional Identity Formation 2': 6,
  'VTMD 304: Science of What Goes Wrong 1 (non-infectious dz)': 3,
  'VTMD 306: Science of Whats Goes Wrong 2 (infectious dz)': 3,
  'VTMD 308: Fundamentals of Diagnosis, Management and Treatment': 3,
  'VTMD 311: Practical Work Experience 2': 3,
  'VTMD 313: Vets in Society': 3,
  'VTMD 315: Sick Animals-Head, oral GIT': 3,
  'VTMD 317: Sick Animals-Endocrine, renal reproduction': 3,
  'VTMD 319: Sick animals- Neonate, special senses, alternative species': 3,
  'VTMD 401: Group Problem Solving': 6,
  'VTMD 403: Intro to Clinical Rotations': 6,
  'VTMD 420: Sick Animals-Integument, MSK': 3,
  'VTMD 422: Sick Animals-Neurology and respiratory': 3,
  'VTMD 424: Sick Animals-Cardiovascular and Lymphatic': 3,
  'VTMD 430: Introduction to Surgery, Anesthesia & Hospitalized Case management': 6,
  'VTMD 500: Veterinary Practicum - Spring': 6,
  'VTMD 505: Veterinary Practicum - Summer': 6,
  'VTMD 510: Veterinary Practicum - Fall': 14,
  'VTMD 515: Veterinary Practicum - Winter': 14,
  'Vet Med 440: YEAR 3-One Health and Veterinary Practice': 1.5,
  'Vet Med 501: Clinical Presentations III': 3,
  'Vet Med 505: Clinical Skills III': 7,
  'Vet Med 506: Investigative Veterinary Medicine and Science Communication': 1.5,
  'Vet Med 508: Professional Skills III': 1.5,
  'Vet Med 521: Equine Medicine and Surgery': 2.5,
  'Vet Med 522: Small Animal Medicine and Surgery': 2.5,
  'Vet Med 523: Anesthesiology and Therapeutics': 1.5,
  'Vet Med 525: Advanced Health Management': 2,
  'Vet Med 530: Selected Topics in Clinical Medicine': 0.75,
  'Vet Med 531: Selected Topics in Small Ruminant, South American Camelid and Non-traditional Livestock Production': 0.75,
  'Vet Med 540: Food Animal Medicine and Surgery': 2,
  'Vet Med 541: Theriogenology': 1.5,
  'Vet Med 542: Emergency and Critical Care': 0.75,
  'Vet Med 550: Zoological Medicine': 0.75,
  'Vet Med 551: Laboratory Animal Medicine': 0.75,
  'Vet Med 571: Veterinary Diagnostics and Therapeutics': 10,
  'Vet Med 581: General Veterinary Practice': 15,
  'Vet Med 591: Clinical Enrichment': 15
});

const HICC_DEVELOPMENT_APPLICABILITY = Object.freeze({
  'VTMD 200: Intro to VetMed': false,
  'VTMD 202: Professional Identity Formation 1': false,
  'VTMD 204: Exploring VetMed 1': false,
  'VTMD 206: Healthy Animals 1': false,
  'VTMD 211: Practical Work Experience 1': false,
  'VTMD 213: Animals as Populations': false,
  'VTMD 215: What is a Vet?': false,
  'VTMD 217: Healthy Animals 2': false,
  'VTMD 302: Professional Identity Formation 2': true,
  'VTMD 304: Science of What Goes Wrong 1 (non-infectious dz)': true,
  'VTMD 306: Science of Whats Goes Wrong 2 (infectious dz)': true,
  'VTMD 308: Fundamentals of Diagnosis, Management and Treatment': true,
  'VTMD 311: Practical Work Experience 2': true,
  'VTMD 313: Vets in Society': true,
  'VTMD 315: Sick Animals-Head, oral GIT': true,
  'VTMD 317: Sick Animals-Endocrine, renal reproduction': true,
  'VTMD 319: Sick animals- Neonate, special senses, alternative species': true,
  'VTMD 401: Group Problem Solving': true,
  'VTMD 403: Intro to Clinical Rotations': true,
  'VTMD 420: Sick Animals-Integument, MSK': true,
  'VTMD 422: Sick Animals-Neurology and respiratory': true,
  'VTMD 424: Sick Animals-Cardiovascular and Lymphatic': true,
  'VTMD 430: Introduction to Surgery, Anesthesia & Hospitalized Case management': true,
  'VTMD 500: Veterinary Practicum - Spring': true,
  'VTMD 505: Veterinary Practicum - Summer': true,
  'VTMD 510: Veterinary Practicum - Fall': true,
  'VTMD 515: Veterinary Practicum - Winter': true
});

function normalizeCourseLabel(value) {
  return value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function courseEvidence(courseLabel) {
  const course = normalizeCourseLabel(courseLabel);
  return Object.freeze({
    academicYear: ACADEMIC_YEAR,
    course,
    courseUnits: Object.prototype.hasOwnProperty.call(COURSE_UNITS, course) ? COURSE_UNITS[course] : null,
    hiccDevelopmentApplicable: Object.prototype.hasOwnProperty.call(HICC_DEVELOPMENT_APPLICABILITY, course)
      ? HICC_DEVELOPMENT_APPLICABILITY[course]
      : null,
    source: SOURCE
  });
}

module.exports = {
  SOURCE,
  ACADEMIC_YEAR,
  COURSE_UNITS,
  HICC_DEVELOPMENT_APPLICABILITY,
  normalizeCourseLabel,
  courseEvidence
};
