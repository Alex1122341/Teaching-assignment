import json
import tempfile
import unittest
from pathlib import Path

from tools.azure_sql_migration.identity import FacultyResolver, normalize_name, parse_preferred_name
from tools.azure_sql_migration.normalize import canonical_session_key, normalize_package


def read_jsonl(path: Path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def raw_row(workbook, sheet, source_row, values):
    return {
        "workbook": workbook,
        "sheet": sheet,
        "sheetIndex": 1,
        "sourceRow": source_row,
        "cells": [
            {
                "column": i + 1,
                "coordinate": f"C{i + 1}",
                "header": key,
                "value": value,
                "formula": None,
            }
            for i, (key, value) in enumerate(values.items())
            if value is not None
        ],
    }


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.master = [
            {"preferred_name": "Alfajaro, Mia", "hr_name": "Alfajaro, Mia Madel", "ucid": "10200179", "email": "mia.alfajaro@ucalgary.ca"},
            {"preferred_name": "Whiteside, Doug", "hr_name": "Whiteside, Douglas", "ucid": "1", "email": "doug@ucalgary.ca"},
            {"preferred_name": "Juárez Davila, Manuel", "hr_name": "Juárez Davila, Manuel", "ucid": "2", "email": "manuel@ucalgary.ca"},
            {"preferred_name": "van der Meer, Frank", "hr_name": "van der Meer, Franciscus", "ucid": "3", "email": "frank@ucalgary.ca"},
        ]
        self.resolver = FacultyResolver(self.master, aliases={"Juarez Davila, Manuel": "Juárez Davila, Manuel"})

    def test_preferred_name_is_canonical_first_last(self):
        result = self.resolver.resolve("Alfajaro, Mia")
        self.assertTrue(result.resolved)
        self.assertEqual(result.display_name, "Mia, Alfajaro")
        self.assertEqual((result.preferred_first_name, result.preferred_last_name), ("Mia", "Alfajaro"))

    def test_hr_name_resolves_identity_but_returns_preferred_display(self):
        result = self.resolver.resolve("Whiteside, Douglas")
        self.assertTrue(result.resolved)
        self.assertEqual(result.match_method, "hr_name")
        self.assertEqual(result.display_name, "Doug, Whiteside")

    def test_unique_hr_crosswalk_handles_multiword_surname(self):
        result = self.resolver.resolve("van der Meer, Franciscus")
        self.assertTrue(result.resolved)
        self.assertEqual(result.display_name, "Frank, van der Meer")

    def test_explicit_alias_resolves_to_preferred_name(self):
        result = self.resolver.resolve("Juarez Davila, Manuel")
        self.assertTrue(result.resolved)
        self.assertEqual(result.match_method, "alias")
        self.assertEqual(result.display_name, "Manuel, Juárez Davila")

    def test_approved_rancourt_variant_resolves_to_preferred_name(self):
        aliases = json.loads((Path(__file__).resolve().parents[2] / "tools" / "azure_sql_migration" / "name_aliases.json").read_text(encoding="utf-8"))
        resolver = FacultyResolver([
            {"preferred_name": "Rancourt, Derrick", "hr_name": "Rancourt, Derrick Emile", "ucid": "04075442", "email": "rancourt@ucalgary.ca"}
        ], aliases=aliases)
        result = resolver.resolve("Rancourt, Derrick E.")
        self.assertTrue(result.resolved)
        self.assertEqual(result.display_name, "Derrick, Rancourt")
        self.assertEqual(result.match_method, "alias")

    def test_unknown_name_remains_unresolved(self):
        result = self.resolver.resolve("Zachar, Erin")
        self.assertFalse(result.resolved)
        self.assertEqual(result.match_method, "unresolved")

    def test_placeholders_have_nonfaculty_record_types(self):
        self.assertEqual(self.resolver.resolve("Z-Sessional").record_type, "sessional_pool")
        self.assertEqual(self.resolver.resolve("Z-Other").record_type, "other_pool")
        self.assertEqual(self.resolver.resolve("TBD - New Clin Path Hire - AG").record_type, "vacancy")
        self.assertEqual(self.resolver.resolve("TBD - New Clin Path Hire - CW").record_type, "vacancy")


class NormalizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.package = Path(self.temp.name)
        rows = [
            raw_row("Partial Faculty Master List - September 21, 2026.xlsx", "Key", 1, {
                "Preferred FULL Name (Last, First)": "Preferred FULL Name (Last, First)",
                "HR FULL Name (Last, First)": "HR FULL Name (Last, First)",
                "UCID": "UCID", "Email": "Email", "Stream": "Stream", "Rank": "Rank", "FTE": "FTE", "Reports To Manager": "Reports To Manager",
            }),
            raw_row("Partial Faculty Master List - September 21, 2026.xlsx", "Key", 2, {
                "Preferred FULL Name (Last, First)": "Alfajaro, Mia", "HR FULL Name (Last, First)": "Alfajaro, Mia Madel", "UCID": "10200179", "Email": "mia.alfajaro@ucalgary.ca", "Stream": "Teaching & Research", "Rank": "Assistant Professor", "FTE": 1, "Reports To Manager": "Tuan Trang",
            }),
            raw_row("Partial Faculty Master List - September 21, 2026.xlsx", "Key", 3, {
                "Preferred FULL Name (Last, First)": "Arndt, Tara", "HR FULL Name (Last, First)": "Arndt, Tara", "UCID": "10203245", "Email": "TBC", "Stream": "Teaching & Research", "Rank": "Assistant Professor", "FTE": 1, "Reports To Manager": "Tuan Trang",
            }),
            raw_row("Partial Faculty Master List - September 21, 2026.xlsx", "Key", 4, {
                "Preferred FULL Name (Last, First)": "Toy, Shannon", "HR FULL Name (Last, First)": "Toy, Shannon", "UCID": "10100748", "Email": "TBC", "Stream": "Teaching & Research", "Rank": "Assistant Professor", "FTE": 1, "Reports To Manager": "Tuan Trang",
            }),
            raw_row("PAWS_Faculty_Workload_Normalized.xlsx", "Teaching Assignments", 1, {
                "faculty_name": "faculty_name", "academic_year": "academic_year", "curriculum_year": "curriculum_year", "course": "course", "course_name": "course_name", "topic": "topic", "session_type": "session_type", "date": "date", "start": "start", "end": "end", "hours": "hours", "teaching_role": "teaching_role", "lab_lead": "lab_lead", "doe_rate_pct_per_unit": "doe_rate_pct_per_unit", "doe_quantity": "doe_quantity", "doe_credit_pct": "doe_credit_pct", "doe_status": "doe_status",
            }),
            raw_row("PAWS_Faculty_Workload_Normalized.xlsx", "Teaching Assignments", 2, {
                "faculty_name": "Alfajaro, Mia", "academic_year": "2026-27", "curriculum_year": "Year 2", "course": "308", "course_name": "Fundamentals", "topic": "Intro", "session_type": "LEC", "date": "2026-08-24", "start": "08:30:00", "end": "09:30:00", "hours": 1, "teaching_role": "Lecture", "lab_lead": "Lead", "doe_rate_pct_per_unit": 0.3, "doe_quantity": 1, "doe_credit_pct": None, "doe_status": "Calculated from documented rule",
            }),
            raw_row("PAWS_Faculty_Workload_Normalized.xlsx", "Teaching Assignments", 3, {
                "faculty_name": "Z-Sessional", "academic_year": "2026-27", "curriculum_year": "Year 2", "course": "308", "course_name": "Fundamentals", "topic": "Intro", "session_type": "LEC", "date": "2026-08-24", "start": "08:30:00", "end": "09:30:00", "hours": 1, "teaching_role": "Lecture", "doe_rate_pct_per_unit": 0.3, "doe_quantity": 1, "doe_status": "Calculated from documented rule",
            }),
            raw_row("PAWS_Faculty_Workload_Normalized.xlsx", "Teaching Assignments", 4, {
                "faculty_name": "Zachar, Erin", "academic_year": "2026-27", "curriculum_year": "Year 2", "course": "308", "course_name": "Fundamentals", "topic": "Intro", "session_type": "LEC", "date": "2026-08-24", "start": "08:30:00", "end": "09:30:00", "hours": 1, "teaching_role": "Lecture", "doe_rate_pct_per_unit": 0.3, "doe_quantity": 1, "doe_status": "Calculated from documented rule",
            }),
            raw_row("AFC Tracker Lookup (1).xlsx", "AFC records", 1, {"Faculty Member": "Faculty Member", "Start": "Start", "End": "End", "Purpose ": "Purpose "}),
            raw_row("AFC Tracker Lookup (1).xlsx", "AFC records", 2, {"Faculty Member": "Alfajaro, Mia", "Start": "2026-09-10", "End": "2026-09-01", "Purpose ": "Conference"}),
            raw_row("AFC Tracker Lookup (1).xlsx", "AFC records", 3, {"Faculty Member": "Zachar, Erin", "Start": "2026-09-10", "End": "2026-09-11", "Purpose ": "Former faculty record"}),
        ]
        (self.package / "raw_rows.jsonl").write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
        (self.package / "manifest.json").write_text(json.dumps({"format": "paws-azure-sql-import-v1", "sourceManifestSha256": "abc123"}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_canonical_session_grouping_keeps_assignment_multiplicity(self):
        summary = normalize_package(self.package)
        sessions = read_jsonl(self.package / "session.jsonl")
        assignments = read_jsonl(self.package / "session_assignment.jsonl")
        self.assertEqual(len(sessions), 1)
        self.assertEqual(len(assignments), 2)
        self.assertEqual(assignments[0]["sessionId"], assignments[1]["sessionId"])
        self.assertEqual(assignments[0]["facultyDisplayName"], "Mia, Alfajaro")
        self.assertEqual(assignments[1]["facultyDisplayName"], "Z-Sessional")
        self.assertEqual(summary["normalizedCounts"]["session"], 1)

    def test_former_faculty_is_preserved_in_raw_staging_but_excluded_from_canonical_data(self):
        normalize_package(self.package)
        teaching_raw = read_jsonl(self.package / "teaching_assignment_raw.jsonl")
        afc_raw = read_jsonl(self.package / "afc_record_raw.jsonl")
        assignments = read_jsonl(self.package / "session_assignment.jsonl")
        afc = read_jsonl(self.package / "afc_record.jsonl")
        issues = read_jsonl(self.package / "validation_issues.jsonl")

        self.assertTrue(any(row["fields"].get("faculty_name") == "Zachar, Erin" for row in teaching_raw))
        self.assertTrue(any(row["fields"].get("faculty_member") == "Zachar, Erin" for row in afc_raw))
        self.assertFalse(any(row.get("sourceFacultyName") == "Zachar, Erin" for row in assignments))
        self.assertFalse(any(row.get("facultyDisplayName") == "Zachar, Erin" for row in afc))
        self.assertTrue(any(issue["code"] == "TEACHING_FORMER_FACULTY_EXCLUDED" for issue in issues))
        self.assertTrue(any(issue["code"] == "AFC_FORMER_FACULTY_EXCLUDED" for issue in issues))

    def test_invalid_faculty_email_placeholder_stays_raw_but_is_null_in_canonical_identity(self):
        normalize_package(self.package)
        faculty_raw = read_jsonl(self.package / "faculty_raw.jsonl")
        faculty = read_jsonl(self.package / "faculty.jsonl")
        issues = read_jsonl(self.package / "validation_issues.jsonl")

        raw_tbc = [row for row in faculty_raw if row["fields"].get("email") == "TBC"]
        self.assertEqual(len(raw_tbc), 2)

        canonical = {row["displayName"]: row for row in faculty}
        self.assertIsNone(canonical["Tara, Arndt"]["email"])
        self.assertIsNone(canonical["Shannon, Toy"]["email"])

        invalid_email_issues = [issue for issue in issues if issue["code"] == "FACULTY_EMAIL_INVALID"]
        self.assertEqual(len(invalid_email_issues), 2)

    def test_session_ids_are_stable_across_repeat_normalization(self):
        normalize_package(self.package)
        first = read_jsonl(self.package / "session.jsonl")[0]["sessionId"]
        normalize_package(self.package)
        second = read_jsonl(self.package / "session.jsonl")[0]["sessionId"]
        self.assertEqual(first, second)

    def test_bad_afc_range_is_reported_and_excluded(self):
        normalize_package(self.package)
        afc = read_jsonl(self.package / "afc_record.jsonl")
        issues = read_jsonl(self.package / "validation_issues.jsonl")
        self.assertEqual(afc, [])
        self.assertTrue(any(issue["code"] == "AFC_END_BEFORE_START" for issue in issues))


if __name__ == "__main__":
    unittest.main()
