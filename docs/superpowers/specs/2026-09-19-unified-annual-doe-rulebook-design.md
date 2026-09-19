# Unified Annual DOE Rule Book and Server-Side Calculation Design

**Date:** 2026-09-19  
**Status:** Design approved in chat; implementation not started  
**Repository:** `Alex1122341/Teaching-assignment`  
**Depends on:** existing DOE Policy Engine foundation in Draft PR #45  
**Primary source:** UCVM Workload Guidelines, effective April 1, 2025 and updated December 23, 2025

---

## 1. Purpose

This design turns DOE from several partially connected calculation paths into one authoritative annual system.

The operational goal is simple:

> Once per academic year, one authorized administrator should be able to spend approximately one working day reviewing the current UCVM Workload Guideline, confirming the Annual DOE Rule Book, and publishing it. After publication, each faculty member's teaching DOE should be derived automatically and consistently from their actual assignments.

The system must eliminate duplicated DOE formulas across Lookup, DOE List, Faculty Profile, Timetable, Approval, Swap, and other consumers.

The system must prioritize correctness over completeness. A missing rule or missing required input must return an explicit review/error state. It must never silently become zero and must never guess a DOE value.

---

## 2. Fixed Product Decisions

The following decisions are part of this design.

### 2.1 One authoritative calculation path

All DOE consumers use the same authoritative annual policy and the same calculation service.

Consumers include:

- Faculty Lookup;
- DOE List;
- Faculty Profile;
- Timetable session and assignment editing;
- Faculty Swap;
- Approval Queue impact preview;
- Role and appointment editing;
- annual workload review;
- administrative Impact Preview;
- administrative Recalculate;
- derived indexes and reports.

No consumer may keep its own policy rates.

### 2.2 Policy algorithms live in the database, not frontend code

The frontend must not contain policy-specific values such as:

- Lecture = 0.30;
- Lab Primary = 0.21;
- Lab Secondary = 0.19;
- HICC = 2% per unit;
- VISC = 2.5% for a specific curriculum year;
- course coordination tier values;
- supervision rates;
- trainee reserve thresholds.

The database stores:

- annual policy versions;
- rule categories;
- selectors;
- calculation modes;
- parameters;
- tiers;
- rule inputs;
- course/subject mappings;
- reserve rules;
- references;
- approved exceptions;
- policy lifecycle state.

Frontend code may understand generic presentation concepts, but it must not define current UCVM workload policy.

### 2.3 DOE calculation executes server-side

The authoritative calculation is performed by a UCVM DOE API hosted in Azure App Service.

The frontend submits assignment facts and requests results.

The server:

1. authenticates and authorizes the caller;
2. loads the Active policy for the requested academic year;
3. loads the required mappings and parameters;
4. validates the input facts;
5. matches exactly one applicable rule or approved exception;
6. calculates DOE;
7. records provenance when the request is a write;
8. returns the result and explanation.

The browser must not be the authority for DOE calculations.

### 2.4 Storage remains repository-based

The DOE API must not hard-code one database technology into the domain engine.

Initial policy persistence may continue to use the existing Firestore DOE repository while the server-side API is introduced.

The target architecture supports a later Azure SQL repository without changing:

- rule semantics;
- policy IDs;
- calculation contracts;
- API response models;
- frontend behavior;
- historical calculation evidence.

### 2.5 Teaching DOE is the first fully automated scope

This design fully automates teaching-related DOE where the Workload Guideline provides a defensible rule.

It includes:

- Lecture;
- SRL;
- Lab Primary;
- Lab Secondary;
- Course Coordination;
- Clinical Rotation participation;
- designated Rotation Coordination;
- HICC;
- VISC;
- Trainee Supervision;
- teaching reserve logic;
- approved teaching exceptions;
- other approved teaching activities when represented by an explicit rule.

Research, Service, and PPVM remain approved/source values unless a future approved source provides deterministic formulas.

---

## 3. Annual DOE Rule Book

One Academic Year has one policy family and at most one Active version.

