# Workstream 4 Design — Derived Index Verification & Rebuild

**Date:** 2026-09-16  
**Repository:** `Alex1122341/Teaching-assignment`  
**Status:** Design approved in chat; implementation not started

## 1. Purpose

Workstream 4 makes the four Firestore derived-index documents verifiable and safely repairable instead of assuming that a successful write means the indexes are correct.

The four documents are:

- `settings/faculty_index`
- `settings/schedule_stats`
- `settings/faculty_swap_index`
- `settings/faculty_swap_map`

The target lifecycle is:

```text
Faculty + Sessions
        ↓
Canonical expected indexes
        ↓
Read current Firestore indexes
        ↓
Detailed comparison
        ↓
HEALTHY / MISMATCH / CRITICAL
        ↓
Atomic repair when safe
        ↓
Full verification again
```

This also closes the provisional derived-index verification gap left intentionally by Workstream 3.

## 2. Current State

`index-maintenance.js` already has canonical builders for `faculty_index` and `schedule_stats`, and `verifyDerivedIndexesProvisional()` checks those documents against current Faculty + Session data.

The provisional verifier is weaker for swap indexes. It currently checks that `faculty_swap_index` and `faculty_swap_map` exist, that `entries` are arrays, and that the two arrays have the same size. It does not prove that the swap content matches current faculty data.

`writeDerivedIndexes()` currently writes the four documents using independent `.set()` calls under `Promise.all()`. A partial failure can therefore leave only some derived documents refreshed.

Workstream 3 currently injects:

```text
rebuildIndexes → writeDerivedIndexes(...)
verifyIndexes  → verifyDerivedIndexesProvisional(...)
```

into the bulk-import controller. Workstream 4 replaces that provisional final gate with the full verifier defined here.

## 3. Scope

### In scope

- One canonical expected-index build path for all four derived documents.
- Detailed read-only verification with field-level diffs.
- `HEALTHY`, `MISMATCH`, and `CRITICAL` outcomes.
- Safe preservation of existing opaque swap candidate keys.
- Atomic four-document full rebuild with one Firestore WriteBatch.
- Mandatory post-rebuild verification.
- Faculty Dashboard UI for Verify and Manual Rebuild.
- Workstream 3 integration for preflight and final verification.
- Unit tests and Firebase Emulator deliberate-corruption tests.

### Out of scope

- Removing derived indexes and computing everything live.
- Changing scheduling/time logic; that belongs to Workstream 5.
- Full audit-contract redesign; that belongs to Workstream 6.
- Replacing the existing role vocabulary.
- Introducing Cloud Functions or another server runtime.
- Auto-repairing ambiguous swap identity ownership.

## 4. Chosen Architecture

The approved approach is **Canonical Build + Detailed Verify + Atomic Rebuild + Reverify**.

The primary API in `index-maintenance.js` will become conceptually:

```text
buildExpectedDerivedIndexes(...)
verifyDerivedIndexes(...)
rebuildDerivedIndexes(...)
```

Existing incremental index maintenance remains available for normal timetable edits. Workstream 4 does not replace every incremental write with a full rebuild.

### 4.1 Canonical expected-index build

The builder accepts current source-of-truth data:

```text
faculty
sessions
existing faculty_swap_map
```

and produces the expected derived state plus swap-identity diagnostics.

`faculty_index` and `schedule_stats` are fully derived from Faculty + Sessions.

The swap documents require additional care because `faculty_swap_map` contains opaque keys whose ownership must remain stable across rebuilds.

### 4.2 Swap identity rules

For each current faculty record:

- If a valid, unambiguous private-map key already exists, preserve it exactly.
- If the faculty member is genuinely new and has never had a key, mark the missing mapping as a repairable mismatch; a rebuild may generate one new key.
- If a faculty member is deleted/inactive and leaves a stale derived mapping, the rebuild may remove the stale mapping.
- Rebuild the public swap entry from canonical faculty data while retaining the preserved private key.

Verification must not generate random keys merely to compare expected state. New-key generation happens only inside the rebuild path. After rebuild, the full verifier runs again using the newly persisted map.

