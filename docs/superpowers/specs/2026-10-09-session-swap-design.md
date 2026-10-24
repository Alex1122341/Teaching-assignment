# Session SWAP and faculty names

Owner authorizes starting SWAP, using all recommended brainstorming decisions. This explicit preference supersedes repeated skill design/plan approval pauses. Current SQL authority and privacy remain binding.

## Intent and reference

Port the reference timetable's request/office routing behavior into the SQL Beta; never restore its Firestore business implementation. Reference inspected at https://alex1122341.github.io/Teaching-assignment/index.html and public shared-approval-request/timetable-approval bundles on 2026-10-09. Supplied PAWS Final Role Matrix defines office authority. Faculty self-service never directly edits the timetable.

## Scope

Session change request supports replacing a current instructor and proposing session course/date/start/end/type/room/topic changes. This release does not introduce a separate two-session exchange algorithm. Faculty self, scoped VISC, ADFAD, ADC/DVM and LAB can initiate. Existing HICC package workflow remains intact. Every selection uses canonical session/candidate identifiers; choices come from current SQL records. Missing candidates, scope/routing or fields are explicit, never guessed. Role/type choices use existing accepted values with an explicit unavailable option.

## Authority and routing

Server supplies initiation/edit/decision capabilities, not browser role claims. Faculty owns only their assignment suggestion. VISC may edit faculty suggestions within their existing responsibility group; ADFAD may revise/finalize. ADC/DVM owns course/date/time/type/room and non-LAB topic. LAB owns LAB topic; unsupported LAB group/roster fields visibly unavailable until real SQL schema supplies them. Wrong-office fields are visible disabled with reasons. Changes require relevant stages strictly ADC -> LAB -> ADFA. Pure faculty replacement requires ADFA; unnotified faculty suggestions first require a scoped VISC review.

Faculty may choose Notify replacement faculty. Notification means a durable in-app approval inbox item, not unsolicited email. Notified target must have an active linked account; otherwise notify is unavailable with explanation. Only the linked target may accept/reject. Target acceptance of pure replacement routes directly to ADFA, as owner explicitly requested. Mixed schedule changes retain required office stages. No response is never consent. Rejection/pushback/withdrawal remain audited. Changing target or relevant scope resets affected confirmations and approvals.

Owner/Developer may override with an explicit recorded reason; ADFA Regular cannot bypass routing/conflicts. No assigned-work grant elevates system authority. Missing VISC/office assignment blocks that route visibly rather than granting all-office access.

## Persistence and concurrency

Add independent SQL request/revision/decision/notification records, preserving TA packages. Snapshot canonical session and assignment facts; use expected revision, stale-session check and transaction when deciding/applying. Final approved application is atomic with request status and audit. Recheck incoming live timetable and binary AFC availability. Block unresolved identity, unknown schedule or conflict unless explicit Owner/Developer override with reason. Preserve untouched co-instructors and source DOE fields; moved teaching credit follows the affected assignment; no manual-role DOE changes or bulk recalculation. Course/type/time changes need source-aware DOE preview rather than copying incompatible rates.

## Privacy and identity

Faculty sees sanitized candidate key, preferred display name and binary availability plus public course/time conflicts. No other faculty UCID/email/HR/private DOE/AFC reason. UI names use PreferredFirstName/PreferredLastName when provided, fallback existing name with comma removed without reversing components. FacultyId remains immutable relational identity. Add separate HrName/HrNameSource only from authoritative evidence; do not equate current DisplayName or preferred name with HR identity. Preserve existing source aliases. Missing HR names stay null and are reported.

## Acceptance

Visible SWAP entry from session and own/reviewer inbox. Office-inappropriate fields grey; empty lists say none. Faculty cannot replace someone else's assignment, approve as an office, or access private directory. Target consent routes correctly; VISC/ADFAD revision is explicit and invalidates affected approvals. Serial stages, reject/pushback/withdraw, stale409 and atomic final apply enforced server-side. Display names no comma; IDs/source identity unchanged. Syntax/build/freeze and existing automatic CI; no added/local tests unless owner asks. Read-only live UI acceptance; no fabricated live request or policy mutation.
