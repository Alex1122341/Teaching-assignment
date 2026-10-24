'use strict';

const GUIDELINE_SOURCE = Object.freeze({
  title: 'UCVM Workload Guidelines',
  leadershipApproved: '2025-02-26',
  facultyCouncilApproved: '2025-03-12',
  effective: '2025-04-01',
  updated: '2025-12-23'
});

const SOURCE_REFERENCE = `${GUIDELINE_SOURCE.title}; Leadership approved ${GUIDELINE_SOURCE.leadershipApproved}; UCVM Faculty Council approved ${GUIDELINE_SOURCE.facultyCouncilApproved}; effective ${GUIDELINE_SOURCE.effective}; updated ${GUIDELINE_SOURCE.updated}`;

function rule(ruleCode, category, ruleLabel, rateOrTierPct, basis, requiredInput, calculationOrNote, academicYearOrStage = null) {
  return Object.freeze({
    ruleCode, category, ruleLabel, academicYearOrStage, rateOrTierPct, basis,
    requiredInput, calculationOrNote, sourceReference: SOURCE_REFERENCE
  });
}

const DOE_RULES = Object.freeze([
  rule('doe_definition', 'Definition', 'Distribution of Effort total concept', '100%', 'total workload allocation', 'individual contract allocation', 'Distribution of Effort spans Teaching, Research, Service, and PPVM; the 100% concept is a reference, not an inference rule.'),
  rule('teaching_year', 'Academic year', 'Teaching year', null, 'annual teaching cycle', 'academic calendar', 'Spring semester / May through the end of Winter semester / April of the following year.'),
  rule('lecture', 'Assigned Teaching', 'Lecture', '0.30%', 'per contact hour', 'contact hours', 'DOE rate reference; calculate only when authoritative role, hours, and credit inputs exist.'),
  rule('srl', 'Assigned Teaching', 'SRL', '0.30%', 'per hour', 'SRL hours', 'DOE rate reference; calculate only when authoritative role, hours, and credit inputs exist.'),
  rule('lab_primary', 'Assigned Teaching', 'Lab Primary', '0.21%', 'per hour', 'lab hours and primary role', 'DOE rate reference; calculate only when authoritative role, hours, and credit inputs exist.'),
  rule('lab_secondary', 'Assigned Teaching', 'Lab Secondary', '0.19%', 'per hour', 'lab hours and secondary role', 'DOE rate reference; calculate only when authoritative role, hours, and credit inputs exist.'),
  rule('course_coordination_lt3', 'Course Coordination', 'Course coordination under 3 units', '1.75%', 'per course', 'course units and coordinator assignment', 'Apply only after course units and the coordinator role are confirmed.', 'under 3 units'),
  rule('course_coordination_3_5', 'Course Coordination', 'Course coordination 3–5 units', '3.5%', 'per course', 'course units and coordinator assignment', 'Apply only after course units and the coordinator role are confirmed.', '3–5 units'),
  rule('course_coordination_6_9', 'Course Coordination', 'Course coordination 6–9 units', '7%', 'per course', 'course units and coordinator assignment', 'Apply only after course units and the coordinator role are confirmed.', '6–9 units'),
  rule('course_coordination_10_14', 'Course Coordination', 'Course coordination 10–14 units', '10%', 'per course', 'course units and coordinator assignment', 'Apply only after course units and the coordinator role are confirmed.', '10–14 units'),
  rule('course_coordination_15_plus', 'Course Coordination', 'Course coordination 15+ units', '15%', 'per course', 'course units and coordinator assignment', 'Apply only after course units and the coordinator role are confirmed.', '15+ units'),
  rule('rotation_participant', 'Clinical Rotation', 'Clinical rotation participant', '2.5%', 'per week', 'rotation participation weeks', 'Apply only to a confirmed rotation participant assignment.'),
  rule('rotation_coordination', 'Clinical Rotation', 'Designated rotation coordination', '+2%', 'per unique rotation type', 'designated coordinator and unique rotation type', 'Additional coordination credit; count each confirmed unique rotation type once.'),
  rule('ccc_shift', 'CCC', 'CCC shift', '0.5%', 'per shift', 'confirmed CCC shift count', 'Apply 0.5% per confirmed CCC shift. A CCC role label by itself does not establish the number of shifts.'),
  rule('new_faculty_development', 'Development', 'New academic staff career development', 'up to 10%; maximum 2 years', 'per year', 'eligible appointment and year of development', 'Ceiling only; do not infer an individual allocation.'),
  rule('instructional_development', 'Development', 'Approved instructional development / special activities', 'up to 5%', 'approved activity', 'approved activity and documented allocation', 'Ceiling only; requires approved activity evidence.'),
  rule('supervision_reserve_split', 'Trainee Supervision', 'Teaching reserve split at or below 35%', 'equal split', 'reserve allocation', 'Teaching DOE at or below 35%', 'Initial Teaching DOE reserve is divided equally between Assigned Teaching Reserve and Trainee Reserve.'),
  rule('supervision_reserve_ceiling', 'Trainee Supervision', 'Trainee reserve ceiling above 35%', '15%', 'maximum reserve', 'Teaching DOE above 35%', 'Ceiling; does not generate an individual trainee allocation.'),
  rule('teaching_focused_reserve_ceiling', 'Trainee Supervision', 'Teaching-focused stream trainee reserve ceiling', '7.5%', 'maximum reserve', 'teaching-focused stream and applicable allocation', 'Ceiling; does not generate an individual trainee allocation.'),
  rule('supervision_rolling_average', 'Trainee Supervision', 'Supervision workload averaging', null, 'three-year rolling average', 'trainee supervision source data for available years', 'Normally use a three-year rolling average when available; otherwise use current-year evidence.'),
  rule('supervision_undergraduate', 'Trainee Supervision', 'Undergraduate supervision', '1%', 'per trainee', 'confirmed undergraduate trainee count', 'Do not calculate without the required trainee source data.'),
  rule('supervision_4th_year_preceptor', 'Trainee Supervision', '4th Year Preceptor', '0.75%', 'per trainee', 'confirmed fourth-year trainee count', 'Do not calculate without the required trainee source data.'),
  rule('supervision_graduate_primary', 'Trainee Supervision', 'Graduate primary supervisor', '3%', 'per trainee', 'confirmed graduate primary-supervision count', 'Do not calculate without the required trainee source data.'),
  rule('supervision_graduate_cosupervisor', 'Trainee Supervision', 'Graduate co-supervisor', '2%', 'per trainee', 'confirmed graduate co-supervision count', 'Do not calculate without the required trainee source data.'),
  rule('supervision_postdoctoral', 'Trainee Supervision', 'Postdoctoral fellow', '1.5%', 'per trainee', 'confirmed postdoctoral trainee count', 'Do not calculate without the required trainee source data.'),
  rule('hicc_curriculum_development', 'HICC Development', 'HICC new-curriculum course development', '2%', 'per course unit', 'HICC role meaning, units, curriculum student year, and development phase', 'Applies only while curriculum development remains applicable. After that student-year curriculum is finalized, development credit no longer applies; ordinary course coordinator credit may still apply.'),
  rule('visc_2025_26', 'VISC Development', 'VISC subject development', '7.5%', 'per subject', 'confirmed VISC subject-development assignment', 'Year/stage-specific reference; do not infer subject-development activity.', '2025-26'),
  rule('visc_2026_27', 'VISC Development', 'VISC subject development', '5%', 'per subject', 'confirmed VISC subject-development assignment', 'Year/stage-specific reference; do not infer subject-development activity.', '2026-27'),
  rule('visc_2027_28', 'VISC Development', 'VISC subject development', '2.5%', 'per subject', 'confirmed VISC subject-development assignment', 'Year/stage-specific reference; do not infer subject-development activity.', '2027-28'),
  rule('visc_2028_maintenance', 'VISC Development', 'VISC maintenance', '1.75%', 'maintenance', 'confirmed VISC maintenance assignment', 'Year/stage-specific maintenance reference; do not infer subject-development activity.', '2028+'),
  rule('research_expectation', 'Research / Scholarly Activity', 'Research workload ranges', null, 'expectation range', 'individual authoritative contract allocation', 'Research expectation ranges are not a formula for individual contract DOE. Use the Faculty Master List allocation; never infer from rank or stream.'),
  rule('teaching_focused_scholarly', 'Research / Scholarly Activity', 'Teaching-focused scholarly activity ceiling', 'up to 10%', 'Dean-approved allocation', 'Dean approval and individual allocation', 'A ceiling with approval requirement, not a default individual value.'),
  rule('ppvm_contract', 'PPVM', 'PPVM individual contract allocation', null, 'negotiated individual contract', 'authoritative individual contract allocation', 'PPVM is contract-specific; do not infer from clinical status, rank, FTE, role title, or session assignments.'),
  rule('service_admin_contract', 'Service / Admin', 'Service and administrative contract allocation', null, 'individual contract allocation', 'Faculty Master List ServiceAdmin value', 'Use the Faculty Master List ServiceAdmin contract allocation. Dedicated administrative-role DOE includes service; it must not be split across individual roles without an explicit source. No universal Admin percentage formula exists.')
]);

module.exports = { DOE_RULES, GUIDELINE_SOURCE, SOURCE_REFERENCE };
