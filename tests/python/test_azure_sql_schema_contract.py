import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_sql(name):
    return (ROOT / "database" / "azure-sql" / name).read_text(encoding="utf-8")


class AzureSqlSchemaContractTests(unittest.TestCase):
    def test_foundation_defines_required_import_and_business_tables(self):
        sql = read_sql("001_foundation.sql")
        required = [
            "staging.ImportBatch", "staging.ImportWorkbook", "staging.ImportSheet", "staging.ImportRow", "staging.PackageEntity",
            "staging.FacultyRaw", "staging.FacultyProfessionalRaw", "staging.JointAppointmentRaw",
            "staging.FacultyOverviewRaw", "staging.TeachingAssignmentRaw", "staging.RoleAssignmentRaw",
            "staging.CourseRaw", "staging.DoeRuleRaw", "staging.AccountRoleRaw", "staging.AfcRecordRaw",
            "paws.Faculty", "paws.FacultyAlias", "paws.FacultyProfessionalProfile", "paws.JointAppointment",
            "paws.Course", "paws.Session", "paws.SessionAssignment", "paws.AfcRecord", "paws.RoleAssignment",
            "paws.DoeRuleSeed", "paws.RoleDefinition", "paws.UserProfile", "paws.AuditEvent",
        ]
        for name in required:
            self.assertIn(name, sql, name)

    def test_faculty_uses_preferred_first_last_and_filtered_identity_uniqueness(self):
        sql = read_sql("001_foundation.sql")
        self.assertRegex(sql, r"FacultyId\s+uniqueidentifier\s+NOT NULL")
        self.assertIn("PreferredFirstName", sql)
        self.assertIn("PreferredLastName", sql)
        self.assertIn("DisplayName", sql)
        self.assertNotIn("HrName", sql)
        self.assertRegex(sql, r"CREATE UNIQUE INDEX\s+UX_Faculty_Ucid.*WHERE Ucid IS NOT NULL")
        self.assertRegex(sql, r"CREATE UNIQUE INDEX\s+UX_Faculty_Email.*WHERE Email IS NOT NULL")

    def test_constraints_cover_afc_dates_role_dates_and_session_foreign_keys(self):
        sql = read_sql("001_foundation.sql")
        self.assertRegex(sql, r"CHECK\s*\(EndDate\s*>=\s*StartDate\)")
        self.assertRegex(sql, r"ExpirationDate IS NULL OR EffectiveDate IS NULL OR ExpirationDate > EffectiveDate")
        self.assertIn("FK_SessionAssignment_Session", sql)
        self.assertIn("FK_SessionAssignment_Faculty", sql)
        self.assertIn("DoeOverrideValue decimal", sql)
        self.assertNotRegex(sql, r"DoeOverrideValue[^\n]+CHECK[^\n]+>=\s*0")

    def test_role_assignment_raw_preserves_long_source_course_values(self):
        sql = read_sql("001_foundation.sql")
        match = re.search(
            r"CREATE TABLE staging\.RoleAssignmentRaw \((?P<body>.*?)\);",
            sql,
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        body = match.group("body")
        self.assertRegex(body, r"CourseCode\s+nvarchar\((?:1000|max)\)\s+NULL")

    def test_calendar_view_uses_canonical_session_and_preferred_faculty_display_only(self):
        sql = read_sql("002_calendar_view.sql")
        self.assertIn("CREATE VIEW paws.vCalendarSession", sql)
        self.assertIn("FROM paws.Session", sql)
        self.assertIn("paws.SessionAssignment", sql)
        self.assertIn("paws.Faculty", sql)
        self.assertIn("DisplayName", sql)
        for forbidden in ["Ucid", "Email", "DoeCredit", "Purpose", "ReportsToRaw"]:
            self.assertNotIn(forbidden, sql)

    def test_app_permissions_grant_paws_and_deny_staging_without_password_or_db_owner(self):
        sql = read_sql("003_app_permissions.sql")
        self.assertIn("$(PAWS_API_PRINCIPAL)", sql)
        self.assertRegex(sql, r"(?is)GRANT\s+SELECT.*ON SCHEMA::paws")
        self.assertRegex(sql, r"(?is)DENY\s+SELECT.*ON SCHEMA::staging")
        self.assertNotIn("db_owner", sql.casefold())
        self.assertNotIn("password", sql.casefold())


if __name__ == "__main__":
    unittest.main()
