# DOE Policy Engine and Admin Rule Registry Design

**Date:** 2026-09-18  
**Status:** Design approved in chat; written specification pending final user review  
**Scope:** Faculty Dashboard admin DOE rule management, policy versioning, safe formula support, calculation provenance, migration from existing 2026-27 DOE logic, and storage abstraction for future Azure SQL migration.

---

## 1. Purpose

The current UCVM DOE implementation mixes several sources and calculation paths:

- Timetable teaching assignments may use hard-coded DOE rates in application code.
- Faculty Dashboard workload breakdowns may use imported operational/workload data.
- Managed faculty roles may carry manually maintained DOE credits.
- Contract Teaching DOE and office overrides are handled separately.
- Historical source values are intentionally preserved when the provided Workload Guideline does not define a safe formula.

This design replaces that fragmentation with one storage-agnostic DOE subsystem:

1. **DOE Policy Registry** — stores academic-year policy versions, rules, parameters, exceptions, publication state, preview evidence, and audit records.
2. **DOE Policy Engine** — applies a selected policy version to plain domain inputs and returns a deterministic DOE calculation result.
3. **DOE Policy Repository** — isolates persistence so the current implementation can use Firestore and a future implementation can use Azure SQL without changing the engine or UI contracts.
4. **DOE Rules Admin UI** — lets authorized ADFA administrators maintain Draft policy versions without editing application code.
5. **DOE Calculation Provenance** — records which policy version, rule, inputs, and rule snapshot produced each persisted DOE result.

The design does **not** allow a future guideline change to silently rewrite historical DOE.

---

## 2. Confirmed Product Decisions

The following decisions are fixed for this design.

### 2.1 Policy versioning

DOE policy is versioned by **Academic Year + Policy Version**.

Examples:

- `2026-27 / v1`
- `2027-28 / v1`
- `2027-28 / v2`

Each policy version has one lifecycle state:

- `draft`
- `active`
- `archived`

A published version is immutable. Changes require cloning it into a new Draft version.

### 2.2 Rule editing model

The primary editor is a **Structured Rule Builder**, with calculation modes such as:

- Per Hour
- Fixed
- Per Shift
- Per Week
- Per Trainee
- Tiered
- Cap
- Minimum
- Percentage of Target
- Prorated

A rule may optionally switch to **Advanced Formula** mode.

Advanced Formula is a restricted expression language. It is **not JavaScript** and may never use `eval`, `Function`, DOM access, Firebase access, network access, dynamic imports, or arbitrary function invocation.

### 2.3 DOE scope

The registry covers the full DOE model:

- timetable teaching activity rules;
- role and appointment rules;
- supervision and trainee rules;
- complex/tiered/reserve/cap rules;
- target rules;
- Contract Teaching DOE logic;
- FTE/proration rules;
- office override rules and allowed reasons;
- Head-equivalent / adjustment logic where a supported rule is defined;
- policy exceptions and fixed operational values.

### 2.4 Draft and publish permissions

**ADFA General / Owner**

- create Draft;
- edit Draft;
- validate Draft;
- run Impact Preview;
- publish;
- archive;
- execute Recalculate.

**ADFA Regular**

- create Draft;
- edit Draft;
- validate Draft;
- run Impact Preview;
- cannot publish;
- cannot archive an Active version;
- cannot execute Recalculate.

Other roles do not receive DOE Rules administration access.

For compatibility with existing profile normalization:

- `UCVM.general(profile)` is the publication/recalculation capability gate.
- `UCVM.admin(profile)` is the Draft edit/preview capability gate.
- legacy administrative role names may remain readable through the existing normalization layer, but only the General capability may Publish/Recalculate.

Authorization must be enforced in both UI and Firestore Rules. Hidden buttons alone are not security.

### 2.5 Mandatory publication gate

Publish requires:

`Draft -> Validate -> Impact Preview -> Review -> Publish`

Impact Preview is mandatory.

Any change to the Draft after the successful preview invalidates the preview.

Publication remains blocked when there is:

- formula syntax failure;
- unknown variable;
- disallowed function/operator;
- missing required input;
- circular dependency;
- conflicting matching rules;
- ambiguous priority;
- no valid rule where a rule is required;
- non-finite output;
- invalid output range;
- stale Draft revision;
- stale Impact Preview.

### 2.6 Existing session policy upgrade behavior

A historical session keeps its stored DOE result and original policy version unless a DOE-relevant change occurs.

A **DOE-relevant change** recalculates using the current Active version for that session's Academic Year.

Examples of DOE-relevant fields include:

- teaching type;
- teaching role;
- duration;
- start/end when duration changes;
- credited hours;
- shifts;
- weeks;
- trainee/supervision quantities;
- FTE-related input used by that rule;
- any other input explicitly declared by the matched rule.

Non-DOE edits such as Room, free-text Topic, or Notes do not change DOE or policy version.

### 2.7 2026-27 migration strategy

All existing DOE enters the new system, but not all existing DOE is converted into an invented formula.

