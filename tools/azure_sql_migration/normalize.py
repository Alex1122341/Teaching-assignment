from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .constants import BUSINESS_SHEETS, FORMER_FACULTY_EXCLUSIONS, PLACEHOLDERS
from .identity import FacultyResolver, parse_preferred_name, stable_id


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(_canonical_json(row) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _slug_header(value: Any) -> str:
    text = str(value or "").strip().casefold()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _raw_to_typed(raw: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    formulas: dict[str, str] = {}
    for cell in raw.get("cells", []):
        key = _slug_header(cell.get("header"))
        if not key:
            key = f"column_{cell.get('column')}"
        fields[key] = cell.get("value")
        if cell.get("formula"):
            formulas[key] = cell["formula"]
    return {
        "sourceWorkbook": raw["workbook"],
        "sourceSheet": raw["sheet"],
        "sourceRow": raw["sourceRow"],
        "fields": fields,
        "formulas": formulas,
        "validationStatus": "pending",
        "validationErrors": [],
    }


def _primary_is_formula(raw: dict[str, Any], primary_slug: str) -> bool:
    for cell in raw.get("cells", []):
        if _slug_header(cell.get("header")) == primary_slug:
            return bool(cell.get("formula"))
    return False


def _is_header_row(row: dict[str, Any], primary_slug: str) -> bool:
    if row["sourceRow"] != 1:
        return False
    value = row["fields"].get(primary_slug)
    return _slug_header(value) == primary_slug


def _business_rows(raw_rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    outputs = {file_name: [] for file_name, _ in BUSINESS_SHEETS.values()}
    for raw in raw_rows:
        mapping = BUSINESS_SHEETS.get(raw.get("sheet"))
        if not mapping:
            continue
        file_name, primary = mapping
        typed = _raw_to_typed(raw)
        if _is_header_row(typed, primary):
            continue
        if _primary_is_formula(raw, primary):
            continue
        if not str(typed["fields"].get(primary) or "").strip() and raw.get("sheet") != "AFC records":
            continue
        outputs[file_name].append(typed)
    return outputs


def _norm_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:10]


def _norm_time(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "T" in text:
        text = text.split("T", 1)[1]
    return text[:8]


def _norm_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def canonical_session_key(row: dict[str, Any]) -> str:
    parts = [
        _norm_text(row.get("academic_year")),
        _norm_text(row.get("curriculum_year")),
        _norm_text(row.get("course")),
        _norm_text(row.get("topic")),
        _norm_text(row.get("session_type")),
        _norm_date(row.get("date")),
        _norm_time(row.get("start")),
        _norm_time(row.get("end")),
    ]
    return "|".join(parts)


def _canonical_email(value: Any) -> tuple[str, bool]:
    text = str(value or "").strip()
    if not text:
        return "", False
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", text):
        return text, False
    return "", True


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_aliases() -> dict[str, str]:
    path = Path(__file__).with_name("name_aliases.json")
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_package(package_dir: str | Path) -> dict[str, Any]:
    package_dir = Path(package_dir)
    raw_rows = _read_jsonl(package_dir / "raw_rows.jsonl")
    typed = _business_rows(raw_rows)
    for file_name, rows in typed.items():
        _write_jsonl(package_dir / file_name, rows)

    faculty_raw = typed["faculty_raw.jsonl"]
    master_rows = []
    issues: list[dict[str, Any]] = []
    faculty_rows: list[dict[str, Any]] = []
    for row in faculty_raw:
        f = row["fields"]
        preferred = str(f.get("preferred_full_name_last_first") or "").strip()
        if not preferred:
            continue
        try:
            first, last, display = parse_preferred_name(preferred)
        except ValueError as exc:
            issues.append({"code": "FACULTY_PREFERRED_NAME_INVALID", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "message": str(exc)})
            continue
        ucid = str(f.get("ucid") or "").strip()
        email, email_invalid = _canonical_email(f.get("email"))
        faculty_id = stable_id("faculty", ucid or preferred.casefold())
        master_rows.append({
            "faculty_id": faculty_id,
            "preferred_name": preferred,
            "hr_name": f.get("hr_full_name_last_first"),
            "ucid": ucid,
            "email": email,
        })
        faculty_rows.append({
            "facultyId": faculty_id,
            "recordType": "faculty",
            "preferredFirstName": first,
            "preferredLastName": last,
            "displayName": display,
            "ucid": ucid or None,
            "email": email or None,
            "stream": f.get("stream"),
            "rank": f.get("rank"),
            "fte": _number(f.get("fte")),
            "reportsToRaw": f.get("reports_to_manager"),
            "active": True,
            "sourceWorkbook": row["sourceWorkbook"],
            "sourceRow": row["sourceRow"],
        })
        if not ucid:
            issues.append({"code": "FACULTY_UCID_MISSING", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "facultyDisplayName": display})
        if email_invalid:
            issues.append({
                "code": "FACULTY_EMAIL_INVALID",
                "sourceSheet": row["sourceSheet"],
                "sourceRow": row["sourceRow"],
                "facultyDisplayName": display,
                "sourceEmail": str(f.get("email") or "").strip(),
            })
        elif not email:
            issues.append({"code": "FACULTY_EMAIL_MISSING", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "facultyDisplayName": display})

    resolver = FacultyResolver(master_rows, aliases=_load_aliases())

    used_placeholder_labels = set()
    for file_name in ["teaching_assignment_raw.jsonl", "role_assignment_raw.jsonl", "faculty_overview_raw.jsonl"]:
        for row in typed[file_name]:
            name = str(row["fields"].get("faculty_name") or "").strip()
            if name in PLACEHOLDERS:
                used_placeholder_labels.add(name)
    for label in sorted(used_placeholder_labels):
        resolution = resolver.resolve(label)
        faculty_rows.append({
            "facultyId": resolution.faculty_id,
            "recordType": resolution.record_type,
            "preferredFirstName": None,
            "preferredLastName": None,
            "displayName": label,
            "ucid": None,
            "email": None,
            "stream": None,
            "rank": None,
            "fte": None,
            "reportsToRaw": None,
            "active": True,
            "sourceWorkbook": None,
            "sourceRow": None,
        })

    alias_rows: list[dict[str, Any]] = []
    for alias, target in _load_aliases().items():
        resolution = resolver.resolve(alias)
        if resolution.resolved:
            alias_rows.append({
                "facultyAliasId": stable_id("faculty-alias", alias),
                "facultyId": resolution.faculty_id,
                "aliasName": alias,
                "targetPreferredSourceName": target,
                "targetDisplayName": resolution.display_name,
                "active": True,
            })

    profile_rows: list[dict[str, Any]] = []
    for row in typed["faculty_professional_raw.jsonl"]:
        f = row["fields"]
        resolution = resolver.resolve(f.get("preferred_full_name_last_first"))
        if not resolution.resolved:
            issues.append({"code": "PROFESSIONAL_FACULTY_UNRESOLVED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": f.get("preferred_full_name_last_first")})
            continue
        profile_rows.append({
            "facultyId": resolution.faculty_id,
            "teachingArea": f.get("teaching_area"),
            "professionalCategory": f.get("clinician_diagnostician_researcher"),
            "serviceDate": _norm_date(f.get("service_date")) or None,
            "priorYearsExperience": _number(f.get("prior_yrs_of_exp")),
            "dvmEarnedDate": f.get("dvm_earned_date"),
            "dvmType": f.get("dvm_type"),
            "mastersEarnedDate": f.get("masters_earned_date"),
            "mastersArea": f.get("masters_area"),
            "phdEarnedDate": f.get("phd_earned_date"),
            "phdArea": f.get("phd_area"),
            "boardCertifiedDate": f.get("board_certified_date"),
            "boardCertification": f.get("board_certification"),
            "boardCertificationCount": _number(f.get("of_board_certifications")),
            "abvmaLicenseNumber": f.get("abvma_license"),
            "abvmaMemberType": f.get("abvma_member_type"),
            "sourceRow": row["sourceRow"],
        })

    joint_rows: list[dict[str, Any]] = []
    for row in typed["joint_appointment_raw.jsonl"]:
        f = row["fields"]
        resolution = resolver.resolve(f.get("preferred_full_name_last_first"))
        if not resolution.resolved:
            issues.append({"code": "JOINT_FACULTY_UNRESOLVED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": f.get("preferred_full_name_last_first")})
            continue
        joint_rows.append({
            "jointAppointmentId": stable_id("joint-appointment", f"{resolution.faculty_id}|{row['sourceRow']}"),
            "facultyId": resolution.faculty_id,
            "homeFaculty": f.get("home_faculty"),
            "jointFaculty": f.get("joint_faculty"),
            "fteUcvm": _number(f.get("fte_ucvm")),
            "fteOtherFaculty": _number(f.get("fte_other_faculty")),
            "expiryDate": _norm_date(f.get("joint_appointment_expiry_date")) or None,
            "notes": f.get("notes"),
            "sourceRow": row["sourceRow"],
        })

    course_rows: list[dict[str, Any]] = []
    for row in typed["course_raw.jsonl"]:
        f = row["fields"]
        course = str(f.get("course") or "").strip()
        if not course:
            continue
        course_rows.append({
            "courseId": stable_id("course", course),
            "courseCode": course,
            "courseName": f.get("course_name"),
            "nameStatus": f.get("name_status"),
            "source": f.get("source"),
            "sourceUrl": f.get("source_url"),
            "sourceRow": row["sourceRow"],
        })

    sessions_by_key: dict[str, dict[str, Any]] = {}
    assignment_rows: list[dict[str, Any]] = []
    for row in typed["teaching_assignment_raw.jsonl"]:
        f = row["fields"]
        key = canonical_session_key(f)
        session_id = stable_id("session", key)
        sessions_by_key.setdefault(key, {
            "sessionId": session_id,
            "academicYear": f.get("academic_year"),
            "curriculumYear": f.get("curriculum_year"),
            "courseCode": str(f.get("course") or "").strip() or None,
            "courseName": f.get("course_name"),
            "topic": f.get("topic"),
            "sessionType": f.get("session_type"),
            "date": _norm_date(f.get("date")) or None,
            "start": _norm_time(f.get("start")) or None,
            "end": _norm_time(f.get("end")) or None,
        })
        source_name = f.get("faculty_name")
        if str(source_name or "").strip() in FORMER_FACULTY_EXCLUSIONS:
            issues.append({"code": "TEACHING_FORMER_FACULTY_EXCLUDED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
            continue
        resolution = resolver.resolve(source_name)
        if not resolution.resolved:
            issues.append({"code": "TEACHING_FACULTY_UNRESOLVED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
        rate = _number(f.get("doe_rate_pct_per_unit"))
        qty = _number(f.get("doe_quantity"))
        credit = _number(f.get("doe_credit_pct"))
        if credit is None and rate is not None and qty is not None:
            credit = rate * qty
        assignment_rows.append({
            "sessionAssignmentId": stable_id("session-assignment", f"{row['sourceWorkbook']}|{row['sourceSheet']}|{row['sourceRow']}"),
            "sessionId": session_id,
            "facultyId": resolution.faculty_id,
            "facultyDisplayName": resolution.display_name,
            "sourceFacultyName": source_name,
            "facultyResolutionStatus": resolution.match_method,
            "teachingRole": f.get("teaching_role"),
            "labLead": f.get("lab_lead"),
            "creditedHours": _number(f.get("hours")),
            "doeRate": rate,
            "doeQuantity": qty,
            "doeUnit": f.get("doe_unit"),
            "doeCredit": credit,
            "doeStatus": f.get("doe_status"),
            "sourceRow": row["sourceRow"],
        })

    afc_rows: list[dict[str, Any]] = []
    for row in typed["afc_record_raw.jsonl"]:
        f = row["fields"]
        source_name = f.get("faculty_member")
        if str(source_name or "").strip() in FORMER_FACULTY_EXCLUSIONS:
            issues.append({"code": "AFC_FORMER_FACULTY_EXCLUDED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
            continue
        resolution = resolver.resolve(source_name)
        start = _norm_date(f.get("start"))
        end = _norm_date(f.get("end"))
        purpose = f.get("purpose")
        if not str(source_name or "").strip():
            issues.append({"code": "AFC_FACULTY_MISSING", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"]})
            continue
        if not resolution.resolved:
            issues.append({"code": "AFC_FACULTY_UNRESOLVED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
            continue
        if start and end and end < start:
            issues.append({"code": "AFC_END_BEFORE_START", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name, "start": start, "end": end})
            continue
        if not str(purpose or "").strip():
            issues.append({"code": "AFC_PURPOSE_MISSING", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
        afc_rows.append({
            "afcRecordId": stable_id("afc-record", f"{row['sourceWorkbook']}|{row['sourceRow']}"),
            "facultyId": resolution.faculty_id,
            "facultyDisplayName": resolution.display_name,
            "startDate": start or None,
            "endDate": end or None,
            "purpose": purpose,
            "active": True,
            "sourceRow": row["sourceRow"],
        })

    role_rows: list[dict[str, Any]] = []
    for row in typed["role_assignment_raw.jsonl"]:
        f = row["fields"]
        source_name = f.get("faculty_name")
        if str(source_name or "").strip() in FORMER_FACULTY_EXCLUSIONS:
            issues.append({"code": "ROLE_FORMER_FACULTY_EXCLUDED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
            continue
        resolution = resolver.resolve(source_name)
        if not resolution.resolved:
            issues.append({"code": "ROLE_FACULTY_UNRESOLVED", "sourceSheet": row["sourceSheet"], "sourceRow": row["sourceRow"], "sourceName": source_name})
        rate = _number(f.get("doe_rate_pct_per_unit"))
        qty = _number(f.get("doe_quantity"))
        credit = _number(f.get("doe_credit_pct"))
        if credit is None and rate is not None and qty is not None:
            credit = rate * qty
        role_rows.append({
            "roleAssignmentId": stable_id("role-assignment", f"{row['sourceWorkbook']}|{row['sourceRow']}"),
            "facultyId": resolution.faculty_id,
            "facultyDisplayName": resolution.display_name,
            "sourceFacultyName": source_name,
            "facultyResolutionStatus": resolution.match_method,
            "academicYear": f.get("academic_year"),
            "roleType": f.get("role_type"),
            "courseOrSubjectOrRotation": f.get("course_or_subject_or_rotation"),
            "courseCode": f.get("course"),
            "courseName": f.get("course_name"),
            "details": f.get("details"),
            "effectiveDate": None,
            "expirationDate": None,
            "doeMappedValue": credit,
            "doeOverrideValue": None,
            "doeOverrideReason": None,
            "specialNotes": f.get("notes"),
            "sourceRow": row["sourceRow"],
        })

    doe_rule_rows = []
    for row in typed["doe_rule_raw.jsonl"]:
        f = row["fields"]
        doe_rule_rows.append({
            "doeRuleSeedId": stable_id("doe-rule-seed", f"{row['sourceWorkbook']}|{row['sourceRow']}"),
            **{key: value for key, value in f.items()},
            "sourceRow": row["sourceRow"],
        })

    role_definition_rows = []
    for row in typed["account_role_raw.jsonl"]:
        f = row["fields"]
        role_definition_rows.append({
            "roleDefinitionId": stable_id("role-definition", f.get("database_role")),
            **{key: value for key, value in f.items()},
            "sourceRow": row["sourceRow"],
        })

    outputs = {
        "faculty.jsonl": faculty_rows,
        "faculty_alias.jsonl": alias_rows,
        "faculty_professional_profile.jsonl": profile_rows,
        "joint_appointment.jsonl": joint_rows,
        "course.jsonl": course_rows,
        "session.jsonl": list(sessions_by_key.values()),
        "session_assignment.jsonl": assignment_rows,
        "afc_record.jsonl": afc_rows,
        "role_assignment.jsonl": role_rows,
        "doe_rule_seed.jsonl": doe_rule_rows,
        "role_definition.jsonl": role_definition_rows,
        "validation_issues.jsonl": issues,
    }
    for name, rows in outputs.items():
        _write_jsonl(package_dir / name, rows)

    summary = {
        "typedCounts": {name.removesuffix(".jsonl"): len(rows) for name, rows in typed.items()},
        "normalizedCounts": {name.removesuffix(".jsonl"): len(rows) for name, rows in outputs.items() if name != "validation_issues.jsonl"},
        "validationIssueCount": len(issues),
    }
    (package_dir / "normalization_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary
