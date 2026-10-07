# Non-production lifecycle demonstration

Run `npm run ai:demo` from the repository root. Node and Git are sufficient.
The command makes its own temporary Git repository and changes only a fixture
Markdown note. It creates issue capture, all five role prompts, architecture
specification, builder handoff, adversarial review, actual local verification,
final review and readiness status. Generated evidence is copied into a unique
ignored `.ai/generated/vista-ai-demo-*/` folder before the temporary repository
is removed. No real issue, PR, model, live data or application file is touched.

The unit profile executes a real Node test on the fixture note and captures TAP. The HY4,
DeepSeek and Sol records are explicitly **simulations**, not real AI reviews.
The sample number 900001 is a local fixture ID, not a claim about a GitHub issue.
The fixture digests belong only to its temporary Git history; never import its
readiness records into a real task or interpret them as production acceptance.

The demonstration output contains the numbered handoff files under tasks/900001,
ready-to-copy prompts under generated/900001 and the fixed-profile unit log.
The lifecycle regression tests also prove source changes invalidate evidence
and evidence-only commits preserve it.