Examples:

- `2026-27 / v1`
- `2027-28 / v1`
- `2027-28 / v2`

Lifecycle:

`draft -> active -> archived`

Published versions are immutable.

Changes to an Active policy require a new Draft version.

---

## 4. Annual Administrator Workflow

The main annual workflow is designed to be completed in one focused review session.

### 4.1 Start the next academic year

The administrator selects:

**Copy from Previous Year**

Example:

`2026-27 Active -> 2027-28 Draft v1`

The new Draft copies:

- teaching rules;
- selectors;
- rates and parameters;
- tier definitions;
- required inputs;
- course coordination thresholds;
- rotation rules;
- supervision rates;
- HICC rule;
- VISC rule structure;
- course and subject mappings;
- reserve rules;
- references;
- calculation modes;
- approved recurring rule metadata.

It does not copy:

- publication records;
- calculation records;
- impact runs;
- audit history;
- one-time faculty exceptions;
- one-time temporary assignments;
- year-specific approval evidence that is not marked recurring.

### 4.2 Every copied item enters annual review state

Copied rules are not automatically considered reviewed.

Each copied item has an annual review status:

- `needs_review`;
- `confirmed_unchanged`;
- `updated`;
- `new`;
- `retired`.

The UI highlights differences from the prior Active year.

### 4.3 Administrator reviews the current Workload Guideline

The administrator works section-by-section:

1. Assigned Teaching;
2. Course Coordination;
3. Clinical Rotations;
4. Supervision;
5. HICC / VISC;
6. Reserve Logic;
7. Other / Approved Activities;
8. References;
9. Validate;
10. Impact Preview;
11. Publish.

### 4.4 Publication gate

Publish is blocked unless:

- all required rule groups have been reviewed;
- all enabled rules have a Reference;
- all required mappings are complete;
- no rule ambiguity exists;
- no required input is missing from the rule definition;
- validation passes;
- Impact Preview passes against current faculty and timetable data;
- the Draft revision/checksum matches the preview;
- the source dataset checksum matches the preview;
- the Active policy has not changed after preview.

---

## 5. Workload Guideline Rule Inventory

The Annual DOE Rule Book must be capable of representing all deterministic Teaching rules found in the reviewed UCVM Workload Guidelines.

### 5.1 Assigned Teaching

#### Lecture

- Calculation: per credited hour.
- Current documented rate: 0.30% per hour.
- Reference: Section 6.2, Table 1.

#### SRL

- Calculation: per credited hour.
- Current documented rate: 0.30% per hour.
- Reference: Section 6.2, Table 1.

#### Lab Primary

- Calculation: per credited hour.
- Current documented rate: 0.21% per hour.
- Reference: Section 6.2, Table 1.

#### Lab Secondary

- Calculation: per credited hour.
- Current documented rate: 0.19% per hour.
- Reference: Section 6.2, Table 1.

### 5.2 Course Coordination

Course Coordination is tiered by course units.

Current documented tiers:

- less than 3 units -> 1.75% per course;
- 3-5 units -> 3.5% per course;
- 6-9 units -> 7% per course;
- 10-14 units -> 10% per course;
- 15+ units -> 15% per course.

The engine must use explicit unit input or an approved Course Mapping. It may not infer units from a course number.

### 5.3 Clinical Rotations

#### Rotation Participant

- Calculation: per week.
- Current documented rate: 2.5% per week.

#### Designated Rotation Coordination

- Additional credit.
- Current documented rate: 2% per unique rotation type.
- The faculty member may also receive Rotation Participant credit.
- The rule requires an explicit designated-coordinator fact, not merely a role label containing “Coordinator”.

### 5.4 New Academic Staff Career Development

- Up to 10% per year.
- Maximum two years.

Because the guideline says “up to”, the annual Rule Book must represent this as an approved/capped allocation rather than assume every eligible faculty member receives 10%.

### 5.5 Special Activities / Instructional Development

- Up to 5%.

Because the value is discretionary and capped, the system requires an approved assignment value or approved rule input within the maximum.

