from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
LOADER = ROOT / "tools" / "load_paws_azure_sql_empty.ps1"

EXPECTED_SOURCE_SHA = "e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4"
EXPECTED_EMPTY_INVENTORY_SHA = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"


class AzureSqlEmptyDbLoaderContractTests(unittest.TestCase):
    def text(self):
        self.assertTrue(LOADER.exists(), "empty-database loader script must exist")
        return LOADER.read_text(encoding="utf-8")

    def test_loader_is_pinned_to_reviewed_empty_database_and_approved_package(self):
        text = self.text()
        self.assertIn("ucvm-teaching-lab-xz-20260911.database.windows.net", text)
        self.assertIn("teaching-assignment-lab", text)
        self.assertIn(EXPECTED_SOURCE_SHA, text)
        self.assertIn(EXPECTED_EMPTY_INVENTORY_SHA, text)
        self.assertRegex(text, r"(?i)objectCount")
        self.assertRegex(text, r"(?i)inventorySha256")
        self.assertRegex(text, r"(?i)PackagePath")
        self.assertRegex(text, r"(?i)\[switch\]\$Apply")

    def test_loader_never_contains_destructive_database_statements(self):
        text = self.text()
        for pattern in [
            r"(?i)\bDROP\s+(?:TABLE|VIEW|PROCEDURE|SCHEMA|DATABASE)\b",
            r"(?i)\bTRUNCATE\s+TABLE\b",
            r"(?i)\bDELETE\s+FROM\b",
            r"(?i)\bALTER\s+TABLE\b[^\r\n;]*\bDROP\b",
        ]:
            self.assertIsNone(re.search(pattern, text), pattern)
        self.assertNotIn("003_app_permissions.sql", text)

    def test_loader_uses_one_transaction_and_rolls_back_on_failure(self):
        text = self.text()
        self.assertIn("BeginTransaction", text)
        self.assertIn(".Rollback()", text)
        self.assertIn(".Commit()", text)
        self.assertRegex(text, r"(?i)SqlBulkCopy")
        self.assertRegex(text, r"(?i)SqlBulkCopyOptions")
        self.assertRegex(text, r"(?i)transaction")

    def test_loader_loads_raw_typed_and_canonical_package_layers(self):
        text = self.text()
        required_pairs = {
            "raw_rows.jsonl": "staging.ImportRow",
            "faculty_raw.jsonl": "staging.FacultyRaw",
            "faculty_professional_raw.jsonl": "staging.FacultyProfessionalRaw",
            "joint_appointment_raw.jsonl": "staging.JointAppointmentRaw",
            "faculty_overview_raw.jsonl": "staging.FacultyOverviewRaw",
            "teaching_assignment_raw.jsonl": "staging.TeachingAssignmentRaw",
            "role_assignment_raw.jsonl": "staging.RoleAssignmentRaw",
            "course_raw.jsonl": "staging.CourseRaw",
            "doe_rule_raw.jsonl": "staging.DoeRuleRaw",
            "account_role_raw.jsonl": "staging.AccountRoleRaw",
            "afc_record_raw.jsonl": "staging.AfcRecordRaw",
            "faculty.jsonl": "paws.Faculty",
            "faculty_alias.jsonl": "paws.FacultyAlias",
            "faculty_professional_profile.jsonl": "paws.FacultyProfessionalProfile",
            "joint_appointment.jsonl": "paws.JointAppointment",
            "course.jsonl": "paws.Course",
            "session.jsonl": "paws.Session",
            "session_assignment.jsonl": "paws.SessionAssignment",
            "afc_record.jsonl": "paws.AfcRecord",
            "role_assignment.jsonl": "paws.RoleAssignment",
            "doe_rule_seed.jsonl": "paws.DoeRuleSeed",
            "role_definition.jsonl": "paws.RoleDefinition",
        }
        for file_name, table_name in required_pairs.items():
            self.assertIn(file_name, text)
            self.assertIn(table_name, text)

    def test_loader_applies_schema_then_verifies_counts_before_success(self):
        text = self.text()
        self.assertIn("001_foundation.sql", text)
        self.assertIn("002_calendar_view.sql", text)
        self.assertRegex(text, r"(?i)validationIssueCount")
        for expected in ["116", "4970", "1937", "162", "798", "791"]:
            self.assertIn(expected, text)
        self.assertIn("TEACHING_FORMER_FACULTY_EXCLUDED", text)
        self.assertIn("AFC_FORMER_FACULTY_EXCLUDED", text)
        self.assertIn("FACULTY_EMAIL_INVALID", text)
        self.assertRegex(text, r"(?m)^\$expectedValidationIssueCount\s*=\s*14\s*$")
        self.assertRegex(text, r"(?m)^\s*FACULTY_EMAIL_INVALID\s*=\s*2\s*$")
        self.assertIn("validationIssueCount", text)
        commit_pos = text.find(".Commit()")
        success_pos = text.find("mode = 'applied'")
        self.assertGreater(commit_pos, 0)
        self.assertGreater(success_pos, commit_pos)


if __name__ == "__main__":
    unittest.main()
