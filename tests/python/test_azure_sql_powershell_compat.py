import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class AzureSqlPowerShellCompatibilityTests(unittest.TestCase):
    def test_sha256_helper_supports_windows_powershell_51(self):
        access = (ROOT / "tools" / "azure_sql_migration" / "sql_access.ps1").read_text(encoding="utf-8")
        self.assertNotIn("[Convert]::ToHexString", access)
        self.assertIn("[BitConverter]::ToString", access)

    def test_reset_planner_serializes_empty_inventory_as_json_array(self):
        planner = (ROOT / "tools" / "plan_paws_azure_sql_reset.ps1").read_text(encoding="utf-8")
        self.assertIn("if (@($objects).Count -eq 0)", planner)
        self.assertIn("$canonical = '[]'", planner)

    def test_empty_loader_returns_datatable_without_pipeline_enumeration(self):
        loader = (ROOT / "tools" / "load_paws_azure_sql_empty.ps1").read_text(encoding="utf-8")
        self.assertIn("return ,$table", loader)


if __name__ == "__main__":
    unittest.main()
