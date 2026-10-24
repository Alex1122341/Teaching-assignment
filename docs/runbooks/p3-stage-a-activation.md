# Runbook — P3 Stage A Activation

Status: **prepared, not activated**
Related plan: `docs/superpowers/plans/2026-10-04-p3-stage-a-activation-prep.md`
Related spec: `docs/superpowers/specs/2026-10-04-p3-stage-a-activation-prep.md`

Stage A activates the accepted P3B4 AFC approved-artifact work on top of the live
PAWS runtime. It is deliberately **branch-only**: nothing here deploys anything,
and every step below is reversible.

---

## 0. Preconditions

All must be true before Stage A begins. If any is false, stop.

- [ ] The activation branch is at the reviewed commit, and its CI is green.
- [ ] The live VetMed-Ops database has a **current, verified backup** taken
      within the same maintenance window.
- [ ] The rollback path has been rehearsed against a disposable container, not
      against production.
- [ ] The AFC approved-artifact write gate is still **closed** unless activation
      is explicitly intended in this window.
- [ ] An operator with database-creation authority is available; the ordinary
      runtime account cannot create databases and must not be broadened.
- [ ] The maintenance window, the approver, and the rollback decision-maker are
      named and present.

---

## 1. Activate

Run in order. Do not batch steps.

1. **Freeze the source.** Record the exact activation commit SHA in the change
   record. Nothing is applied from a moving branch.

2. **Verify the target schema version.**
   - Confirm which of migrations `001`–`058` are already applied.
   - Confirm no object the activation depends on has drifted.
   - If the installed version is ahead of or behind the branch, **stop** and
   reconcile first.

3. **Apply the P3B4 migration set.**
   - Apply in numeric order; each migration is idempotent and carries its own
     rollback script.
   - After each migration, re-check the schema version before continuing.

4. **Rehearse the rollback against a disposable container.**
   - Restore the backup into a container named for this rehearsal.
   - Apply, then roll back, then restore again.
   - The rehearsal must reproduce the exact baseline before production is
     touched.

5. **Enable the write gate, one domain at a time.**
   - AFC approved artifacts are activated through their own gate. Enabling it
     must not enable any other domain.
   - Verify the gate reports as enabled through the API, not only in
     configuration.

6. **Smoke the read path before the write path.**
   - AFC record reads, then form reads, then the artifact render.
   - Each must answer against the real database before any write is attempted.

7. **Smoke the write path with a synthetic record.**
   - Create, approve, render, then cancel a synthetic AFC artifact.
   - Confirm the audit rows exist and the original uploaded form remains
     distinct from the generated approved artifact.

8. **Record the activation.**
   - Commit SHA, migration set applied, operator, window, gate states, and the
     smoke results.

---

## 2. Roll back

Trigger rollback on **any** of:

- A migration fails partway and the schema version cannot be confirmed.
- A smoke step produces unexpected audit rows, or none.
- The gate reports enabled in configuration but refuses through the API.
- Any sign of business-data mutation that the change record does not describe.

Steps:

1. **Close the write gate first.** This stops new writes without touching
   existing rows. Reads may continue.
2. **Stop the deployment** serving the activation commit.
3. **Apply the matching rollback scripts** in reverse numeric order.
4. **Restore from the verified backup** if the rollback scripts cannot confirm
   the exact baseline.
5. **Verify the schema version** matches the pre-activation record.
6. **Record the rollback**: trigger, steps taken, data affected, and the
   verification result.

---

## 3. What must never happen

- No write gate is enabled by a configuration file change alone; the API must
  report it enabled.
- No migration is applied against a database whose installed version is not
  confirmed first.
- No rollback is rehearsed against production.
- No faculty record, DOE value, AFC reason, or HR field is copied out of the
  production database for testing. Synthetic fixtures only.
- No gate is left enabled after a rollback.

---

## 4. Evidence to retain

- Activation and rollback commit SHAs.
- Applied migration identifiers, in order.
- Schema version before and after.
- Gate states before, during, and after.
- Backup identifier and restore verification result.
- Smoke outputs, including the synthetic artifact's audit rows.
- Operator, approver, and window timestamps.