### 5.6 Trainee Supervision

Current documented base values:

- Undergraduate / Summer Student / Intern: 1% per trainee;
- 4th Year Preceptor: 0.75% per trainee;
- Graduate Student Primary Supervisor: 3% per trainee;
- Graduate Student Co-supervisor: 2% per trainee;
- Postdoctoral Fellow: 1.5% per trainee.

Graduate supervision uses a three-year rolling average when available; otherwise current-year load is used.

### 5.7 HICC Development

The current documented HICC development rule is:

- 2% per unit.

HICC must therefore be modeled as:

`faculty HICC assignment + course + course units + academic/curriculum context -> DOE`

The final DOE is not entered manually.

### 5.8 VISC Development

VISC is year/stage dependent.

The reviewed guideline states:

- 2025-26: 7.5% per VISC subject;
- 2026-27: 5%;
- 2027-28: 2.5%;
- Maintenance (2028 and beyond): 1.75%.

The Rule Book stores the VISC stage/rate logic. A separate subject mapping identifies the relevant VISC subject assignment.

### 5.9 Trainee Reserve / Assigned Teaching Reserve

The engine must model reserve logic separately from raw supervision credit.

The reviewed guideline includes:

- Teaching DOE of 35% or less starts with equal Assigned Teaching Reserve and Trainee Reserve;
- when trainee supervision exceeds its initial reserve, the trainee reserve may expand and assigned teaching reserve changes accordingly;
- when trainee supervision is below reserve, assigned teaching can use the available reserve;
- Teaching DOE above 35% uses a trainee reserve ceiling of 15%;
- Teaching Focused faculty use a trainee reserve ceiling of 7.5%;
- trainee load above the amount used for the annual teaching allocation remains visible as full supervisory load.

The Worksheet must therefore distinguish:

- Raw Supervision DOE;
- Applied Supervision DOE;
- Initial Trainee Reserve;
- Final Trainee Reserve;
- Assigned Teaching Reserve;
- Unapplied / informational supervisory load where applicable.

---

## 6. Course and Role Mapping

Policy rates alone are not sufficient.

The system needs an annual mapping layer for facts the Workload Guideline does not enumerate by specific course number or subject.

### 6.1 HICC Course Mapping

Example fields:

- mappingId;
- academicYear;
- courseCode;
- courseName;
- unitCount;
- HICC eligible;
- curriculumYear;
- effectiveStart;
- effectiveEnd;
- sourceReference;
- adminNote;
- reviewStatus.

Example:

`VTMD 204 -> 6 units`

The HICC calculation then becomes:

`6 units * 2% = 12% DOE`

### 6.2 Course Coordination Mapping

Where course units are not already stored authoritatively on the assignment, the Course Mapping supplies unit count for tier selection.

### 6.3 VISC Subject Mapping

Fields include:

- subjectKey;
- displayName;
- curriculumStage;
- applicable program year;
- active status;
- sourceReference;
- adminNote.

The VISC rate comes from the annual rule; the subject mapping identifies the assignment scope.

### 6.4 Mapping accuracy rule

If a rule requires a mapping and the mapping is absent:

- calculation status = `needs_review`;
- no DOE value is inferred;
- the admin validation view lists the unmapped entity;
- Publish is blocked when the missing mapping affects an active assignment.

---

## 7. Assignment Facts

Faculty records should describe what the faculty member is assigned to do.

They should not be the primary location of DOE policy.

Representative assignment facts:

- academicYear;
- facultyId;
- assignmentType;
- activityType;
- teachingRole;
- courseCode;
- subjectKey;
- roleType;
- hours;
- creditedHours;
- units;
- weeks;
- shifts;
- traineeType;
- traineeCount;
- supervisionRole;
- FTE where needed by the policy;
- designatedRotationCoordinator;
- effective dates;
- source entity ID.

### 7.1 Managed roles migration

The current `managedRoles2026_27[].doeCredit` model must be migrated away from manually-entered final DOE.

