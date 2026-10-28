# PAWS Testing role and capability matrix

Scope: source main069914cdfa1c2fb0f844b0abdd278f5275bde8f4, inspected2026-10-28. This is an implementation map and acceptance contract, not a grant of permissions. Recheck the named code when a feature changes. [Environment map](../architecture/testing-environments.md) explains why the columns are separate.

## Identity and role normalization

| Stored role | Legacy browser helper | Ported API policy | Important boundary |
| --- | --- | --- | --- |
| owner / adfa_general | Owner / general admin | adfa_general; administrator + general | Scope-sensitive writes still require their feature check and gate. |
| administrator / admin / adfa_regular | Administrator | adfa_regular; administrator, not general | No automatic Owner account-management or policy-publication right. |
| developer | Developer; broad support/admin predicates | Developer; administrator + general | A supported privileged technical role, not a normal Faculty fixture. |
| hicc | HICC; faculty-facing | Self-service | Group/course ownership and endpoint scope still apply. |
| visc | VISC; faculty-facing | Self-service | An area label does not grant every area or all HICC rights. |
| faculty | Faculty | Self-service | Own authorized records only. |
| adc | ADC; officeAccess context | Office role | ADC approval fields only when explicitly authorized by that workflow. |
| lab | LAB; officeAccess context | Office role | LAB approval fields only; not a general administrator. |
| other_office | Recognized label; not admin/general | Unsupported by isSupportedRole | Deliberately fail-closed on ported APIs. Do not treat a label as permission. |
| editor / viewer | Legacy display maps to Faculty | Unsupported by normalizeBaseRole | Browser compatibility must not confer a backend capability. |
| inactive, missing, mustChangePassword, unlinked | Must pass readiness/link checks | Must pass each API identity/readiness check | Never grant access by fallback to a privileged fixture. |

Sources: [legacy helper](../../web/js/core/faculty-access.js) `role/admin/general/historyAll/ready`; [ported policy](../../server/src/auth/role-policy.js) `normalizeBaseRole/isSupportedRole/isAdministratorRole/isGeneralRole/isSelfServiceRole`; [Lab rules](../../firebase/firestore.rules) `readySignedIn/defaultOfficeAccess/hasOfficeAccess/restrictedOffice`.

## Ported PAWS API capability map

Legend: **Admin** = Developer, Owner, Administrator after normalization. **General** = Developer/Owner. **Scoped** means a feature-specific repository/identity decision is required. These are code paths reused by the Demo; its in-memory repositories are not a trusted backend.

| Capability | Admin | HICC / VISC / Faculty | ADC / LAB | Other Office / editor / viewer | Source / enforcement |
| --- | --- | --- | --- | --- | --- |
| Authorized timetable | Allowed after identity check | Allowed sanitized timetable | Endpoint-specific office policy; do not infer all detail | Refused by ported supported-role policy | `server/src/data/data-api.js`, role-policy.js |
| Faculty Dashboard / directory detail | Administrative projection | Own linked faculty projection | No blanket private-directory access | Refused | `server/src/data/dashboard-api.js` resolveScope / projections |
| Session create/edit / assignment replacement | Administrator predicate + feature gate + version checks | No admin right by role alone | Scoped request/approval route, not unrestricted edit | Refused | data-api.js; session repository; write gates |
| SWAP request/context/queue | Scoped workflow repository | Scoped requester/teaching ownership | Scoped office queue/decision | Refused unless a separately explicit contract exists | `server/src/swap/swap-api.js`, swap-domain.js, repository |
| SWAP DOE preview | Administrator only | Denied private DOE preview | Denied by administrator check | Denied | swap-api.js `previewDoe/capabilities` |
| DOE worksheet | Authorized API scope | Own authorized data only | No broad DOE right | Refused | `server/src/doe/doe-api.js` identity / adminOnly |
| DOE administration | Admin predicate and separate gates | Denied | Denied | Denied | doe-api.js |
| DOE policy publish/archive | General only and gate | Denied | Denied | Denied | doe-api.js `isGeneralRole` |
| Custom reports | Admin only; authorized sources/year | Denied | Denied | Denied | `server/src/reports/report-api.js` |
| AFC creation/cancellation/PDF | Each AFC API's actor, target, state and gate checks | Own request/originals where allowed | Only explicit review scope | No inferred right | `server/src/afc/` APIs; confidential artifacts |
| CCC / activities / trainees / appointments | Feature-specific admin scope | Authorized own/sanitized projections | Feature-specific; no role-wide inference | Fail closed | CCC/calendar/trainee/leadership APIs |
| History and export | Administrative year/source scope | Own authorized changes | Explicit workflow scope only | No blanket history right | `server/src/history/change-history-api.js` |
| Teaching-assignment draft/review/final/publish | Capability depends on package role, ownership and stage | Explicit package assignee scope | Explicit package office stage | No inferred right | `server/src/teaching-assignment/teaching-assignment-api.js` |