If both swap documents are absent/empty and there are no old opaque identities to preserve, a fresh rebuild is repairable. If old public keys exist but private ownership cannot be reconstructed safely, the condition is critical.

## 5. Verification Model

`verifyDerivedIndexes()` is strictly read-only.

It must:

1. Read the four current Firestore index documents.
2. Build canonical expected state from current Faculty + Sessions.
3. Normalize non-semantic metadata and document-specific ordering.
4. Compare expected and actual business content.
5. Analyze swap-key ownership safety.
6. Return a structured report.

A representative result shape is:

```js
{
  ok: false,
  severity: 'mismatch',
  checkedAt: '...',
  counts: {
    faculty: 118,
    sessions: 2436
  },
  documents: {
    faculty_index: 'healthy',
    schedule_stats: 'mismatch',
    faculty_swap_index: 'healthy',
    faculty_swap_map: 'healthy'
  },
  mismatchCount: 1,
  mismatches: [
    {
      document: 'schedule_stats',
      path: 'courseCounts.505',
      expected: 42,
      actual: 41,
      severity: 'mismatch'
    }
  ]
}
```

### 5.1 Generation metadata

These fields do not create a mismatch by themselves:

- `generatedAt`
- `generatedBy`
- `generatedByName`

Document-specific normalizers may also sort arrays by stable identity fields where array order is not semantically meaningful. Verification compares business meaning, not incidental object-key order or generation timestamps.

### 5.2 Missing and invalid documents

A missing document is a mismatch, not a generic exception. Example:

```text
faculty_swap_map
Issue: Document missing
```

Malformed expected structures are also reported explicitly, for example `entries` being a string instead of an array.

### 5.3 Diff limits

The verifier counts all detected mismatches but returns/displays only the first 50 detailed diffs by default.

Example:

```text
50 mismatches shown
143 additional mismatches not shown
```

This prevents a badly damaged index from creating an unusable UI while preserving the true total mismatch count.

## 6. Severity Rules

### 6.1 HEALTHY

All four derived documents match canonical current data and swap identity ownership is unambiguous.

### 6.2 MISMATCH — automatically repairable

Examples include:

- missing `faculty_index`;
- wrong faculty session count;
- wrong `schedule_stats.courseCounts` value;
- missing `schedule_stats`;
- stale public swap display name or aliases;
- stale AFC unavailable ranges;
- missing public swap entry when private ownership is known;
- a genuinely new faculty member with no prior key;
- stale derived mapping for a removed/inactive faculty member;
- both swap documents absent when no old opaque identity needs preservation.

A Manual Rebuild may repair these conditions.

### 6.3 CRITICAL — automatic rebuild blocked

Critical means old opaque-key ownership cannot be proven safely. Examples include:

- one private opaque key assigned to multiple faculty members;
- one faculty member assigned conflicting private opaque keys;
- empty/invalid private identity keys where an old identity is expected;
- `faculty_swap_map` missing while an existing public swap index contains old opaque keys;
- a public key exists but there is no safe private ownership mapping for it.

Public-display corruption alone is not automatically critical when the private map still provides unambiguous ownership; it can be regenerated from the safe private map.

The system must not offer a Force Repair for critical identity ambiguity.

## 7. Atomic Full Rebuild

Manual rebuild is allowed only when verification finds no critical identity ambiguity.

The rebuild flow is:

```text
Previous Verify = MISMATCH
        ↓
Reload latest Faculty + Sessions + private swap map
        ↓
Build expected four documents
        ↓
Validate swap identity safety
        ↓
ONE Firestore WriteBatch containing four set() operations
        ↓
Commit atomically
        ↓
Reload source + derived documents
        ↓
Run full verifyDerivedIndexes()
        ↓
HEALTHY → report success
MISMATCH/CRITICAL → report rebuild failure
```

A successful `batch.commit()` is not sufficient to claim repair success. Only the post-rebuild full verification may produce the successful outcome.

All four rebuilt documents use one rebuild timestamp and appropriate actor metadata.

The rebuild never changes Faculty or Session source documents.

## 8. Concurrency and Maintenance State

A manual rebuild always reloads current source data immediately before building expected indexes. It does not trust potentially stale page arrays.

