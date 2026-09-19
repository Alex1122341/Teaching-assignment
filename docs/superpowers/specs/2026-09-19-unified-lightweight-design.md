# Unified VISTA Lightweight Deployment Design — 2026-09-19

## Status

Design only. Runtime/product implementation is gated on owner approval.

Verified integration baseline: `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`.

This design assumes the integrated PR46 security/database architecture and the latest PR45 DOE server-authority architecture remain unchanged.

## Problem

VISTA source modules are reasonably separated by business responsibility, but the static browser deployment still mirrors that source granularity. The unified baseline deploys 52 JavaScript files and starts 31 local scripts on Timetable and 27 on Faculty Dashboard.

The goal is to reduce browser request fragmentation without converting the source repository into giant files or weakening security, lazy loading, tests, debugging, or historical evidence.

## Design principle

**Modular source, deterministic bundled deployment.**

The repository remains the readable/debuggable source of truth. The build creates fewer generated browser artifacts under `.deploy-static/`.

Source files are not manually merged. Generated bundles are not committed.

## Non-negotiable invariants

### Security and configuration

- Firestore Rules remain the authorization source of truth.
- `firebase-config.js` remains the browser Firebase configuration boundary.
- The committed configuration continues to target the isolated lab architecture, never production.
- Production Firebase configuration remains generated/injected only by an explicitly authorized production pipeline.
- `settings/people_index` remains the sanitized faculty-facing account projection.
- Private faculty IDs, HR fields, AFC reasons, private assignments and DOE evidence must not leak into public/sanitized documents.

### DOE server authority

- Browser pages keep using `doe-api-client.js` for authoritative DOE operations.
- The retired browser policy engine/repository/firestore/service modules must not re-enter active browser deployment.
- DOE publication, recalculation and authoritative calculation remain server-side.
- DOE policy/evidence collections retain their current Rules and immutable-history semantics.

### Audit and workflow

- Session/calendar/audit/DOE writes keep current atomic/batched guarantees.
- Session and faculty change logs remain append-only.
- Approval routing semantics and office permissions do not change.
- Faculty swap compatibility behavior remains intact.

### Lazy-loading

- AFC PDF template remains lazy.
- PDF-lib remains lazy.
- AFC PDF-only value/renderer helpers remain lazy.
- Approval workflow remains deferred from initial Timetable startup.
- Faculty admin enhancements remain deferred as today.
- A source file may be included in a startup bundle only if it is already an unconditional startup dependency on that page.

## Build architecture

### Source layer

Source HTML keeps explicit script tags and existing script order. This preserves:

- readable dependency order;
- simple static tests;
- local debugging;
- reviewable source responsibilities.

### Bundle declaration

Add a deterministic build manifest, proposed path:

`tools/runtime-bundles.json`

Each entry declares:

- output artifact name;
- ordered member source files;
- target page(s);
- startup or lazy classification;
- source-script sequence that may be replaced in generated HTML.

The manifest must not infer ordering from filesystem order.

Illustrative shape:

```json
{
  "bundles": [
    {
      "name": "assets/faculty-scheduling.bundle.js",
      "kind": "startup",
      "members": ["faculty-doe.js", "scheduling-core.js"],
      "pages": ["index.html", "faculty-admin.html", "user-management.html"]
    }
  ]
}
```

The final schema may differ, but it must remain data-driven and testable.

### Bundle generation

`tools/build-static.js` will:

1. validate the current source allowlist;
2. validate every declared bundle member exists;
3. validate member order against each target page;
4. reject duplicate members inside one bundle;
5. reject lazy-only source in a startup bundle;
6. generate bundle contents in deterministic order;
7. insert a separator before each source, for example:
   `/* SOURCE: data-index.js */`;
8. add a defensive statement boundary between source blocks;
9. copy non-bundled static assets;
10. generate deployment HTML with the declared script sequences replaced by bundle references;
11. verify every local generated HTML reference resolves inside `.deploy-static/`;
12. print actual output file count and bytes.

