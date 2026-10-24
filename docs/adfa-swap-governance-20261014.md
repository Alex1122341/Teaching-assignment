# ADFA SWAP candidate freeze promotion

Accepted product: `0f81c3e0b7e63a9b9357755b7e957406018894fd`. Previous immutable Calendar product: `7526e86f295de062c228fb1ddee2f007706285c2`.

Independent whole-feature product review and the focused fix-pass reviews returned Ready; all findings were reproduced and resolved as recorded in adfa-swap-review-20261014.md. This separate governance change updates only the shared immutable anchor, reporting hashes, exact coverage/delta assertions, the deployment anchor expectation and the documented asset count.

Static coverage75 (previous74), adding exactly adfa-swap-panel.js. The other changed protected static paths are index.html, paws-data-client.js, swap-workflow-sql.css and swap-workflow-sql.js. API coverage remains73 runtime files and76 protected paths including Dockerfile and two server package inputs. Exactly four API files change: sql-swap-repository.js, swa-sql-runtime.js, swa-swap-functions.js and swap-api.js. No previously protected path is removed.

Reporting hashes are derived from immutable accepted Git blobs with existing CRLF canonicalization, including the unchanged PDF bytes. Mutable JSON is not verification authority. Protected-manifest union, byte comparison, historical anchors, attack rejection and artifact inventory semantics are unchanged. Calendar's exact historical delta remains pinned to its original product.

Separate fresh-context governance review returned Ready after independently checking all75 hashes, unchanged PDF bytes, exact coverage/deltas, immutable Calendar history and unchanged protection semantics. It identified one old current-anchor Calendar assertion; observed RED was corrected to immutable historical governance9f4290d057629c0583d41a6e03616e0204a71a82. Focused governance/attack checks12/12 pass. Candidate build plus repository and both artifact freezes report zero drift. Full root/server/emulator CI, actual disposable SQL acceptance and container checks must pass on the final candidate.

This is candidate verification authority only. Draft PR99 depends on PR98. No merge, live SQL migration/role binding, University process cutover, write-gate change, AFC deletion or Hosting release is authorized by this change.