New role assignments store facts such as:

- Role = HICC;
- Course = VTMD 204;
- Academic Year = 2027-28.

The server returns the DOE.

Manual fixed DOE is permitted only through a Policy Exception or an approved discretionary assignment mode where the guideline itself defines an “up to” value.

---

## 8. Faculty DOE Worksheet

The authoritative Faculty DOE Worksheet is the shared read model for all DOE UI.

Representative structure:

### A. Effective Target

- Contract Teaching DOE;
- approved target adjustment/override;
- effective target;
- source and reference.

### B. Scheduled Teaching

Line items for:

- Lecture;
- SRL;
- Lab Primary;
- Lab Secondary;
- other policy-covered sessions.

Each line includes:

- source assignment;
- quantity;
- rule;
- rate/parameters;
- calculation;
- result;
- reference;
- policy version;
- calculation ID.

### C. Course / Role DOE

Line items for:

- Course Coordination;
- HICC;
- VISC;
- Rotation Coordination;
- other deterministic teaching roles.

### D. Rotation Participation

Line items by applicable rotation/week.

### E. Supervision

Line items by supervision type and quantity.

Also includes:

- raw supervision subtotal;
- three-year rolling-average basis where applicable;
- reserve application.

### F. Approved Exceptions / Adjustments

Every exception includes:

- result;
- reason;
- source reference;
- approving authority;
- policy version.

### G. Totals

- Scheduled Teaching DOE;
- Role DOE;
- Raw Supervision DOE;
- Applied Supervision DOE;
- Adjustments / Exceptions;
- Total Assigned Teaching DOE;
- Effective Target DOE;
- Remaining / Overage.

---

## 9. Lookup Page Integration

Lookup must become the primary detailed explanation view for a faculty member's DOE.

It must not calculate its own DOE.

The Lookup profile receives one server-generated Worksheet and renders:

- Assigned Teaching DOE;
- Effective Target;
- Remaining / Overage;
- Policy Version;
- Calculation Status;
- Scheduled Teaching subtotal;
- Role subtotal;
- Supervision subtotal;
- Reserve status;
- approved adjustments/exceptions;
- detailed DOE line items.

Every DOE line is expandable to show:

- assignment;
- formula presentation;
- quantity;
- parameter/rate;
- result;
- Reference;
- policy version;
- calculation timestamp.

Lookup must clearly label:

- `Calculated`;
- `Approved Exception`;
- `Needs Review`;
- `Historical`.

---

## 10. DOE List Integration

DOE List is a summary projection of the same Faculty DOE Worksheet.

Recommended columns:

- Faculty;
- Effective Target;
- Scheduled Teaching;
- Roles;
- Raw Supervision;
- Applied Supervision;
- Adjustments;
- Assigned Teaching DOE;
- Remaining / Overage;
- Policy Version;
- Calculation Status;
- Last Calculated.

DOE List must not recompute totals from raw Faculty records.

Selecting a faculty member opens the same detailed Worksheet used by Lookup.

This guarantees that Lookup and DOE List cannot disagree mathematically.

---

## 11. Timetable, Approval, and Swap Integration

### 11.1 Timetable

When a DOE-relevant assignment is created or edited:

1. frontend submits the proposed assignment facts to the DOE API;
2. server loads the Active policy for that academic year;
3. server returns the calculated DOE and provenance;
4. the save operation persists the assignment and calculation record;
5. the Faculty Worksheet/index is refreshed.

Room, free-text Topic, ordinary Notes, or similar non-DOE fields do not trigger recalculation unless a rule explicitly declares them as inputs.

### 11.2 Swap

Swap preview calls the server for the incoming/outgoing effect.

It shows:

- current assigned DOE;
- DOE removed from outgoing faculty;
- DOE added to incoming faculty;
- projected total;
- target remaining/overage;
- exact matched rule and reference.

It does not calculate the transferred DOE locally.

### 11.3 Approval

Approval Queue impact uses the same server-side preview endpoint.