No minification, parsing transformation, tree shaking or source rewriting occurs in Phase 1.

## Source-map/debug strategy

Phase 1 does not need transformed source maps because the generated artifact is ordered source concatenation with visible `SOURCE` markers.

A failing production/test stack can be mapped to a bundle section by:

- generated line number;
- `SOURCE` separator;
- source file retained unchanged in the repository.

If this proves inadequate, line-offset metadata may be emitted by the build, but a third-party bundler is not introduced merely for source-map support.

## Candidate bundle boundaries

Exact bundle membership is finalized by RED dependency tests before implementation. The preferred topology is conservative and based on current ordering.

### Shared startup candidates

- `faculty-scheduling.bundle.js`
  - `faculty-doe.js`
  - `scheduling-core.js`

- `data-audit.bundle.js`
  - `data-index.js`
  - `index-maintenance.js`
  - `audit-details.js`

- `identity.bundle.js`
  - `firebase-config.js`
  - `faculty-access.js`

These sequences are currently adjacent where proposed and preserve order.

### Timetable candidates

Keep `session-guard.js`, `doe-api-client.js`, and `university-closures.js` standalone if doing so avoids unsafe reordering.

A page-specific Timetable approval bundle may contain the current contiguous approval sequence where dependency tests prove exact order preservation.

A page-specific Timetable application bundle may contain the contiguous post-identity Timetable/AFC UI sequence.

The design target is roughly 8–12 direct local startup JS requests, down from 31.

### Faculty Dashboard candidates

- a DOE admin presentation bundle for:
  - `doe-worksheet-view.js`
  - `doe-rulebook-admin.js`
  - `doe-policy-admin.js`

- a Faculty pre-auth/admin bundle where exact source adjacency permits it;

- one or more Faculty application bundles around compatibility/lazy boundaries.

`faculty-swap-safe.js` may remain standalone if including it in a page bundle would require duplicating a >20 KB module that Timetable also lazy-loads.

The design target is roughly 9–12 direct startup requests, down from 27.

### User Management

Bundle only page-specific adjacent code after the shared bundles. Target approximately 5–6 direct requests, down from 11.

### Password

This page is already small. Prefer shared identity reuse over page-specific complexity. Target approximately 3 direct requests, down from 4.

## Lazy bundles

### Approval

A lazy approval artifact may combine compatibility/workflow files only if the existing order remains explicit and `faculty-swap-safe.js` loading semantics are preserved.

`faculty-swap-handoff.js` is not deleted from source. If it becomes a member of a generated lazy bundle, compatibility tests must assert the marker is still represented and executed in the correct place.

### AFC PDF

`afc-form-values.js` and `afc-pdf-browser.js` are natural candidates for one lazy generated helper bundle.

The CDN PDF-lib request and `absence-from-campus-app.pdf` remain separately lazy.

`afc-form-state.js` remains a normal startup dependency because it serves interactive form behavior before PDF generation.

## Duplication policy

Request reduction must not silently inflate deployment or cross-page transfer cost.

Rules:

- prefer each source module to appear in one generated deployment artifact;
- small duplication may be accepted only when it avoids unsafe execution reordering;
- no module larger than 25 KB may be duplicated without explicit design amendment;
- generated JS bytes must remain within 5% of the current 742,264-byte browser-JS baseline;
- per-page startup JS bytes must not grow by more than 1% except for bundle separators;
- if the prototype exceeds these limits, accept a few extra requests instead of duplicating large code.

## Deployment manifest semantics

The current `tools/static-assets.json` is the verified source/deployment allowlist. Phase 1 should avoid a confusing silent semantic change.

Preferred arrangement:

- keep `tools/static-assets.json` as the complete allowlist of runtime source inputs;
- add `tools/runtime-bundles.json` as generated-artifact policy;
- `build-static.js` computes the actual deployment output from both;
- static tests verify every allowlisted runtime source is either:
  - copied directly,
  - represented in exactly one generated bundle, or
  - deliberately represented in more than one bundle under the duplication policy;
