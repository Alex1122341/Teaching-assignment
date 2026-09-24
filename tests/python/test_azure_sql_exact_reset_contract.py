import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "reset_paws_azure_sql_exact.ps1"

EXPECTED_OBJECTS = [
    "usp_UpsertFirestoreDocument",
    "AppSetting",
    "AppUser",
    "AuditEvent",
    "ChangeRequest",
    "Faculty",
    "FacultyGroup",
    "FacultyGroupCourse",
    "FacultyGroupMember",
    "FirestoreDocument",
    "FirestoreImportRun",
    "SessionAssignment",
    "TeachingSession",
    "vw_FirestoreCollectionSummary",
    "vw_FirestoreFacultyMirror",
    "vw_FirestoreSessionAssignmentMirror",
    "vw_FirestoreSessionMirror",
    "vw_SessionSchedule",
]


class AzureSqlExactResetContractTests(unittest.TestCase):
    def test_reset_is_pinned_to_reviewed_inventory_and_requires_explicit_apply(self):
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("6130f81fd01bac166c0b8578d9c79fe255463a440e0123b363e8dc4edf35e603", script)
        self.assertIn("RESET teaching-assignment-lab", script)
        self.assertIn("[switch]$Apply", script)
        self.assertIn("BeginTransaction", script)
        self.assertIn("Rollback", script)
        self.assertIn("Commit", script)
        for name in EXPECTED_OBJECTS:
            self.assertIn(name, script)

    def test_reset_does_not_use_broad_dynamic_drop_scope(self):
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("DROP DATABASE", script.upper())
        self.assertNotIn("TRUNCATE TABLE", script.upper())
        self.assertNotIn("db_owner", script)
        self.assertIn("inventorySha256", script)
        self.assertIn("inventory mismatch", script.casefold())


    def test_migration_ci_watches_exact_reset_script(self):
        workflow = (ROOT / ".github" / "workflows" / "azure-sql-migration-test.yml").read_text(encoding="utf-8")
        self.assertIn('tools/reset_paws_azure_sql_exact.ps1', workflow)


if __name__ == "__main__":
    unittest.main()
