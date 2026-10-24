# Calendar activity freeze promotion — reviewed candidate governance

This candidate changes repository verification authority only. It does not merge, publish, activate University SQL/API changes, bind principals or enable write gates. The owner confirmed that a dedicated Windows service account is not yet prepared and requested review/release preparation first.

## Exact authority

- Previous immutable AFC/LAB product: `fb2c625745957fa7d9990033f15a7b1ef91974a5`.
- Accepted Calendar product after the independent review fix pass: `7526e86f295de062c228fb1ddee2f007706285c2`.
- Independent product review covered main base `0d4b4d9ea2e658719e87f16ef5132b82544bc6c1` through `72b238be845aeecfc90348a545dcf94a0fa59f92`. It found no Critical issue. The complete-target-set issue and destructive preview classification context were graded Important by the executor and fixed with observed regressions.
- Actual SQL late-duplicate regression failed on `00aba26` (run38649925133) and passed on the accepted product (run38650226221), including thirteen two-connection races. The two new races observe the exact `paws.AfcRecord` lock resource, with prepared raw lineage so an unrelated source insert cannot satisfy the proof.
- Treatment/classification preview regression failed then passed. The fixed approved source was rehashed and parsed read-only:812 rows,541 working candidates,255 retained,12 quarantined,4 excluded,0 formula rows. These are parser totals, not a fresh live commit manifest.

## Protection and reporting

The immutable baseline is the accepted product Git commit. `tools/beta-baseline.json` remains reporting only; its74 hashes were derived from the accepted Git blobs in a single `git cat-file --batch` read. Verification still obtains authority from immutable Git objects.

The static manifest grows from71 to74 paths, adding exactly `calendar-activities.js`, `calendar-activities.css` and `faculty-admin-activity-import.js`. API runtime coverage grows from67 to73 files. Its unchanged build definition and two server package inputs produce76 protected API paths. No previous static/API path is removed.

The implementation of protected-path union, immutable blob comparison, canonical line endings, artifact inventory and mutable-manifest/hash attack rejection is unchanged. There are no drift exemptions or alternate release copies. The old AFC/LAB delta test is explicitly pinned to its old product SHA; older P4/DOE/AUTH/P3/P2/P1/W1 history remains pinned as before. New tests name the exact static and API delta for Calendar.

## Review and validation gate

Independent fresh-context review of fd50c2c..9f4290d found no actionable issue; all74 immutable Git-blob hashes and unchanged protection semantics were checked, with11/11 focused governance/attack checks passed. CI then exposed one omitted current-anchor assertion in tests/azure-deployment.test.js. Commit9202ad0 corrects only that expectation after observed RED; the full deployment suite passed14/14. This is accepted candidate verification governance, not live trust-anchor activation.

Complete root/server/emulator CI and repository/artifact freeze checks must pass for the final branch head. Local Firestore emulator execution is unavailable because Java is absent; the Beta CI workflow provisions Java21 and runs that suite. Local Chrome used the real demo Auth emulator and synthetic repository/parser/hash fixtures; real SQL/source evidence is separate. See calendar-activity-review-20261014.md for the product review, fix-pass evidence, deferred minors and complete executor rulings.

Two product review minors remain disclosed: formula cells are quarantined rather than rejecting the whole workbook before stage, and Reset does not restore the two new activity filters. No formula row can become an activity, the current approved workbook has no A–D formulas, and the fixed SHA rejects edited variants. The specific formula-before-stage Review Focus is not claimed to pass. Range-aware export and a graphical time-evidence editor remain outside this approved UI task; the authenticated evidence API remains gated.

## Live boundary

Fresh SELECT-only University checks found all three pre-migration SWAP procedure bodies match repository030 after line-ending/outer-edge normalization, with ANSI_NULLS and QUOTED_IDENTIFIER both enabled. No Calendar tables are live. Current counts were1937 Sessions,4970 assignments,119 active/2 inactive faculty,803 active imported AFC and1 active manual AFC. No SWAP request rows were returned. These observations are time-bound and must be repeated before a future operation.

The current operator/runtime identity still has db_owner. No exception is authorized. A dedicated least-privilege runtime identity, restricted recovery destination, fresh exact preview and separate explicit release/migration authorizations remain prerequisites. Existing production/runtime remains the prior release; no current approval permits publishing this candidate.
