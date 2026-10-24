# HICC–CC / VISC directory: immutable freeze promotion (2026-10-22)

| | |
|---|---|
| Product anchor | `de4d3cacb395e71677ca4088c37ef5367895bf12` (`feature/hicc-visc-directory-20261022`, built on `main` @ `924cc676`) |
| Previous anchor | `5b135dfc91332a6fad29376d1d88d9acd33fd62a` (CCC Schedule product, PR #130) |

This separate governance commit changes no product runtime bytes and adds no drift exceptions. `tools/beta-baseline.json` is re-derived from the anchor's blobs.

**Static protection: 85 → 87.**
- Added: `leadership-directory.css`, `leadership-directory.js`.
- Changed: `index.html`, `paws-data-client.js`, `timetable.js`.
- Removed: none.

**API protection: 110 → 114 runtime files (117 protected paths).**
- Added:
  - `server/src/data/sql-leadership-directory-repository.js`
  - `server/src/roles/leadership-directory-api.js`
  - `server/src/roles/role-effective-status.js`
  - `server/src/runtime/swa-leadership-directory-functions.js`
- Changed: `server/src/runtime/swa-sql-runtime.js`.
- Removed: none.
- No SQL migration. The directory reads only columns already granted to `paws_runtime_read`.

**Regression.** `tests/beta-baseline.test.js` pins the exact delta from `5b135df`: no dropped protected path, no `database/` change against `main` @ `924cc676`, and anchor ancestry. The CCC Schedule promotion stays pinned as history (`CCC_SCHEDULE_PRODUCT_COMMIT`).

**Reviewer note.** The anchor is a commit SHA. If `main` moves before merge, or the product changes, regenerate it in a new governance commit.
