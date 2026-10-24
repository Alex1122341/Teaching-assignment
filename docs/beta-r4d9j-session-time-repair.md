# BETA-R4D-9J Session-Time Repair Operator Guide

## Safety boundary

This repair changes only `paws.Session.StartTime` and `paws.Session.EndTime` for the exact `SessionId` values in `tools/azure_sql_migration/session_time_corrections.json`. It does not reset or reload the database and does not change frontend, Firebase, authorization, DOE, AFC, role, user-profile, or assignment data.

The command defaults to preview. A live change requires `-Apply`.

## Inputs and generated evidence

Authoritative input priority:

1. `ucvm_timetable_master_2026-09-27.xlsx`
2. `ucvm-filtered-timetable.csv`
3. `PAWS_session_audit_FINAL_2026-09-27.xlsx`

Generate outside-Git reconciliation data and the review manifest:

```powershell
python tools/reconcile_session_times.py `
  --current-csv <ucvm-filtered-timetable.csv> `
  --master-xlsx <ucvm_timetable_master_2026-09-27.xlsx> `
  --audit-xlsx <PAWS_session_audit_FINAL_2026-09-27.xlsx> `
  --reconciliation-json <outside-git/reconciliation.json> `
  --manifest-output <outside-git/session_time_corrections.json>
```

The reviewed manifest is then applied to the existing normalized-session payload only after the original canonical key has produced the stable `SessionId`.

## Preview

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tools/repair_paws_session_times.ps1
```

Preview authenticates and reads SQL but performs no write. It validates all exact current old-time pairs and prints the proposed rows plus pre-repair session count, canonical assignment count, and SessionId-set hash.

The repository's accepted loader baseline distinguishes:

- `staging.TeachingAssignmentRaw`: 4,974 source rows
- `paws.SessionAssignment`: 4,970 canonical relationships

The operator invariant is the canonical relationship count. It must be unchanged before/after the transaction.

## Apply

Only after source files, manifest, tests, preview, and reproducibility evidence are reviewed:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tools/repair_paws_session_times.ps1 `
  -BackupPath <outside-git/PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv> `
  -Apply
```

The script refuses to overwrite an existing backup. It exports all affected pre-update rows, records the backup SHA-256, opens one transaction, updates by exact `SessionId` and exact old times, checks row count/session count/assignment count/SessionId hash, and commits only when every invariant passes. Otherwise it rolls back.

## Rollback

Preview exact rollback:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tools/repair_paws_session_times.ps1 `
  -RollbackFrom <outside-git/PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv>
```

Apply exact rollback:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tools/repair_paws_session_times.ps1 `
  -RollbackFrom <outside-git/PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv> `
  -Apply
```

Rollback requires the current SQL rows to equal the manifest's corrected times, then restores the backup's old times by exact `SessionId` under the same transaction gates.

## Completed live operation — 2026-09-27

The reviewed R4D-9J live repair completed successfully.

- manifest: 423 exact corrections;
- manifest SHA-256:
  `3802b09a9e0bc5b75a598f45390667577da90e7cb11493a399d0fee947fa17a9`;
- backup:
  `C:\Users\xinyu\Desktop\PAWS-R4D9J-Live-Backup\PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv`;
- backup SHA-256:
  `3c47c9890e56d65e3319947da2a88e92aa0cd3ea3d2d803d8ff819ecc7817ad8`;
- transaction: COMMITTED;
- rows updated/inserted/deleted: 423 / 0 / 0;
- Session: 1,937 -> 1,937;
- SessionAssignment: 4,970 -> 4,970;
- SessionId-set SHA unchanged:
  `2a105c0086ac52dc574a732d7aef2b2eb9cac0cdfe9648d6ca346c4db1093224`;
- post-apply manifest verification: 423/423;
- rollback preview: PASS, zero writes.

Do not apply rollback unless a later approved incident response requires it.