Approval must not rely on a separate local DOE formula.

---

## 12. Azure DOE API

The recommended server-side service is an Azure App Service API.

### 12.1 Core responsibilities

The API owns:

- policy loading;
- mapping loading;
- validation;
- rule matching;
- formula evaluation;
- reserve logic;
- calculation provenance;
- Faculty Worksheet construction;
- dry-run preview;
- recalculation orchestration;
- authorization for protected calculation/configuration operations.

### 12.2 Representative endpoints

Read/calculation endpoints:

- `GET /api/doe/policies/{academicYear}/active`
- `POST /api/doe/calculate`
- `POST /api/doe/preview-assignment`
- `GET /api/doe/faculty/{facultyId}/worksheet?academicYear=2027-28`
- `GET /api/doe/list?academicYear=2027-28`

Administration endpoints:

- `POST /api/doe/policy-years/{academicYear}/copy-from/{sourceYear}`
- `PUT /api/doe/drafts/{policyVersionId}/rules/{ruleId}`
- `PUT /api/doe/drafts/{policyVersionId}/mappings/{mappingId}`
- `POST /api/doe/drafts/{policyVersionId}/validate`
- `POST /api/doe/drafts/{policyVersionId}/impact-preview`
- `POST /api/doe/drafts/{policyVersionId}/publish`
- `POST /api/doe/policies/{academicYear}/recalculate`

The exact REST naming can be adjusted during implementation, but consumers must remain behind a stable API contract.

### 12.3 Client trust boundary

The server never accepts a client-supplied final DOE as authoritative for normal rules.

The client sends facts.

The server calculates the result.

A fixed DOE can only be accepted through a server-authorized exception or approved discretionary workflow.

---

## 13. Database Model

The existing policy entities remain useful:

- doe_policies;
- doe_policy_versions;
- doe_rules;
- doe_rule_selectors;
- doe_rule_parameters;
- doe_rule_tiers;
- doe_rule_inputs;
- doe_exceptions;
- doe_impact_runs;
- doe_impact_rows;
- doe_publications;
- doe_recalculation_batches;
- doe_calculation_records;
- doe_audit_log.

The following annual configuration entities are added or formalized:

### 13.1 doe_reference_sources

Stores structured policy references:

- referenceId;
- title;
- version/date;
- section;
- table;
- page;
- effectiveDate;
- documentLink where authorized;
- notes.

### 13.2 doe_course_mappings

Stores annual Course/HICC/unit information.

### 13.3 doe_subject_mappings

Stores VISC subject scope and stage.

### 13.4 doe_rule_review_status

Stores annual confirmation state per copied rule/mapping.

This may be implemented as fields on the Draft entities if the repository contract remains clean.

### 13.5 doe_faculty_worksheets / derived read model

A server-maintained read model may be used to make Lookup and DOE List efficient.

It must be derived from canonical assignment/calculation data and must be rebuildable.

It must never become an independent source of truth.

---

## 14. Reference Model

Reference is a first-class policy field, separate from Notes.

Every enabled deterministic rule must point to a structured Reference.

Example:

- Document: UCVM Workload Guidelines;
- Section: 6.4 Development of the new curriculum;
- Table: Table 3;
- Page: 5;
- Effective Date: 2025-04-01.

Notes remain optional free text for administrative explanation.

Missing required Reference blocks publication.

---

## 15. Error and Accuracy Policy

The system fails closed.

### 15.1 No matching rule

Result:

`NEEDS_REVIEW: NO_MATCHING_RULE`

No DOE value is silently created.

### 15.2 Multiple equal-priority matching rules

Result:

`ERROR: AMBIGUOUS_RULE`

The admin must resolve the policy conflict.

### 15.3 Missing HICC course units

Result:

`NEEDS_REVIEW: COURSE_MAPPING_REQUIRED`

### 15.4 Missing VISC subject mapping

Result:

`NEEDS_REVIEW: SUBJECT_MAPPING_REQUIRED`

### 15.5 Missing required quantity

Examples:

