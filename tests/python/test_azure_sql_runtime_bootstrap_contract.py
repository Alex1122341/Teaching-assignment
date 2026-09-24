import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "bootstrap_paws_azure_runtime.ps1"

class AzureSqlRuntimeBootstrapContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_requires_explicit_resource_creation(self):
        self.assertIn("[switch]$CreateIfMissing", self.source)
        self.assertIn("Re-run with -CreateIfMissing", self.source)

    def test_configures_managed_identity_sql_and_v1_runtime(self):
        for text in [
            "'webapp','identity','assign'",
            "PAWS_SQL_READS=on",
            "PAWS_SQL_AUTH=on",
            "PAWS_ACCOUNT_BOOTSTRAP_JSON=",
            "CREATE USER ",
            "SCHEMA::paws",
            "SCHEMA::staging",
        ]:
            self.assertIn(text, self.source)

    def test_does_not_enable_azure_sql_global_firewall_without_switch(self):
        self.assertIn("[switch]$AllowAzureServicesToSql", self.source)
        self.assertIn("if ($AllowAzureServicesToSql)", self.source)
        self.assertIn("'0.0.0.0'", self.source)

    def test_configures_github_gate_and_exact_main_deployment(self):
        for text in [
            "PRODUCTION_DOE_API_BASE_URL",
            "DOE_API_APP_NAME",
            "AZURE_DOE_API_PUBLISH_PROFILE",
            "azure-doe-api-production-deploy.yml",
            "commit_sha=$mainSha",
            "azure-static-web-apps.yml",
        ]:
            self.assertIn(text, self.source)

    def test_bootstrap_can_self_provision_portable_cli_without_admin(self):
        for text in [
            "PAWS\\portable-tools\\azure-cli",
            "https://aka.ms/installazurecliwindowszipx64",
            "PAWS\\portable-tools\\github-cli",
            "https://api.github.com/repos/cli/cli/releases/latest",
            "windows_amd64\\.zip",
            "Expand-Archive",
            "Ensure-PortableAzureCli",
            "Ensure-PortableGitHubCli",
            "gh auth login --hostname github.com --git-protocol https --web",
        ]:
            self.assertIn(text, self.source)

    def test_bootstrap_email_is_not_hard_coded(self):
        self.assertIn("Read-Host 'Firebase sign-in email to bootstrap in PAWS SQL'", self.source)
        self.assertNotIn("xinyu.zhu1@", self.source.lower())

if __name__ == "__main__":
    unittest.main()
