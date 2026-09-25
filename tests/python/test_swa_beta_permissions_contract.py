import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERMISSIONS = ROOT / "database" / "azure-sql" / "004_swa_beta_permissions.sql"


class SwaBetaPermissionsContractTests(unittest.TestCase):
    def text(self):
        self.assertTrue(PERMISSIONS.exists(), "SWA beta permission script must exist")
        return PERMISSIONS.read_text(encoding="utf-8")

    def test_beta_principal_has_only_first_slice_permissions(self):
        sql = self.text()
        self.assertIn("paws_swa_beta", sql)
        for object_name in [
            "paws.UserProfile",
            "paws.Faculty",
            "paws.SessionAssignment",
            "paws.vCalendarSession",
        ]:
            self.assertRegex(
                sql,
                rf"(?is)GRANT\s+SELECT\s+ON\s+OBJECT::{re.escape(object_name)}\s+TO\s+\[paws_swa_beta\]",
            )
        self.assertRegex(
            sql,
            r"(?is)GRANT\s+INSERT\s+ON\s+OBJECT::paws\.UserProfile\s+TO\s+\[paws_swa_beta\]",
        )
        self.assertRegex(
            sql,
            r"(?is)DENY\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+SCHEMA::staging",
        )
        for forbidden in [
            r"(?i)db_owner",
            r"(?i)GRANT\s+CONTROL",
            r"(?i)ALTER\s+ANY",
            r"(?is)GRANT[^;]+SCHEMA::staging",
            r"(?i)\bPASSWORD\b",
        ]:
            self.assertIsNone(re.search(forbidden, sql), forbidden)


if __name__ == "__main__":
    unittest.main()
