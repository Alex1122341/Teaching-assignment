# PAWS Testing documentation

## Current instructions (start here)

- [Repository guide](../README.md), [agent entry](../agent.md), [agent rules](../AGENTS.md) and [PAWS Constitution](../PAWS_CONSTITUTION.md).
- [Testing environments](architecture/testing-environments.md) and [setup](SETUP.md): default PAWS Frontend Demo, optional Firebase Lab, and the separately deployed SQL Beta.
- [Authority and role matrix](security/role-matrix.md) and [manual acceptance](acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md).
- [Firestore data model](database/SCHEMA.md) and [configuration](database/CONFIGURATION.md): distinguish proposals from deployed rules.
- [Graphify reference](architecture/script-dependency-graph.md): verify its dated source fingerprint before using relationships.
- [Branch retention](maintenance/BRANCH_RETENTION.md) and [repository layout](architecture/repository-layout.md).

## Historical references

`superpowers/plans/`, `superpowers/specs/`, `migration/`, `performance/`, dated Beta/SQL release reports, and historical operational runbooks preserve decisions and evidence **from their recorded checkpoints**. They are not current deployment, SQL-migration or Firebase-rule instructions. The archived design/specs are retained, not erased.

[Markdown review and pruning decision](maintenance/MARKDOWN_REVIEW_2026-11-01.md) records the November 2026 audit. Removed single-commit freeze/promotion notes are still in Git history. New PR updates belong in the public [Change Log](../CHANGELOG.json), not in one new standalone release note per commit.

**Default Testing URL:** https://ucvm-teaching-assignment.github.io/Teaching-assignment/ . The single shared URL displays the most recently successfully deployed PR, not necessarily `main`; inspect the banner and SHA.