Read the specific endpoint and repository predicate before altering permissions. The table intentionally avoids assigning one global Yes to every admin operation.

## Firebase Lab: independent Firestore authority

Lab reads `/users/{uid}` for readiness and uses `firebase/firestore.rules` as the enforcement boundary. Browser helpers guide rendering only. Key current predicates:

| Lab operation | Required rule context | Source |
| --- | --- | --- |
| Own account read / mandatory password completion | Signed-in own UID and the exact permitted fields/state | `/users/{uid}`, `selfPasswordCompletion` |
| Account administration | General context plus valid linked faculty/role shape and self-protection | `generalUserCreate/generalUserUpdate` |
| Faculty directory / sanitized candidates | Specific `/faculty` versus derived directory rules; do not replace derived reads with broad faculty access | Faculty and derived collection matches |
| HICC collaboration group | Ownership/membership plus validated field changes | `/faculty_groups/{id}`, `hiccMemberUpdate` |
| Approval decision | `hasOfficeAccess(office)`, matching revision/fields/signature and valid atomic parent/audit transition | `validOfficeApprovalDecision`, `validRoutedOfficeRequestUpdate` |
| Private SWAP candidate details | ADFA-authorized paths only, separate from public request projection | Routed private request helpers / matches |
| DOE browser writes | Denied; a real trusted admin path must be provisioned separately | DOE collection matches and Lab DOE writer-off runtime |

Default offices: Developer ADC+LAB+ADFA; ADC only ADC; LAB only LAB; Owner/Administrator aliases ADFA; others none. An explicit valid officeAccess field changes that office set; role labels alone are insufficient. This is a Lab rule mapping, not a claim that the Demo or Beta has identical grants.

## Beta parity gaps to retain in acceptance

| Gap | Current Testing evidence | Required acceptance handling |
| --- | --- | --- |
| PR148 dated, SQL-authorized multi-role accounts | No `server/src/access/` subsystem in this baseline; current user-management is the older form | Mark dated multi-role/Owner preview+commit+history cases Blocked until ported and verified. Preserve Faculty plus separately dated505/Bovine scopes in intended fixtures; do not provision real people. |
| Protected Developer management / idempotent access receipts | Not established by the older browser account form | Demo success is not the Beta security contract. Backend lane required. |
| Real backend gates and transactions | Demo uses ALL_WRITES and browser-local repositories | Actual gates, ABA, concurrency, atomic audit, reset isolation and rollback require isolated backend acceptance. |
| Scoped office approval vs DVM sequence | Legacy Lab uses ADC/LAB/ADFA field routing; ported SWAP API has its own workflow | Follow the selected workflow. A required DVM stage cannot be replaced by relabeling ADC or ADFA. |
| Delivery / secure PDF persistence | Browser simulation can render a PDF or notification | Email receipt, durable authorized downloads and delivery retry require real integration evidence. |
| Legacy name/home parity | Legacy helper still redirects admins and some labels lack the shared formatter | Constitution is the target; execute the corresponding cases and record failures. |

For every role-related change, test allowed and denied operations using separate identities and years/scopes. Verify response payload privacy as well as controls. Use [manual acceptance IDs](../acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md); do not mark a mock-backed role test as real security signoff.