- Values with a safe, explicit rule become normal policy rules.
- Existing operational/prorated/source-reconciled values without a defensible general formula become **Policy Exceptions / Fixed Operational Credits**.
- The migration must preserve provenance and may not infer a rule merely because a numeric result exists.

---

## 3. Architectural Principle: Storage-Agnostic DOE

The DOE subsystem is divided into four layers:

```text
Faculty Dashboard / Timetable / DOE List / Impact Preview
                         |
                         v
                   DOE Policy Engine
                         |
                         v
                DOE Policy Repository
                  /               \
                 /                 \
   Firestore Repository       Future Azure SQL Repository
```

The Engine and UI must not know whether policy data came from Firestore or Azure SQL.

### 3.1 Repository boundary

Application code consumes repository methods and plain JavaScript domain objects.

It must not:

- construct Firestore document paths outside the Firestore repository;
- depend on Firestore `Timestamp` objects in the DOE Engine;
- use Firebase document IDs as business meaning;
- read DOE rule collections directly from Timetable or Faculty Dashboard;
- embed persistence-specific behavior inside formulas.

### 3.2 Portable identifiers

All DOE entities receive stable business IDs that survive storage migration.

Examples:

- `policyId = ucvm-workload-2027-28`
- `policyVersionId = ucvm-workload-2027-28-v2`
- `ruleKey = teaching.lecture.standard`

A Firestore document ID may equal a business ID for convenience, but consumers must rely on the domain field, not the document path.

### 3.3 Portable dates and timestamps

Repository adapters normalize persistence types.

The Engine receives:

- academic years as strings such as `2027-28`;
- dates as `YYYY-MM-DD`;
- timestamps as ISO-8601 strings when a timestamp is needed.

Firestore `Timestamp` conversion belongs to the repository boundary.

---

## 4. Logical Data Model

The logical model is relational-friendly from the beginning, even while Firestore is the physical store.

### 4.1 doe_policy

Represents the continuing policy family for an academic year.

Fields:

- `policyId`
- `academicYear`
- `name`
- `description`
- `currentActiveVersionId`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`

Example:

```text
policyId: ucvm-workload-2027-28
academicYear: 2027-28
name: UCVM Workload Policy 2027-28
currentActiveVersionId: ucvm-workload-2027-28-v2
```

### 4.2 doe_policy_version

Represents one immutable published version or editable Draft.

Fields:

- `policyVersionId`
- `policyId`
- `academicYear`
- `versionNumber`
- `status` = `draft | active | archived`
- `revision`
- `clonedFromVersionId`
- `guidelineTitle`
- `guidelineEffectiveDate`
- `sourceReference`
- `notes`
- `rulesChecksum`
- `lastValidatedRevision`
- `lastImpactRunId`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`
- `publishedAt`
- `publishedBy`
- `archivedAt`
- `archivedBy`

Draft `revision` increments on any rule, parameter, tier, target-rule, or exception change.

### 4.3 doe_rule

One reusable rule line.

Fields:

