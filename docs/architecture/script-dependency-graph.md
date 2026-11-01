# Graphify: consult relationships before tracing

> **Snapshot:** the bundled graph/report was generated in October 2026. Revalidate the source fingerprint and actual code before treating any edge or missing edge as authoritative; the report is not current deployment or deletion evidence.

The checked-in [raw index](graphify/graph.json), [relationship overview](graphify/DEPENDENCIES.html) and [file/symbol tree](graphify/SCRIPT_MAP.html) describe **this Testing repository**, including its PAWS Demo and legacy Lab paths. [Receipt](graphify/receipt.json) records source SHA, code-input fingerprint, raw hash, counts, warnings and verified edges. Generated graph data is public source metadata, not user data, and never belongs in a deployment allowlist.

## First use and freshness

1. Read receipt.json and confirm the remote is UCVM-Teaching-Assignment/Teaching-assignment. A Beta graph describes a different tree.
2. Compare current tracked code inputs against the receipt's sourceCommit / sourceInputPaths. Any changed code input, extraction configuration, missing endpoint or missing snapshot requires refresh. Documentation-only commits do not by themselves change code relationships. Record dirty source explicitly.
3. Query the raw graph before investigating imports, calls, build/release wiring, API repositories or impact. Then verify the referenced current file and line. Treat the graph as navigation, never as an authorization, release or deletion decision.

```powershell
graphify path 'buildPawsPages' 'buildDemoApi' --graph docs/architecture/graphify/graph.json
graphify path 'createDemoRuntime' 'createDataApi' --graph docs/architecture/graphify/graph.json
graphify explain 'createDemoRuntime' --all --graph docs/architecture/graphify/graph.json
graphify affected 'createDemoRuntime' --depth 2 --graph docs/architecture/graphify/graph.json
```

An absent edge is not proof that a file is unused. Check HTML script order, browser globals, dynamic imports, shims, SQL procedure names and both manifests directly. PowerShell/SQL parsing and sensitive-name exclusions are partial. The file tree's totals and clustered overview are not raw multigraph counts.

## Open the views

GitHub displays HTML source rather than executing these files. Serve the snapshot locally:

```powershell
python -m http.server 19070 --bind 127.0.0.1 --directory docs/architecture/graphify
```

Open `http://127.0.0.1:19070/DEPENDENCIES.html` and `/SCRIPT_MAP.html`. The tree uses D3 from d3js.org and needs that CDN available. View failure must be reported, not mistaken for graph extraction failure.

## Regenerate, especially after every merge

Use Graphify0.9.97 with its SQL extra (`graphifyy[sql]==0.9.97`) from a trusted package registry. Run from this repository root, using `.graphifyignore`. Use code-only local extraction; do not enable semantic extraction, remote labeling or source uploads.

```powershell
git rev-parse HEAD
git status --porcelain
graphify extract . --code-only --no-cluster --max-workers 4 --force
graphify tree --graph graphify-out/graph.json --output graphify-out/SCRIPT_MAP.html --root . --label 'PAWS Testing repository script relationships'
$graphVisualRoot = Join-Path (Get-Location) 'graphify-out/visual'
New-Item -ItemType Directory -Path "$graphVisualRoot/graphify-out" -Force
Copy-Item graphify-out/graph.json "$graphVisualRoot/graphify-out/graph.json"
graphify cluster-only $graphVisualRoot --no-label
Copy-Item "$graphVisualRoot/graphify-out/graph.html" graphify-out/DEPENDENCIES.html
Copy-Item "$graphVisualRoot/graphify-out/GRAPH_REPORT.md" graphify-out/GRAPH_REPORT.md
Get-FileHash graphify-out/graph.json -Algorithm SHA256
```

Keep raw graph.json intact: clustering a copy collapses parallel relationships for visualization. Avoid `graphify update`, which may include documents. Refresh the checked-in documentation snapshot through a PR when source changes; update receipt.json with exact source/extraction config, counts and actual warnings. Open both views and confirm at least one extracted edge against current source. Preserve a dated prior receipt when its evidence matters.

**After every merge**, regenerate raw index and both views from the exact merged main before further dependency tracing or release signoff. Record that merged SHA, source state, raw hash and source-verified edge in the release handoff. A feature-branch snapshot is not post-merge evidence. A local post-merge regeneration can be identical to the checked-in snapshot for a documentation-only merge; record that fact instead of creating an endless commit solely to put a commit's own SHA inside itself.

Initial snapshot:7437 nodes/17208 raw edges; overview469 communities/1039 cross-community edges. Source references: `tools/build-paws-pages.js` calls buildDemoApi, and `tools/pages-demo-api/runtime.js` calls createDataApi. These prove Demo composition, not a connection to University SQL.