- hours;
- weeks;
- trainees.

Result:

`NEEDS_REVIEW: REQUIRED_INPUT_MISSING`

### 15.6 Missing Reference

Draft may be edited, but it cannot be published.

### 15.7 Non-finite or out-of-range result

Calculation fails and is not persisted as a valid DOE.

### 15.8 Historical values

Historical published DOE remains bound to the policy/calculation evidence that produced it.

A future policy change does not silently rewrite historical records.

---

## 16. Current UI Style

The new DOE administration UI must visually match the current Faculty Dashboard / VISTA interface.

It should reuse current design tokens and patterns:

- UCalgary/VISTA masthead;
- current light-gray page background;
- white panels;
- current red/navy accent system;
- existing tab treatment;
- current buttons;
- existing data table styling;
- existing modal layout;
- existing status pills;
- existing spacing/radius/shadow scale.

The approved DOE Rules concept uses:

- existing Faculty Dashboard top-level `DOE Rules` tab;
- Academic Year and Policy Version controls;
- Copy from Previous Year;
- Validate;
- Impact Preview;
- Publish;
- collapsible rule sections;
- Workload Guideline reference panel;
- course/subject mapping tabs;
- prior-year change comparison;
- rule status indicators.

The UI must look like an extension of the current application, not a separate product.

---

## 17. Role-Based Access

### ADFA General / Owner

May:

- create/copy a policy year;
- edit Draft rules;
- edit mappings;
- validate;
- preview;
- publish;
- archive;
- recalculate.

### ADFA Regular

May:

- edit Draft rules;
- edit mappings;
- validate;
- preview.

May not:

- publish;
- archive Active;
- execute administrative Recalculate.

### Faculty / HICC / VISC / other non-admin roles

May not administer the DOE Rule Book.

They may see authorized DOE explanation on their own/read-permitted Faculty Worksheet.

Server-side authorization is mandatory; hiding buttons is not sufficient.

---

## 18. Migration from Current DOE

The migration must preserve current history.

### 18.1 Existing Timetable DOE

Existing timetable assignments with persisted:

- doeCredit;
- doePolicyVersionId;
- doeRuleId;
- doeRuleKey;
- doeCalculationId

remain valid historical records.

### 18.2 Existing managed roles

Existing `managedRoles2026_27` rows are inventoried.

Each row is classified as one of:

- deterministic Rule Book assignment fact;
- approved discretionary value;
- fixed migration exception;
- unresolved review item.

No value is discarded.

### 18.3 Existing faculty summary / workload data

`facultySummary2026_27` and `workloadPolicy2026_27` remain migration/source evidence.

They are not the long-term formula engine.

Current source-reconciled values remain explicit exceptions or reconciliation evidence until every component has a defensible rule.

### 18.4 Year-specific field cleanup

New design must not create permanent growth such as:

- `managedRoles2027_28`;
- `managedRoles2028_29`;
- `doeOverride2027_28`;
- `facultySummary2027_28`.

New annual data uses academicYear fields and stable collections/entities rather than new property names per year.

---

## 19. Derived Data and Recalculation

A change to a Draft Rule Book does not change live DOE.

Publishing only makes the version Active.

Administrative Recalculate is a separate General-only action.

Recalculate:

1. performs a dry run;
2. identifies affected assignments/faculty;
3. shows old/new policy versions;
4. shows old/new DOE;
5. records errors/warnings;
6. requires explicit confirmation;
7. writes in resumable chunks;
8. appends calculation evidence;
9. refreshes the Faculty Worksheet/read model only after canonical writes succeed.

---

## 20. Testing Strategy

The implementation must be test-driven.

### 20.1 Rule unit tests

Cover every guideline rule:

- Lecture;
- SRL;
- Lab Primary;
- Lab Secondary;
- all Course Coordination tiers;
- Rotation Participant;
- Rotation Coordinator;
- New Faculty cap;
- Special Activities cap;
- every Trainee Supervision type;
- HICC;
- each VISC stage;
- reserve scenarios.

