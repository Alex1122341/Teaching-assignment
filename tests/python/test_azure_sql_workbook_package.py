import json
import tempfile
import unittest
import subprocess
import sys
from datetime import date, time
from pathlib import Path

from openpyxl import Workbook

from tools.azure_sql_migration.package import build_package


def read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class WorkbookPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workbook = self.root / "example.xlsx"

        wb = Workbook()
        ws = wb.active
        ws.title = "Teaching Assignments"
        ws.append(["faculty_name", "quantity", "double", "day", "start"])
        ws.append(["Example, Faculty", 2, "=B2*2", date(2026, 9, 24), time(8, 30)])
        ws.append(["Second, Faculty", 3, "=B3*2", date(2026, 9, 25), time(9, 45)])
        ws.append([None, None, None, None, None])

        helper = wb.create_sheet("README")
        helper["A1"] = "PAWS helper notes"
        helper["A3"] = "Second non-tabular line"
        wb.save(self.workbook)

    def tearDown(self):
        self.temp.cleanup()

    def build(self):
        return build_package([self.workbook], self.root / "out")

    def test_preserves_every_nonempty_row_and_formula_text(self):
        package = self.build()
        manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        raw = read_jsonl(package / "raw_rows.jsonl")

        self.assertEqual(manifest["format"], "paws-azure-sql-import-v1")
        self.assertEqual(manifest["totals"]["nonEmptyRows"], 5)
        self.assertEqual(len(raw), 5)
        formula_cells = [
            cell
            for row in raw
            for cell in row["cells"]
            if cell.get("formula")
        ]
        self.assertEqual(formula_cells[0]["formula"], "=B2*2")

    def test_serializes_excel_date_and_time_deterministically(self):
        package = self.build()
        raw = read_jsonl(package / "raw_rows.jsonl")
        flattened = json.dumps(raw, sort_keys=True)
        self.assertIn("2026-09-24", flattened)
        self.assertIn("08:30:00", flattened)

    def test_cli_runs_directly_from_repo_root(self):
        out = self.root / "cli-out"
        result = subprocess.run([
            sys.executable, "tools/build_azure_sql_import.py",
            "--workload", str(self.workbook),
            "--afc", str(self.workbook),
            "--faculty", str(self.workbook),
            "--output-root", str(out),
        ], cwd=Path(__file__).resolve().parents[2], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(Path(payload["packagePath"]).exists())

    def test_build_is_content_addressed_and_repeatable(self):
        first = self.build()
        second = self.build()
        m1 = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
        m2 = json.loads((second / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(m1["sourceManifestSha256"], m2["sourceManifestSha256"])
        self.assertEqual(first.name, m1["sourceManifestSha256"])
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
