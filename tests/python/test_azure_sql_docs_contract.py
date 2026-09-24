import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class AzureSqlDocsContractTests(unittest.TestCase):
    def test_ci_is_read_only_and_runs_migration_tests_without_azure_credentials(self):
        workflow = (ROOT / ".github" / "workflows" / "azure-sql-migration-test.yml").read_text(encoding="utf-8")
        self.assertIn('python-version: "3.11"', workflow)
        self.assertIn('tools/requirements-azure-sql-migration.txt', workflow)
        self.assertIn('test_azure_sql_*.py', workflow)
        self.assertIn('contents: read', workflow)
        self.assertIn('Parser]::ParseFile', workflow)
        self.assertIn('load_paws_azure_sql_empty.ps1', workflow)
        self.assertNotIn('tools/import_paws_azure_sql.ps1', workflow)
        for forbidden in ['AZURE_', 'secrets.', 'azure/login', 'workflow_dispatch']:
            self.assertNotIn(forbidden, workflow)

    def test_operator_docs_define_verified_empty_database_then_guarded_load(self):
        docs = (ROOT / "docs" / "azure-sql-migration.md").read_text(encoding="utf-8")
        self.assertIn('private', docs.casefold())
        self.assertIn('do not commit', docs.casefold())
        self.assertIn('ucvm-teaching-lab-xz-20260911.database.windows.net', docs)
        self.assertIn('teaching-assignment-lab', docs)
        self.assertIn('plan_paws_azure_sql_reset.ps1', docs)
        self.assertIn('reset_paws_azure_sql_exact.ps1', docs)
        self.assertIn('load_paws_azure_sql_empty.ps1', docs)
        self.assertNotIn('import_paws_azure_sql.ps1', docs)
        self.assertIn('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', docs)
        self.assertIn('e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4', docs)
        self.assertIn('4,970', docs)
        self.assertIn('Zachar, Erin', docs)
        self.assertIn('former faculty', docs.casefold())
        self.assertIn('Firestore is not a source', docs)
        self.assertIn('staging', docs)
        self.assertIn('invalid', docs.casefold())


if __name__ == "__main__":
    unittest.main()