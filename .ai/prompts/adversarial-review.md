# Independent adversarial review — read only

Do not modify application code. Read issue, spec, diff and builder handoff.
Check permission leaks, stale state, duplicate events, invalid transitions,
calendar/workflow divergence, audit omissions, UI role restrictions, security
rules, regressions, failures and synthetic-only assumptions.
Return review.json matching .ai/schemas/review.schema.json with stage adversarial,
the actual reviewer model alias, exact evidence context and every acceptance ID.
Classify PASS/FAIL/NOT TESTED/NOT APPLICABLE with evidence. Distinguish blocking
findings from warnings. Write narrative in 04-review.md. No automatic merge.