- `ruleId`
- `policyVersionId`
- `ruleKey`
- `category`
- `name`
- `description`
- `calculationMode`
- `formulaText`
- `resultKind`
- `priority`
- `enabled`
- `guidelineReference`
- `sourceType` = `guideline | operational | migration`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`

Categories include:

- `teaching`
- `role`
- `supervision`
- `target`
- `adjustment`

`resultKind` controls output validation:

- `credit` — normally non-negative DOE earned;
- `adjustment` — signed adjustment is allowed;
- `target` — annual target result.

### 4.4 doe_rule_selector

Selectors determine when a rule matches.

Keep selectors explicit rather than hiding matching logic inside formulas.

Fields:

- `selectorId`
- `ruleId`
- `field`
- `operator`
- `valueText`
- `valueNumber`
- `order`

Supported selector fields may include:

- `activityType`
- `teachingRole`
- `roleType`
- `course`
- `academicYear`
- `appointmentType`
- `stream`
- `facultyId` only where specifically supported
- `supervisionType`

Supported operators remain bounded:

- equals;
- not equals;
- in;
- not in;
- greater than / greater-or-equal;
- less than / less-or-equal.

Arbitrary JavaScript predicates are prohibited.

### 4.5 doe_rule_parameter

Stores structured values used by the rule.

Fields:

- `parameterId`
- `ruleId`
- `name`
- `valueNumber`
- `valueText`
- `unit`
- `required`
- `order`

Examples:

```text
name = rate
valueNumber = 0.30
unit = percent_per_hour
```

```text
name = cap
valueNumber = 4.00
unit = percent
```

### 4.6 doe_rule_tier

Used for structured tiered rules.

Fields:

- `tierId`
- `ruleId`
- `tierOrder`
- `fromValue`
- `toValue`
- `rate`
- `fixedCredit`
- `unit`

This avoids storing tier structures as one opaque Firestore-only nested object.

### 4.7 doe_rule_input

Declares runtime inputs allowed by a rule.

Fields:

- `ruleInputId`
- `ruleId`
- `inputName`
- `inputType`
- `required`
- `source`
- `unit`

Examples:

- `hours`
- `shifts`
- `weeks`
- `trainees`
- `residents`
- `graduateStudents`
- `fte`
- `contractTeachingDoe`
- `baseDoe`

The Engine rejects undeclared variables.

### 4.8 doe_exception

Represents a specific operational value that cannot safely be generalized.

Fields:

- `exceptionId`
- `policyVersionId`
- `facultyId`
- `category`
- `assignment`
- `scopeType`
- `scopeKey`
- `fixedDoe`
- `reason`
- `sourceReference`
- `effectiveStart`
- `effectiveEnd`
- `priority`
- `enabled`
- audit metadata

An exception must always include both:

- `reason`;
- `sourceReference`.

### 4.9 doe_impact_run

Header for one mandatory Draft simulation.

Fields:

- `impactRunId`
- `policyVersionId`
- `policyRevision`
- `policyChecksum`
- `inputDatasetChecksum`
- `status` = `running | passed | failed | stale`
- `facultyCount`
- `calculationCount`
- `changedFacultyCount`
- `largeIncreaseCount`
- `largeDecreaseCount`
- `errorCount`
- `warningCount`
- `startedAt`
- `completedAt`
- `runBy`

### 4.10 doe_impact_row

Stores Impact Preview detail without placing all rows into one large document.

Fields:

- `impactRowId`
- `impactRunId`
- `facultyId`
- `currentDoe`
- `draftDoe`
- `difference`
- `affectedRuleKeys`
- `warnings`
- `errors`

For Firestore, small arrays such as `affectedRuleKeys` are acceptable. The same domain model maps naturally to SQL child tables or JSON columns later.

### 4.11 doe_publication

Immutable publication evidence.

Fields:

- `publicationId`
- `policyVersionId`
- `policyRevision`
- `policyChecksum`
- `impactRunId`
- `inputDatasetChecksum`
- `publishedAt`
- `publishedBy`
- `publishedByName`
- `summary`

### 4.12 doe_calculation_record

Immutable evidence for an applied DOE calculation.

Fields:

- `calculationId`
- `academicYear`
- `policyVersionId`
- `ruleId`
- `ruleKey`
- `facultyId`
- `sessionId`
- `sourceEntityType`
- `sourceEntityId`
- `calculationType`
- `inputsSnapshot`
- `parametersSnapshot`
- `ruleSnapshot`
- `resultDoe`
- `calculatedAt`
- `calculatedBy`
- `trigger`
- `recalculationBatchId`

The snapshots are intentional immutable evidence. They may be stored as portable JSON structures because they represent historical state rather than relational master data.

### 4.13 doe_audit_log

Append-only configuration audit.

Fields:

- `auditId`
- `action`
- `entityType`
- `entityId`
- `policyVersionId`
- `beforeSnapshot`
- `afterSnapshot`
- `changedAt`
- `changedBy`
- `changedByName`
- `changedByEmail`

Audit actions include:

- draft_created;
- draft_cloned;
- rule_created;
- rule_updated;
- rule_deleted;
- parameter_updated;
- exception_created;
- exception_updated;
- validation_run;
- impact_preview_run;
- policy_published;
- policy_archived;
- recalculation_started;
- recalculation_completed.

---

## 5. Current Firestore Physical Model

The first implementation uses top-level Firestore collections matching the logical entities:

```text
doe_policies
doe_policy_versions
doe_rules
doe_rule_selectors
doe_rule_parameters
doe_rule_tiers
doe_rule_inputs
doe_exceptions
doe_impact_runs
doe_impact_rows
doe_publications
doe_calculation_records
doe_audit_log
```

The design intentionally avoids deeply nested subcollections that would make future relational migration harder.

References are stored as stable foreign-key fields such as:

- `policyId`
- `policyVersionId`
- `ruleId`
- `facultyId`
- `sessionId`

### 5.1 Firestore constraints

The project currently runs without Cloud Functions, so the first implementation is client-driven.

Firestore Rules must enforce:

- only Admin-capable users can read Draft policy management data;
- ADFA Regular/Admin capability may create/update/delete rule data only while the parent version is Draft;
- only General capability may change a version to Active;
- only General capability may archive an Active policy;
- published/archived rule data is immutable;
- only General capability may run administrative Recalculate writes;
- audit/publication records are append-only;
- Faculty/HICC/VISC/ADC/LAB accounts cannot write DOE policy configuration.

The rules can enforce authorization and state transitions, but they cannot independently prove that a formula result or Impact Preview checksum is mathematically correct. That limitation is accepted for the current trusted-admin/Spark architecture and should be eliminated when a trusted Azure API becomes available.

---

## 6. Future Azure SQL Mapping

The same logical entities map to SQL tables such as:

```text
DoePolicies
DoePolicyVersions
DoeRules
DoeRuleSelectors
DoeRuleParameters
DoeRuleTiers
DoeRuleInputs
DoeExceptions
DoeImpactRuns
DoeImpactRows
DoePublications
DoeCalculationRecords
DoeAuditLogs
```

Relationships use normal PK/FK columns.

Examples:

- `DoePolicyVersions.PolicyId -> DoePolicies.PolicyId`
- `DoeRules.PolicyVersionId -> DoePolicyVersions.PolicyVersionId`
- `DoeRuleParameters.RuleId -> DoeRules.RuleId`
- `DoeExceptions.PolicyVersionId -> DoePolicyVersions.PolicyVersionId`
- `DoeImpactRows.ImpactRunId -> DoeImpactRuns.ImpactRunId`

### 6.1 Azure migration boundary

Future migration should require:

1. export Firestore DOE entities into repository-domain objects;
2. load them into Azure SQL;
3. implement `AzureSqlDoePolicyRepository`;
4. run repository contract tests;
5. point the application service/API at the SQL-backed repository.

The Policy Engine, formula parser, rule semantics, UI behavior, policy IDs, version IDs, and calculation provenance must not need redesign.

---

## 7. Repository Contract

The repository interface should remain persistence-neutral.

Representative methods:

```text
listPolicies()
getPolicy(policyId)
listVersions(policyId)
getVersion(policyVersionId)