### 20.2 Guideline scenario tests

The Appendix A scenarios from the reviewed Workload Guideline are fixtures.

The engine output must reproduce the documented scenarios where the source contains enough information.

Where a scenario depends on discretionary or unspecified values, the fixture must explicitly represent those as approved inputs instead of inventing a rule.

### 20.3 Mapping tests

Cover:

- valid HICC course;
- missing units;
- retired course;
- VISC subject/year;
- missing subject;
- mapping change between academic years.

### 20.4 Cross-view consistency tests

For one Faculty Worksheet:

- Lookup total;
- DOE List total;
- Faculty Profile total;
- Timetable projected total;
- Swap preview;
- Approval preview

must all equal the same server-produced values.

### 20.5 Security tests

Verify:

- Regular cannot Publish/Recalculate;
- General can;
- non-admin cannot modify policy configuration;
- client cannot submit an arbitrary final DOE as authoritative;
- published policy is immutable;
- calculation records are append-only historical evidence.

### 20.6 Annual roll-forward tests

Verify:

- all intended rule/mapping fields copy;
- history/publications/calculations do not copy;
- review status resets;
- changed-year VISC values are detectable;
- missing annual review blocks publication.

---

## 21. Rollout Strategy

This change is large enough to be implemented in controlled phases.

### Phase 1 — Complete the Rule Book model

Build complete Teaching Rule Book support, mappings, structured References, annual copy/review state, and server API contracts without changing live Faculty totals.

### Phase 2 — Server-side calculation authority

Move authoritative DOE calculation to the Azure API while preserving current Firestore-backed repository storage.

### Phase 3 — Assignment Facts and managed-role migration

Convert Faculty Edit role DOE from manual final values into assignment facts and server-calculated results.

### Phase 4 — Unified Faculty DOE Worksheet

Build the server Worksheet and switch Lookup + DOE List to it first.

### Phase 5 — Timetable / Swap / Approval

Switch all preview and write flows to the same server calculation contract.

### Phase 6 — Reserve and supervision completion

Complete annual rolling-average and reserve calculations with guideline scenario verification.

### Phase 7 — Annual roll-forward

Enable one-day annual Copy -> Review -> Validate -> Preview -> Publish workflow.

### Phase 8 — Remove legacy calculation paths

After parity and acceptance:

- remove frontend policy constants;
- remove local DOE recomputation paths;
- stop creating new year-suffixed DOE structures;
- retain historical source fields only where needed for evidence.

---

## 22. Acceptance Criteria

The design is successful when all of the following are true:

1. No active frontend production path contains UCVM-specific DOE rate constants.
2. The database is the authoritative source for annual rules, parameters, mappings, references, and exceptions.
3. Azure API is the authoritative calculator.
4. A Faculty assignment contains facts, not manually-entered deterministic DOE.
5. HICC DOE is derived from Role + Course + annual units + annual HICC rule.
6. VISC DOE is derived from Subject + academic/curriculum stage + annual VISC rule.
7. Lookup and DOE List display the same Faculty Worksheet.
8. Timetable, Swap, and Approval use the same server calculation service.
9. Missing inputs/mappings/rules produce review/error states rather than zero.
10. Every calculated line identifies rule, policy version, reference, and calculation evidence.
11. Current historical DOE remains explainable.
12. One administrator can create the next year's Draft by copying the previous Active policy and reviewing only annual changes.
13. Published rules are immutable.
14. Production recalculation is explicit, previewed, audited, and resumable.
15. The UI visually matches the current VISTA / Faculty Dashboard style.
16. Research, Service, and PPVM are not given invented automatic formulas without an approved deterministic source.

---

## 23. Deployment Boundary

Design and implementation work do not authorize production deployment.

Separate explicit authorization is required for:

- Azure production deployment;
- Firebase production rules deployment;
- production data migration;
- production DOE recalculation;
- merging the implementation PR when its acceptance gate is reached.

PR #45 remains unmerged while this expanded DOE architecture is designed and planned.