- generated build output reports the real deployment file count/bytes.

If maintaining two manifests proves too confusing in implementation, stop and revise the design instead of changing semantics implicitly.

## Generated HTML

Repository HTML remains source HTML.

Only `.deploy-static/*.html` is transformed.

For each bundle, the builder replaces an exact ordered script sequence. Replacement fails closed if:

- a source tag is missing;
- sequence order differs;
- an unexpected script appears inside the declared sequence;
- a member is already replaced by another bundle.

This makes source-order changes visible to CI rather than silently producing a stale bundle.

## CSS and PDF

Phase 1 does not bundle CSS.

Reasons:

- only five deployed CSS files exist;
- each page already loads one or two local stylesheets;
- CSS request reduction is small relative to JS;
- keeping CSS untouched reduces regression scope.

The AFC PDF is not recompressed, moved, renamed or embedded.

## Cache strategy

No cache-policy change in Phase 1.

The existing no-cache behavior remains so bundling can be validated independently.

A later Phase 2 may consider content-hashed JS/CSS plus immutable caching, but only after:

- bundle topology is stable;
- GitHub Pages and Azure behavior are verified;
- rollback/debug workflow is proven.

## Tests

### Static RED/GREEN coverage

Add tests that fail before the bundler exists and prove:

- bundle manifest schema;
- source membership and order;
- source HTML remains unchanged;
- generated HTML uses bundles;
- every generated reference exists;
- startup bundles contain no lazy AFC PDF code;
- startup bundles do not include `approval-workflow.js`;
- browser DOE engine/service files remain absent from active deployment;
- Firebase config still precedes any Firebase initialization;
- bundle contents have deterministic checksums across repeated builds;
- no generated output escapes `.deploy-static/`.

### Existing tests

Do not weaken or delete existing tests to accommodate bundling. Where tests currently inspect source HTML, keep them inspecting source HTML unless the assertion is explicitly about deployment output. Add deployment-output assertions separately.

### Emulator

Rules/Auth emulator coverage remains mandatory even though bundling should not alter Rules. It is a regression gate for accidental integration damage.

## Browser/local smoke

Required after generated output exists:

- Timetable initial load and Day/Week/Month/List;
- single and batch editing;
- selection and exports;
- approval workflow lazy load;
- Faculty swap;
- AFC form and lazy PDF generation;
- Faculty Dashboard tabs;
- DOE Rules UI and permission gating;
- User Management;
- password flow;
- desktop and narrow layout;
- network panel: no 404, duplicate script execution, or unexpected lazy startup request;
- console: no missing globals or load-order errors.

Cloud Pages authentication cannot be claimed until usable lab SDK configuration is injected into the preview build. Local emulator smoke remains valid without cloud credentials.

## Expected measurable result

Baseline:

- 52 deployed browser JS assets;
- 31 Timetable direct scripts;
- 27 Faculty direct scripts;
- 11 User Management direct scripts;
- 4 Password direct scripts.

Phase 1 acceptance target:

- approximately 18–24 deployed browser JS artifacts;
- Timetable 8–12 direct scripts;
- Faculty Dashboard 9–12;
- User Management 5–6;
- Password about 3;
- no more than 5% generated-JS byte growth;
- no material per-page startup-byte growth;
- all lazy boundaries retained;
- all static, server, emulator and build checks green.

## Rollback

Rollback is build-layer only:

1. revert the bundle-manifest/build commits;
2. source HTML and source JS remain unchanged;
3. `build-static.js` resumes copying the original allowlist;
4. no database migration or stored-data rollback is necessary.

This reversibility is a primary reason to bundle only at deployment time.

## Deferred work

Not part of this design:

- minification;
- tree shaking;
- ESM migration;
- whole-source-tree move under `src/`;
- test/document consolidation;
- historical document deletion;
- content-hash caching;
- Firestore schema migration;
- DOE API behavior changes;
- production deployment.