listRules(policyVersionId)
getRule(ruleId)
saveDraftRule(rule)
deleteDraftRule(ruleId)

listSelectors(ruleId)
saveSelector(selector)

listParameters(ruleId)
saveParameter(parameter)

listTiers(ruleId)
saveTier(tier)

listRuleInputs(ruleId)
saveRuleInput(input)

listExceptions(policyVersionId)
saveException(exception)
deleteException(exceptionId)

createDraftFromVersion(sourceVersionId)
incrementDraftRevision(policyVersionId)

saveValidationResult(...)
createImpactRun(...)
saveImpactRows(...)
getImpactRun(impactRunId)

publishVersion(...)
archiveVersion(...)

appendAudit(...)
createCalculationRecord(...)
listCalculationRecords(...)
```

The UI may call a higher-level service that composes repository methods, but it must not use Firestore paths directly.

---

## 8. DOE Policy Engine

The Engine is a pure domain module.

Inputs are plain objects; outputs are plain objects.

The Engine does not:

- render UI;
- call Firestore;
- call Azure;
- inspect DOM;
- perform network requests;
- use current user permissions.

### 8.1 Primary interfaces

Representative API:

```text
validatePolicy(policyBundle)
matchRule(policyBundle, calculationContext)
calculate(policyBundle, calculationContext)
calculateFaculty(policyBundle, facultyContext)
simulate(policyBundle, dataset)
isDoeRelevantChange(before, after, ruleInputs)
```

### 8.2 Calculation context

A calculation context contains only explicit domain inputs.

Example:

```json
{
  "academicYear": "2027-28",
  "facultyId": "10001234",
  "sourceEntityType": "session_assignment",
  "sessionId": "session-123",
  "activityType": "LEC",
  "teachingRole": "Lecture",
  "hours": 6,
  "fte": 1
}
```

### 8.3 Rule precedence

The Engine applies this order:

1. exact enabled Policy Exception, if one matches;
2. enabled normal rules matching selectors;
3. highest explicit priority;
4. if more than one rule remains at the same effective priority, return a validation/calculation error;
5. if no required rule matches, return a missing-rule error.

The Engine never chooses an arbitrary matching rule by array order.

### 8.4 No silent zero

Missing or invalid DOE input never silently becomes zero.

Examples:

- missing `hours` for a Per Hour rule -> error;
- formula references undeclared `trainees` -> validation error;
- division by zero -> error;
- no applicable rule -> error.

A real numeric zero must be an explicit valid calculation result.

---

## 9. Structured Rule Builder

Structured Builder is the default Rule Editor mode.

### 9.1 Calculation modes

Initial supported modes:

- `fixed`
- `per_hour`
- `per_shift`
- `per_week`
- `per_trainee`
- `tiered`
- `minimum`
- `capped`
- `percentage_of_target`
- `prorated`

Structured rules compile into the same internal expression AST used by Advanced Formula.

Examples:

**Per Hour**

```text
input: hours
parameter: rate = 0.30
expression: hours * rate
```

**Capped Per Trainee**

```text
input: trainees
parameter: rate = 0.50
parameter: cap = 4.00
expression: min(trainees * rate, cap)
```

### 9.2 Rule Editor fields

The editor includes:

- Rule ID / Rule Key;
- Name;
- Category;
- Applies To selectors;
- Calculation Mode;
- Parameters;
- Allowed Inputs;
- Tiers where relevant;
- Minimum / Maximum;
- Guideline Reference;
- Source Type;
- Description / Notes;
- Enabled state;
- Priority;
- Advanced Formula toggle.

---

## 10. Advanced Formula Language

Advanced Formula is a restricted deterministic DSL.

### 10.1 Allowed syntax

Allowed:

- numeric literals;
- declared runtime inputs;
- declared rule parameters;
- parentheses;
- arithmetic: `+ - * /`;
- comparisons: `< <= > >= == !=`;
- boolean expressions where required;
- ternary conditional `condition ? a : b`;
- safe functions:
  - `min`
  - `max`
  - `round`
  - `floor`
  - `ceil`
  - `abs`

Additional functions require a future policy-engine version and tests before becoming available.

### 10.2 Prohibited syntax

Never permit:

- property access;
- array indexing;
- assignment;
- loops;
- object creation;
- function declaration;
- arbitrary function call;
- string execution;
- imports;
- browser globals;
- Firebase globals;
- network operations.

### 10.3 Parser requirement

The implementation must parse to an AST and evaluate from a whitelist.

It must not execute the formula as JavaScript.

### 10.4 Validation

A formula is invalid when:

- parsing fails;
- an identifier is neither a declared input nor a rule parameter;
- an unapproved function appears;
- output is non-finite;
- output violates the rule's `resultKind`;
- required inputs are missing.

---

## 11. Faculty Dashboard DOE Rules UI

Add a new top-level **DOE Rules** tab to the Faculty Dashboard admin view.

It is not visible in Faculty self-service mode or to HICC/VISC/ADC/LAB accounts.

### 11.1 Policy header

Top control bar:

```text
Academic Year [2027-28]
Policy Version [v2]
Status [DRAFT]
```

Actions:

- New Policy Year
- Clone as Draft
- Validate
- Impact Preview
- Publish
- Archive
- Recalculate

Buttons are capability-aware.

ADFA Regular sees Publish/Archive/Recalculate disabled or absent with a clear permission explanation.

### 11.2 Secondary sections

The DOE Rules view contains:

1. **Teaching Rules**
2. **Role Rules**
3. **Supervision & Complex**
4. **Target Rules**
5. **Exceptions**

### 11.3 Rule table

Core columns:

```text
Rule ID
Name
Applies To
Calculation Mode
Rate / Parameters
Cap
Formula
Guideline Reference
Effective Status
Actions
```

### 11.4 Rule Editor

A row opens a focused Rule Editor rather than turning the entire table into an uncontrolled spreadsheet.

The editor provides:

- Structured Builder;
- Advanced Formula mode;
- selector editor;
- parameters;
- allowed inputs;
- source/guideline reference;
- test values;
- live test result.

### 11.5 Test Rule panel

Example:

```text
hours = 6
rate = 0.30