A concurrent source change after the build may make the just-written indexes stale. The mandatory post-rebuild verification detects that condition and reports the rebuild as not healthy rather than claiming success.

Workstream 3 teaching-data maintenance continues to take precedence. The Manual Rebuild control will use the existing maintenance-control integration (`data-derived-index-rebuild`) so full rebuild is disabled while a bulk import/restore lock is active.

No second global maintenance-lock subsystem is introduced for this four-document repair operation.

## 9. Permission Model

Approved behavior:

### All Admin roles

- May run **Verify Derived Indexes**.
- May continue normal application edits that trigger the existing automatic incremental index maintenance.

### Owner / ADFA General

- May run Verify.
- May use **Manual Full Rebuild**.

### ADFA Regular / other Admin roles

- Do not see the Manual Rebuild button.
- Normal timetable edits continue to maintain indexes automatically.

Because the application is a Firebase client application and ordinary Admin edits must retain rule permission to update derived documents, the Manual Rebuild distinction is an application/UI workflow boundary in this architecture. Firestore rules must not simply change all four derived documents to `general()`-only because doing so would break existing automatic incremental maintenance for regular administrators.

The implementation must not claim the Manual Rebuild distinction is a server-side cryptographic/security boundary unless a later architecture adds a trusted server identity or a rule-distinguishable write contract.

## 10. Faculty Dashboard UI

Do not add a new top-level tab.

Add a **Derived Index Health** card in the existing **Faculty Database** section, below its toolbar.

Representative healthy/mismatch UI:

```text
Derived Index Health

Last checked: Sep 16, 2026 9:xx PM

✓ faculty_index
✓ schedule_stats
✗ faculty_swap_index
✓ faculty_swap_map

Faculty checked: 118
Sessions checked: 2,436
Overall: MISMATCH

[ Verify Derived Indexes ] [ Rebuild Derived Indexes ]
```

The Rebuild button appears only for Owner / ADFA General.

Mismatch rows may expand to show exact paths and values:

```text
schedule_stats
courseCounts.505
Expected: 42
Actual:   41
```

For critical corruption:

```text
Overall: CRITICAL

faculty_swap_map
Duplicate opaque key ownership detected.
Automatic rebuild is unavailable.

[ Verify Again ]
```

The Verify action never writes data or silently repairs anything.

## 11. Workstream 3 Integration

### 11.1 Final import gate

Replace Workstream 3's provisional verifier with the full `verifyDerivedIndexes()`.

The final import lifecycle becomes:

```text
Apply Faculty
↓
Apply Sessions
↓
Verify incoming source
↓
Delete frozen stale sessions
↓
Verify final Session ID set
↓
Atomic rebuild all four derived indexes
↓
Full canonical derived-index verification
↓
HEALTHY → COMPLETED + unlock
not healthy → FAILED + maintenance lock remains
```

The existing controller already treats `verifyIndexes().ok !== true` as a failed final gate, so Workstream 4 upgrades the injected implementation rather than redesigning the bulk-import state machine.

### 11.2 Import preflight protection

Bulk-import preflight also checks current derived-index health before any teaching-data writes.

- `HEALTHY`: proceed normally.
- ordinary `MISMATCH`: show a warning but allow import. The import's final rebuild is expected to repair derived data.
- `CRITICAL`: block import before backup/apply and require the identity corruption to be resolved first.

This prevents an import from writing source data only to discover at the final phase that legacy opaque swap ownership cannot be recovered safely.

## 12. Error Handling

Verify failures caused by network/permission problems are shown as operational errors and are not mislabeled as data mismatches.

A rebuild must distinguish:

- blocked because the pre-rebuild report is `CRITICAL`;
- Firestore batch commit failure;
- post-rebuild verification mismatch;
- network/permission failure during post-rebuild verification.

The UI must never say "rebuilt successfully" until the fresh post-rebuild verification returns `HEALTHY`.

## 13. Testing Strategy

### 13.1 Pure/unit tests

Add tests for:

