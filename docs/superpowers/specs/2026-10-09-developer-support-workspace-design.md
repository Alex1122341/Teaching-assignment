# Developer support workspace

Owner authorizes real operations as other accounts, reversible testing and remote support, clearer UI and a persistent cross-week issue list. Owner delegates later design decisions to the implementer; no further design approval stops.

## Identity and recovery

Retain Firebase actor identity. Only an active canonical SQL developer may start a timed support context for an existing active SQL account; role selector filters accounts by their real role. Do not fabricate missing office accounts, change passwords or alter account roles to simulate access. The effective account determines existing API/SQL scope; the real developer and effective account are retained in support audit. A visible banner and Return to myself action persist across app pages. Context expires after30 minutes and requires a reason. Sensitive identity endpoints and credential/account administration are excluded from delegation.

Each delegated mutation executes inside an outer SQL transaction. An opt-in SESSION_CONTEXT operation identifier enables row before/after capture in reviewed paws business tables. AuditEvent and support audit are append-only. Unsupported SQL column/key types fail the mutation closed. Successful responses commit captured changes; unsuccessful responses roll back. Undo replays changes in reverse order in one transaction, checks complete current after-images with locks, refuses superseded data, and retains original audit. No email/credential/external side effects are supported. Context selection/ending is not a business-data undo.

Developer sees operation list with status and Undo. Undo never silently replays another person's edits. An expired context blocks rather than falling back to the developer's broader authority. Existing write gates still apply.

## Work area and tasks

Use UCVM red/gold with white surfaces, consistent readable type, spacing and restrained borders. Consolidate navigation and secondary actions. Advanced schedule filters collapse by default; selected filters remain understandable. Large operation forms group related fields and put action buttons together. Do not invent metrics or discard functionality.

A toggleable right task panel reads the whole authorized academic-year session collection independent of the displayed week/filter. Use existing canonical timing disposition to identify unpositioned/invalid/outside-grid sessions, including VETM571. Add scoped pending SWAP events where available. Items show course/date/reason and open the actual session or event; valid dates navigate to their week, invalid dates still open details. Data-derived tasks disappear only when source is corrected. Local UI preference controls open/closed state; no fabricated completion. Loading/error/empty states explicit. Mobile uses a closable drawer.

## Acceptance and release

No new/local test suites under developer instruction. Parse JS, build static/API, inspect browser, run existing automatic CI. Compile SQL in rolled-back diagnostic before persistent application. Promote immutable freezes in a separate governance commit, reviewed PR merge, exact-main CI, guarded University runtime release and Hosting-only deploy. Preserve current release and guarded recovery. Never fabricate live faculty consent or real approval records during verification.