Result = 1.80% DOE
```

Missing input example:

```text
Cannot calculate
Missing required input: trainees
```

The Test Rule panel is local simulation only and does not persist DOE results.

---

## 12. Exceptions UI

Exceptions have their own table and editor.

Columns:

```text
Faculty / Scope
Academic Year
Category
Assignment
Fixed DOE
Reason
Source
Policy Version
Effective Dates
Status
Actions
```

An Exception cannot be saved without:

- fixed DOE value;
- reason;
- source reference;
- policy version;
- a defined matching scope.

Exceptions have higher calculation precedence than generic rules but remain visible as exceptions in result provenance.

---

## 13. Validation and Mandatory Impact Preview

### 13.1 Validation

Validation examines the whole Draft policy, not only the currently edited row.

It checks:

- duplicate `ruleKey`;
- invalid selectors;
- invalid parameter names;
- missing required parameters;
- undeclared formula variables;
- invalid formulas;
- unsafe formula syntax;
- duplicate/ambiguous matching rules;
- invalid priority;
- tier gaps/overlaps when the rule requires continuous tiers;
- invalid exception scope;
- missing exception source/reason;
- circular dependencies;
- invalid target rule outputs.

Validation records:

- policyVersionId;
- revision;
- checksum;
- result;
- errors/warnings;
- actor/time.

### 13.2 Impact Preview

Impact Preview evaluates the Draft against current relevant Faculty and Timetable data without writing production DOE values.

Header summary includes:

```text
Faculty checked
Calculations checked
Faculty changed
Increase > configured review threshold
Decrease > configured review threshold
Formula errors
Missing input errors
Rule conflicts
Warnings
```

Detail rows include:

```text
Faculty
Current DOE
Draft DOE
Difference
Affected Rules
Warnings / Errors
```

### 13.3 Preview freshness

A preview is publishable only when all of the following still match:

- `policyVersionId`;
- `policyRevision`;
- `policyChecksum`;
- `inputDatasetChecksum`.

Changing the Draft invalidates the preview.

Relevant Faculty/Timetable source changes also invalidate the preview when they change the dataset checksum.

### 13.4 Publish hard gate

Publish requires:

- caller has General capability;
- version is Draft;
- current revision has passed validation;
- latest Impact Preview is `passed`;
- no blocking preview errors;
- preview policy checksum matches current policy checksum;
- preview dataset checksum is current;
- no concurrent publication changed the Active version after preview.

Publication updates the Active version pointer and writes publication/audit evidence atomically where Firestore transaction semantics allow.

---

## 14. Policy Immutability and Version Lifecycle

### 14.1 Active version

An Active version is read-only.

To change it:

```text
Active v1 -> Clone as Draft -> Draft v2 -> Validate -> Preview -> Publish v2
```

### 14.2 Archive

Archive does not delete calculation history.

Archived versions remain readable for historical explanation.

### 14.3 One Active version per academic year

The repository/service must maintain at most one Active policy version for one policy year.

Publishing v2 makes v2 Active and transitions the prior Active version to Archived in the same publication operation.

---

## 15. Session Calculation and Policy Binding

### 15.1 New session or assignment

For a new DOE-bearing assignment:

1. determine Academic Year;
2. load the current Active policy for that year;
3. build the calculation context;
4. match a rule/exception;
5. calculate;
6. persist the numeric `doeCredit`;
7. persist lightweight provenance on the assignment;
8. append an immutable `doe_calculation_record`.

A session read does not dynamically recalculate historical DOE.

### 15.2 Lightweight assignment provenance

A timetable assignment may retain fields such as:

```json
{
  "doeCredit": 1.8,
  "doePolicyVersionId": "ucvm-workload-2027-28-v2",
  "doeRuleId": "rule-...",
  "doeRuleKey": "teaching.lecture.standard",
  "doeCalculationId": "calc-..."
}
```

Existing `doeCredit` remains the convenient aggregation field.

### 15.3 DOE-relevant edits

Before saving an edited session/assignment:

- compare relevant calculation inputs;
- if no relevant input changed, retain the stored DOE and original policy reference;
- if a relevant input changed, calculate with the Academic Year's current Active version;
- save the new DOE and provenance;
- append a new calculation record;
- audit old/new policy version and old/new DOE.

### 15.4 Non-DOE edits

Changes such as Room or free-text Topic do not trigger DOE policy upgrade unless a specific rule explicitly declares that field as an input.

---

## 16. Faculty-Level DOE Aggregation

The new architecture separates three concepts.

### 16.1 Earned / Assigned DOE

Sum of applicable teaching, role, supervision, exception, and adjustment calculation records for the academic year.

### 16.2 Target DOE

Calculated or sourced annual target using Target Rules:

- Contract Teaching DOE;
- FTE/proration;
- Office Override where approved.

### 16.3 Remaining / Overage

```text
Remaining / Overage = Effective Target DOE - Assigned DOE
```

The UI must show provenance for both sides rather than collapsing them into one unexplained number.

---

## 17. Target Rules and Overrides

Target Rules are visually separated from earned-credit rules.

They cover:

- Contract Teaching DOE interpretation;
- FTE/proration where applicable;
- approved target override behavior;
- allowed override reasons.

Existing override semantics remain:

- valid override replaces Contract Teaching DOE for effective target comparison;
- it does not erase the original contract value.

Initial allowed reasons may preserve the current list:

- RSL
- Mat Leave
- Sick Leave
- Special Event
- Other

The policy may version this list in future rather than hard-coding it forever.

---

## 18. Recalculate Workflow

Recalculate is a distinct General-only administrative operation.

It is never triggered by Publish alone.

### 18.1 Dry run first

Before execution show:

```text
Faculty affected
Session assignments affected
Role/supervision records affected
Old policy versions
New Active policy version
Changed DOE count
Errors
Warnings
```

### 18.2 Execution

General explicitly confirms:

```text
Recalculate <Academic Year> using <Active Version>
```

The operation:

- recalculates DOE-bearing records in the selected scope;
- writes new calculation records;
- updates persisted numeric DOE/provenance;
- records `recalculationBatchId`;
- writes audit summary;
- updates derived indexes only after the canonical data writes succeed.

### 18.3 Failure/resume

Recalculate must support chunked progress and resume.

It may not silently restart from row zero after a partial successful batch.

This should follow the project's existing resumable batch patterns.

---

## 19. 2026-27 Migration

Migration is explicitly designed to avoid behavioral surprises.

### 19.1 Inventory

Identify every current DOE source, including:

- Timetable hard-coded teaching rates;
- existing assignment `doeRate` / `doeCredit`;
- Faculty summary assigned DOE;
- source non-timetable DOE;
- workload-policy structured credits;
- managed role DOE;
- trainee/supervision data;
- operational/prorated values;
- Contract DOE;
- Override DOE.

### 19.2 Seed 2026-27 v1

Create a Draft `2026-27 v1`.

Known explicit timetable rules include the existing application values:

- Lecture: 0.30% per credited hour;
- SRL: 0.30% per credited hour;
- Lab Lead / Lab Primary: 0.21% per credited hour;
- Lab Support / Lab Secondary: 0.19% per credited hour.

These are migration inputs from the existing application behavior, not a claim that every value is explicitly stated in the Workload Guideline.

Role/supervision values are converted to normal rules only when the source supports a defensible general calculation.

### 19.3 Create exceptions for non-generalizable values

Operational/prorated/source-reconciled values without a safe formula become Exceptions.

Example:

```text
Academic Year: 2026-27
Faculty: <faculty>
Category: HICC
Assignment: <assignment>
Fixed DOE: 3.50%
Reason: Existing prorated operational value
Source: Teaching Assignments 2026 27 MASTER.xlsx
```

### 19.4 Shadow parity

Before switching canonical calculation:

- run the new Engine in shadow mode;
- compare old result vs new result;
- classify differences;
- require all unexplained migration differences to be resolved.

Target migration tolerance for ordinary numeric parity is `0.01%`.

Intentional differences require a documented General-approved reason rather than silent acceptance.

### 19.5 Cutover stages

Recommended rollout:

1. add Policy Registry + Engine without changing current calculation writes;
2. seed 2026-27 v1;
3. run validation and parity Impact Preview;
4. switch new/DOE-relevant Timetable writes to the Engine;
5. switch Faculty Dashboard DOE aggregation/provenance views;
6. switch derived index maintenance to canonical calculated values;
7. remove hard-coded `doeRateForRole()` and equivalent duplicated DOE algorithms only after parity is verified.

---

## 20. Current Hard-Coded Logic to Retire

The implementation must inventory and eliminate duplicated DOE calculation logic once the Engine is authoritative.

Known examples include Timetable logic equivalent to:

```text
Lecture       0.30
SRL           0.30
Lab Lead      0.21
Lab Primary   0.21
Lab Support   0.19
Lab Secondary 0.19
```

The final design does not permit Timetable to own a private DOE rate map.

Faculty Dashboard, Timetable, DOE List, Impact Preview, Recalculate, and derived indexes must all use the same canonical calculation/provenance service.

---

## 21. Error Model

The Engine/service should return typed errors rather than generic strings.

Representative codes:

- `POLICY_NOT_FOUND`
- `ACTIVE_POLICY_NOT_FOUND`
- `RULE_NOT_FOUND`
- `RULE_AMBIGUOUS`
- `INPUT_MISSING`
- `INPUT_INVALID`
- `FORMULA_PARSE_ERROR`
- `FORMULA_IDENTIFIER_NOT_ALLOWED`
- `FORMULA_FUNCTION_NOT_ALLOWED`
- `FORMULA_DIVIDE_BY_ZERO`
- `OUTPUT_NON_FINITE`
- `OUTPUT_OUT_OF_RANGE`
- `EXCEPTION_INVALID`
- `VALIDATION_FAILED`
- `PREVIEW_REQUIRED`
- `PREVIEW_STALE`
- `POLICY_REVISION_CONFLICT`
- `PERMISSION_DENIED`

### 21.1 Fail closed

A DOE-relevant save that requires a calculation but cannot produce one must not quietly save `0`.

The UI must show the specific calculation problem and preserve the user's unsaved form where practical.

---

## 22. Audit and Explainability

Every calculated DOE displayed to Admin should be explainable.

Example detail:

```text
DOE Credit: 1.80%
Academic Year: 2027-28
Policy: v2
Rule: teaching.lecture.standard
Calculation mode: Per Hour