- canonical normalization and generation-metadata exclusion;
- exact path diff reporting;
- 50-detail display limit with full mismatch count;
- missing document handling;
- invalid document structure handling;
- preservation of unambiguous existing swap keys;
- genuinely new faculty requiring a new key;
- stale mapping removal;
- `HEALTHY`, `MISMATCH`, and `CRITICAL` classification;
- critical duplicate key ownership;
- critical conflicting keys for one faculty member;
- public-only old keys with missing private ownership;
- UI permission behavior for Verify vs Manual Rebuild;
- Workstream 3 preflight behavior for mismatch vs critical;
- Workstream 3 final gate using the full verifier.

### 13.2 Firebase Emulator deliberate-corruption tests

Intentionally corrupt derived documents in the emulator and prove detection/repair:

| Corruption | Expected result |
| --- | --- |
| delete `faculty_index` | MISMATCH; rebuild repairs |
| wrong faculty session count | exact field diff |
| wrong `schedule_stats.courseCounts` | exact expected/actual |
| delete `schedule_stats` | MISMATCH |
| stale public swap name | rebuild repairs |
| stale AFC ranges | rebuild repairs |
| missing public swap entry with safe private map | rebuild repairs |
| genuinely new faculty without mapping | rebuild allocates one stable key |
| duplicate private opaque-key ownership | CRITICAL; rebuild blocked |
| conflicting private keys for one faculty | CRITICAL; rebuild blocked |
| private map missing while old public keys exist | CRITICAL |
| successful full rebuild | all four writes committed together |
| post-rebuild verify | HEALTHY |
| source changes after rebuild build step | reverify catches mismatch |
| Bulk Import with CRITICAL state | blocked before source writes |
| Bulk Import with ordinary mismatch | allowed; final rebuild/verify required |
| Import final verifier fails | job remains failed and maintenance lock remains |

No deliberate corruption test will run against the GitHub Pages live Firebase backend.

### 13.3 Manual Pages validation

GitHub Pages validation is non-destructive:

- Admin can open Faculty Database and run Verify.
- Verify reports four document states and source counts.
- ADFA Regular can Verify but does not see Manual Rebuild.
- Owner / ADFA General sees Manual Rebuild.
- Maintenance mode disables Manual Rebuild.
- Do not deliberately corrupt or repair live data merely to exercise failure paths.

## 14. Likely Implementation Files

Expected focused changes:

- `index-maintenance.js` — canonical four-index build, structured verifier, atomic rebuild.
- `faculty-admin.html` — Derived Index Health mount/card if a static mount is preferred.
- `faculty-admin.js` and/or a focused derived-index UI module — Verify/Rebuild UI and permission binding.
- `bulk-import-controller.js` — preflight critical-index gate if controller ownership is the cleanest boundary.
- `bulk-import-ui.js` — inject the full verifier/rebuilder instead of the provisional implementation.
- `maintenance-state.js` — only if the existing `data-derived-index-rebuild` hook needs wiring, not a new lock model.
- `tests/...` — pure, UI, controller, and emulator regression coverage.

The implementation plan may refine exact filenames after re-reading the current code, but it must preserve the boundaries and behaviors defined in this spec.

## 15. Release Gate

Before Workstream 4 can merge:

1. Full normal test suite passes.
2. Full Firebase/Auth emulator suite passes.
3. Deliberate-corruption tests demonstrate detection and safe repair behavior.
4. Workstream 3 import tests pass with the full verifier integration.
5. GitHub Pages test site deploys successfully.
6. User manually validates the non-destructive Pages workflow.
7. User explicitly approves the implementation PR/version.
8. Only then merge to `main`.
9. Verify post-merge `main` Test and Azure Static Web Apps workflows.
10. If Firestore rules change during implementation, deploy them manually/separately and do not treat application deployment as rules deployment.

## 16. Success Criteria

Workstream 4 is complete when:

- one canonical path defines expected business content for all four derived indexes;
- Verify is read-only and gives useful field-level differences;
- ambiguous swap identity ownership is detected and never guessed;
- safe rebuild writes all four documents atomically;
- rebuild success requires a fresh full verification;
- Manual Rebuild is exposed only to Owner / ADFA General while normal Admin incremental maintenance still works;
- Bulk Import blocks preflight on critical swap identity corruption;
- Bulk Import finishes only after full derived-index verification succeeds;
- destructive failure/corruption behavior is proven in the emulator, not against live Firebase.
