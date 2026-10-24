# P2A DOE Faculty Target Domain and API Foundation

## Goal
Add an empty, year-scoped DOE target domain to VetMed-Ops and a bounded read-only API foundation. The new domain must preserve the distinction between contract teaching DOE and historical/assigned DOE. No personal contract values are imported in this stage.

## Existing evidence
- VetMed-Ops currently has paws.DoeRuleSeed but no paws.DoeFacultyTarget table.
- The live Faculty table contains 120 rows; the current Session academic-year vocabulary is YYYY-YY (2026-27).
- The Azure Beta API runtime is frozen and its server/src tree is part of the immutable API trust anchor.
- The current runtime identity is not granted access to the new domain by this task.

## Data model
- paws.DoePolicyVersion stores version metadata only; no policy/source rows are created without an authoritative approved source.
- paws.DoeFacultyTarget stores one active row per FacultyId and AcademicYear, with an optional contract target, optional override, source/policy references, Active, and actor/timestamp metadata.
- EffectiveTargetDoe is a persisted computed value: OverrideDoe when present, otherwise ContractTeachingDoe. Null remains distinct from numeric zero.
- AcademicYear uses the existing canonical YYYY-YY rule and must span consecutive years.
- ContractTeachingDoe is nullable and receives no default or inferred value. This phase inserts no faculty target rows.
- A target references paws.Faculty and, when present, the policy version for the same academic year.
- An override requires a nonblank reason; override notes without an override are rejected.
- Revisions can be retained as inactive rows; a filtered unique index allows only one active row per faculty/year.

## API and authorization
- Add GET /api/v1/dashboard/doe-targets?academicYear=YYYY-YY.
- Reuse the current administrator-only Dashboard policy; self-service, inactive, password-change-required, and unsupported roles fail before repository access.
- Return only active target rows for the requested canonical academic year. No write route is added.
- The endpoint is code-only until the SQL runtime permission contract and release gate are explicitly completed. No database GRANT, service activation, merge, or deployment occurs in P2A.

## Audit
- The existing paws.AuditEvent is the audit store. P2A adds UpdatedBy/UpdatedAtUtc data columns but no write operation.
- P3 must route DOE inserts/updates through a transactional, least-privilege API path that writes the corresponding AuditEvent in the same transaction. No direct table write permission is added here.

## Migration and rollback
- Apply one transaction that creates only the two named tables and their keys, checks, and indexes.
- The rollback script drops only those exact new tables, in dependency order, and aborts if either table contains rows or has external dependents.
- SQL stays on ITAPPVETOPSDB01 / VetMed-Ops with integrated authentication and strict TLS. No certificate-validation bypass is allowed.

## Acceptance
- SQL DDL is syntax/structure verified before and after the live apply.
- Both tables exist, constraints and indexes match the migration, and both row counts are zero.
- ContractTeachingDoe has no default and no personal contract values have been inserted.
- API unit tests prove admin-only authorization, inactive/password-change denial, canonical-year behavior, parameterized read-only query, and safe SQL failure handling.
- Server and repository verification is run; the API freeze change is reviewed on a feature branch.
- No frontend file, Azure/Firebase setting, SQL permission, API service, or production release is changed.