Inputs
hours = 6

Parameters
rate = 0.30

Result
6 x 0.30 = 1.80%

Calculated at: ...
Triggered by: session DOE-relevant edit
```

Historical display uses the stored calculation snapshot, not today's rule definition.

---

## 23. Impact Thresholds

Impact Preview should distinguish blocking errors from review-only variance.

Blocking:

- formula/calculation errors;
- missing inputs;
- rule ambiguity;
- stale preview;
- invalid exceptions;
- non-finite outputs.

Review warnings:

- DOE change exceeds a configurable review threshold;
- large Faculty total increase/decrease;
- unusually high target/credit;
- exception count increase;
- migration parity difference.

The initial UI may use a practical default threshold such as 5 percentage points for prominent review, but this threshold is not a DOE formula and may later become a settings value.

---

## 24. Concurrency

Draft edits use optimistic revision control.

Every Draft save includes the revision the editor loaded.

If another administrator changed the Draft first:

- reject the stale save;
- show that the Draft changed;
- reload current values;
- do not silently overwrite the other administrator.

Impact Preview stores the exact revision/checksum it evaluated.

Publish requires the same revision.

---

## 25. Security Model

### 25.1 Read

DOE management configuration:

- General: read;
- Regular Admin: read;
- non-admin: no DOE Rules management read.

Calculated DOE values that are already part of authorized Faculty/Timetable views continue to follow those views' existing access rules.

### 25.2 Draft writes

Allowed to Admin capability only when the parent policy version is Draft.

### 25.3 Publish/archive

Allowed only to General capability.

### 25.4 Recalculate

Allowed only to General capability.

### 25.5 Immutable evidence

Publication records and calculation records are append-only.

Published rule definitions may not be modified in place.

### 25.6 Firestore Rules tests

Emulator tests must verify at minimum:

- ADFA Regular can edit Draft;
- ADFA Regular cannot Publish;
- ADFA Regular cannot Recalculate;
- ADFA General can Publish after permitted state transition;
- Faculty/HICC/VISC/ADC/LAB cannot modify DOE configuration;
- Active rule data is immutable;
- archived rule data is immutable;
- append-only evidence cannot be rewritten.

---

## 26. Testing Strategy

### 26.1 Pure Engine tests

Test:

- rule matching;
- priority;
- exception precedence;
- structured calculation modes;
- formula parser;
- formula evaluation;
- missing input behavior;
- numeric validation;
- target rules;
- DOE-relevant field detection;
- historical snapshot explainability.

### 26.2 Formula security tests

Explicitly reject:

- property traversal;
- browser globals;
- Firebase globals;
- arbitrary functions;
- assignment;
- code injection strings;
- loops;
- constructor access;
- prototype access.

### 26.3 Repository contract tests

Create one repository contract suite that the Firestore adapter must pass.

The future Azure SQL adapter must pass the same contract.

### 26.4 Firestore Emulator tests

Verify permissions and lifecycle transitions.

### 26.5 UI tests

Verify:

- DOE Rules tab visibility;
- General vs Regular controls;
- Draft editing;
- Active read-only state;
- Structured Builder;
- Advanced Formula;
- Test Rule;
- validation result;
- Impact Preview;
- stale preview lock;
- Publish lock;
- Exceptions editor;
- Recalculate dry-run.

### 26.6 Migration parity tests

Use representative 2026-27 fixtures to prove:

- current timetable rates reproduce existing credits;
- source exceptions preserve operational values;
- Faculty total parity is within `0.01%` unless explicitly documented.

### 26.7 Integration tests

Verify the same Engine result is used by:

- Timetable session create/edit;
- Faculty Dashboard DOE detail;
- DOE List;
- derived index calculation;
- Impact Preview;
- Recalculate.

---

## 27. Files and Module Boundaries

The implementation should favor focused modules rather than expanding the existing large `faculty-admin.js` and `timetable.js` further.

Expected new modules may include:

```text
doe-policy-engine.js
doe-formula.js
doe-policy-repository.js
doe-policy-firestore.js
doe-policy-service.js
doe-policy-admin.js
doe-policy-admin.css
doe-migration-2026-27.js
```

Exact filenames may be refined during implementation planning, but responsibilities must remain separated.

### 27.1 Existing module relationship

`faculty-doe.js` currently owns canonical target/override helpers.

During migration it should either:

- become a thin compatibility facade over the new Engine; or
- have its target logic moved into the Engine and retain only backwards-compatible exports.

Do not keep two independent target algorithms.

---

## 28. Out of Scope for the First Implementation

The following are intentionally not required for the first phase:

- building the Azure SQL backend now;
- Azure API authentication now;
- Cloud Functions;
- arbitrary user-authored JavaScript;
- natural-language-to-formula generation;
- automated interpretation of future guideline PDFs;
- automatic policy publication;
- silent historical recalculation;
- deleting legacy workload source fields immediately after cutover.

The first implementation must make future Azure SQL migration straightforward without requiring Azure to exist today.

---

## 29. Acceptance Criteria

The architecture is considered implemented when all of the following are true:

1. Faculty Dashboard Admin View contains a DOE Rules tab.
2. DOE rules are stored outside application code and versioned by Academic Year + Policy Version.
3. ADFA Regular can edit Draft but cannot Publish/Recalculate.
4. ADFA General/Owner can Publish/Recalculate.
5. Structured Builder and safe Advanced Formula are both supported.
6. No arbitrary JavaScript formula execution is possible.
7. Publish requires successful current Validation + Impact Preview.
8. Draft edits invalidate the previous Preview.
9. Active versions are immutable.
10. New DOE-bearing session calculations record policy/rule provenance.
11. Non-DOE session edits do not upgrade historical policy version.
12. DOE-relevant edits use the current Active version for that Academic Year.
13. Historical DOE remains explainable from stored calculation snapshots.
14. Existing operational values that cannot be safely generalized migrate as Exceptions.
15. 2026-27 migration parity is measured and unresolved differences are not hidden.
16. Timetable no longer owns private hard-coded DOE rates after cutover.
17. Faculty Dashboard, DOE List, Timetable, Impact Preview, Recalculate, and derived indexes consume the same Engine.
18. Firestore Rules enforce Draft vs Publish/Recalculate permissions.
19. The Firestore implementation follows the repository contract.
20. The domain model maps cleanly to a future Azure SQL schema without redesigning the Engine/UI.

---

## 30. Implementation Safety Gates

Implementation must follow the existing project workflow:

```text
feature branch
-> TDD
-> Test CI
-> Firestore/Auth Emulator
-> GitHub Pages test site
-> manual browser acceptance
-> explicit merge approval
-> merge main
-> main verification/build
-> separate Azure Production approval
```

No production deployment is authorized by approval of this design alone.
