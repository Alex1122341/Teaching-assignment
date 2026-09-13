"""Plan and apply the UCVM Firestore storage/index optimization.

The input is a typed export produced by export_firestore_rest.py. Dry-run is
offline. Apply mode rechecks the backup hash before writing and sends bounded
Firestore REST commits. Reports contain counts and paths, never field values.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sys
import unicodedata
import urllib.parse
import uuid

from export_firestore_rest import API_ROOT, cli_token, request_json

SESSION_REMOVE = {"sourceWorkbook", "sourceSchema", "sourceCourseTypes", "bulkImportedAt", "bulkImportedBy"}
FACULTY_METADATA_REMOVE = {
    "specialtySearchText", "sourceKeyRow", "doeImportedAt", "doeImportedBy",
    "doeImportedByName", "doeSourceYear", "teachingDoeModelImportedAt",
    "teachingDoeModelImportedBy", "teachingDoeModelImportedByName",
}
DOE_COMPATIBILITY = {
    "doeTeaching": "teaching", "doeResearch": "research", "doeServiceAdmin": "serviceAdmin",
    "doeFte": "fte", "doeTotalContractFTE": "totalContractFTE",
    "doeContractFteMatches": "contractFteMatches", "doeRotationIntenseFieldPathology": "rotationIntenseFieldPathology",
    "doeRotationClinical": "rotationClinical", "doeClinicalTimeNoStudent": "clinicalTimeNoStudent",
    "doeClinicalActivityPPVM": "clinicalActivityPPVM", "doeScholarlyActivity": "scholarlyActivity",
    "doeOtherDiagnostic": "otherDiagnostic", "doeOnboarding": "onboarding",
    "doeClinicalTeaching": "clinicalTeaching", "doeServiceCommitments": "serviceCommitments",
}
MARKER = "settings/migrations_assigned_ad_removed"


def decode(value):
    if not isinstance(value, dict):
        return value
    if "nullValue" in value: return None
    if "booleanValue" in value: return value["booleanValue"]
    if "integerValue" in value: return int(value["integerValue"])
    if "doubleValue" in value: return value["doubleValue"]
    if "stringValue" in value: return value["stringValue"]
    if "timestampValue" in value: return value["timestampValue"]
    if "referenceValue" in value: return value["referenceValue"]
    if "bytesValue" in value: return value["bytesValue"]
    if "geoPointValue" in value: return value["geoPointValue"]
    if "arrayValue" in value: return [decode(x) for x in value["arrayValue"].get("values", [])]
    if "mapValue" in value: return {k: decode(v) for k, v in value["mapValue"].get("fields", {}).items()}
    raise ValueError(f"Unsupported Firestore value type: {list(value)}")


def encode(value):
    if value is None: return {"nullValue": None}
    if isinstance(value, bool): return {"booleanValue": value}
    if isinstance(value, int): return {"integerValue": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError("Non-finite number")
        return {"doubleValue": value}
    if isinstance(value, str): return {"stringValue": value}
    if isinstance(value, list): return {"arrayValue": {"values": [encode(x) for x in value]}}
    if isinstance(value, dict): return {"mapValue": {"fields": {k: encode(v) for k, v in value.items()}}}
    raise TypeError(type(value).__name__)


def decoded_fields(document):
    return {k: decode(v) for k, v in document.get("fields", {}).items()}


def equal_value(left, right):
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(float(left), float(right), rel_tol=0, abs_tol=1e-9)
    return left == right


def text(value): return str(value or "").strip()


def faculty_ids(session):
    ids = {text(x) for x in session.get("facultyIds", []) if text(x)}
    for assignment in session.get("assignments", []) if isinstance(session.get("assignments"), list) else []:
        if isinstance(assignment, dict):
            value = text(assignment.get("ucid") or assignment.get("facultyId"))
            if value: ids.add(value)
    return sorted(ids)


def primitives(value, out):
    if value is None: return
    if isinstance(value, dict):
        for child in value.values(): primitives(child, out)
    elif isinstance(value, list):
        for child in value: primitives(child, out)
    elif isinstance(value, (str, int, float, bool)):
        item = text(value)
        if item: out.append(item)


def search_text(faculty):
    summary, workload = faculty.get("facultySummary2026_27") or {}, faculty.get("workloadPolicy2026_27") or {}
    values = [faculty.get(k) for k in ("preferredFullName", "hrFullName", "hrFirstLast", "teachingAssignmentName", "ucid", "email", "rank", "currentTitle", "appointmentType", "campus", "primaryDepartment", "department", "reportsTo", "teachingArea", "teachingAreaEmphasis", "boardSpecialties", "boardCertification", "awayFromCampusRecords")]
    values += [summary.get(k) for k in ("displayName", "traineeSummary", "specialProjectText", "roles")]
    values += [workload.get(k) for k in ("credits", "trainee")]
    flat = []
    primitives(values, flat)
    normalized = {unicodedata.normalize("NFKD", x).lower() for x in flat}
    return " ".join(sorted(normalized))


def number(value):
    if value is None or value == "": return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError): return None


def build_settings(faculty_rows, sessions):
    per_faculty = {}
    courses = {}
    assigned = set()
    for session in sessions:
        course = text(session.get("course"))
        if course: courses[course] = courses.get(course, 0) + 1
        for fid in faculty_ids(session): assigned.add(fid)
        for assignment in session.get("assignments", []) if isinstance(session.get("assignments"), list) else []:
            if not isinstance(assignment, dict): continue
            fid = text(assignment.get("ucid") or assignment.get("facultyId"))
            if not fid: continue
            row = per_faculty.setdefault(fid, {"count": 0, "doe": 0.0})
            row["count"] += 1
            row["doe"] += number(assignment.get("doeCredit")) or 0
    entries = []
    for fid, faculty in faculty_rows:
        summary = faculty.get("facultySummary2026_27") if isinstance(faculty.get("facultySummary2026_27"), dict) else None
        workload = faculty.get("workloadPolicy2026_27")
        stats = per_faculty.get(fid, {"count": 0, "doe": 0.0})
        fixed = number((summary or {}).get("sourceNonTimetableTeachingDOE")); source = number((summary or {}).get("assignedTeachingDOE"))
        assigned_doe = fixed + stats["doe"] if fixed is not None else (source if source is not None else stats["doe"])
        override = faculty.get("doeOverride2026_27")
        override_value = number(override.get("value")) if isinstance(override, dict) else number(override)
        roles = (summary or {}).get("roles", []) if isinstance((summary or {}).get("roles", []), list) else []
        doe = faculty.get("doe") if isinstance(faculty.get("doe"), dict) else {}
        contract = next((number(x) for x in (doe.get("teaching"), faculty.get("doeTeaching"), faculty.get("teachingDOE"), faculty.get("contractTeachingDOE")) if number(x) is not None), None)
        afc = faculty.get("awayFromCampusRecords") if isinstance(faculty.get("awayFromCampusRecords"), list) else []
        entries.append({"id": fid, "name": text(faculty.get("preferredFullName") or faculty.get("hrFirstLast") or faculty.get("hrFullName") or faculty.get("teachingAssignmentName") or fid), "hrName": text(faculty.get("hrFullName")), "email": text(faculty.get("email")), "rank": text(faculty.get("rank") or faculty.get("currentTitle")), "appointmentType": text(faculty.get("appointmentType")), "campus": text(faculty.get("campus")), "department": text(faculty.get("primaryDepartment") or faculty.get("department")), "specialty": text(faculty.get("teachingArea") or faculty.get("teachingAreaEmphasis") or faculty.get("boardSpecialties")), "reportsTo": text(faculty.get("reportsTo")), "active": faculty.get("active") is not False, "status": text(faculty.get("status") or "current"), "contractTeachingDOE": contract, "assignedTeachingDOE": round(assigned_doe, 6) if assigned_doe is not None else None, "overrideDOE": override_value, "overrideReason": text(override.get("reason")) if isinstance(override, dict) else "", "sessionCount": stats["count"], "hasSummary": summary is not None, "hasWorkload": isinstance(workload, dict), "roleTypes": sorted({text(r.get("type")) for r in roles if isinstance(r, dict) and text(r.get("type"))}), "afcRecordCount": len(afc), "searchText": search_text(faculty)})
    entries.sort(key=lambda x: (x["name"].casefold(), x["id"]))
    return {"faculty_index": {"schemaVersion": "ucvm-faculty-index-v1", "entries": entries}, "schedule_stats": {"sessionCount": len(sessions), "assignedFacultyCount": len(assigned), "courseCounts": {k: courses[k] for k in sorted(courses)}}}


def plan_cleanup(export_data):
    documents = export_data.get("documents", [])
    updates, deletes, faculty_rows, sessions = [], [], [], []
    report = {"sessionsChanged": 0, "sessionFacultyIdsBackfilled": 0, "sessionFieldsDeleted": 0, "facultyChanged": 0, "facultyMetadataDeleted": 0, "doeFieldsDeleted": 0, "doeMismatches": 0, "completedMarkersDeleted": 0, "settingsDocumentsWritten": 2, "preservedDocumentPaths": []}
    for document in documents:
        path, fields = document["path"], decoded_fields(document)
        if path == MARKER:
            deletes.append(path); report["completedMarkersDeleted"] += 1; continue
        if path.startswith(("account_audit/", "faculty_change_log/", "session_change_log/", "afc_audit/", "change_requests/", "afc_requests/")):
            report["preservedDocumentPaths"].append(path)
        if document.get("topLevelCollection") == "sessions":
            sessions.append(fields)
            set_fields, remove = {}, sorted(SESSION_REMOVE & fields.keys())
            if fields.get("id") == document.get("documentId"): remove.append("id")
            ids = faculty_ids(fields)
            if fields.get("facultyIds") != ids: set_fields["facultyIds"] = ids; report["sessionFacultyIdsBackfilled"] += 1
            if set_fields or remove:
                updates.append({"path": path, "set": set_fields, "delete": sorted(set(remove))});report["sessionsChanged"] += 1;report["sessionFieldsDeleted"] += len(set(remove))
        elif document.get("topLevelCollection") == "faculty":
            faculty_rows.append((document.get("documentId"), fields)); remove = set(FACULTY_METADATA_REMOVE & fields.keys());doe = fields.get("doe") if isinstance(fields.get("doe"), dict) else {}
            for flat, canonical in DOE_COMPATIBILITY.items():
                if flat not in fields: continue
                if canonical in doe and equal_value(fields[flat], doe[canonical]): remove.add(flat);report["doeFieldsDeleted"] += 1
                elif canonical in doe: report["doeMismatches"] += 1
            if remove: updates.append({"path": path, "set": {}, "delete": sorted(remove)});report["facultyChanged"] += 1;report["facultyMetadataDeleted"] += len(remove) - sum(1 for x in remove if x in DOE_COMPATIBILITY)
    settings = build_settings(faculty_rows, sessions)
    report["documentWrites"] = len(updates) + len(deletes) + len(settings)
    report["sourceDocumentCount"] = len(documents)
    return {"updates": updates, "deletes": deletes, "settings": settings, "report": report}


def apply_plan_locally(export_data, plan):
    by_path = {d["path"]: d for d in export_data.get("documents", [])}
    for path in plan["deletes"]: by_path.pop(path, None)
    for change in plan["updates"]:
        document = by_path[change["path"]]
        for key in change["delete"]: document["fields"].pop(key, None)
        for key, value in change["set"].items(): document["fields"][key] = encode(value)
    for key, value in plan["settings"].items():
        path = f"settings/{key}"
        by_path[path] = {"path": path, "collectionPath": "settings", "documentId": key, "topLevelCollection": "settings", "fields": {k: encode(v) for k, v in value.items()}}
    export_data["documents"] = sorted(by_path.values(), key=lambda d: d["path"])


def firestore_writes(project, plan, actor_uid, actor_name):
    base = f"projects/{project}/databases/(default)/documents/"
    writes = []
    for change in plan["updates"]:
        writes.append({"update": {"name": base + change["path"], "fields": {k: encode(v) for k, v in change["set"].items()}}, "updateMask": {"fieldPaths": sorted(set(change["set"]) | set(change["delete"]))}, "currentDocument": {"exists": True}})
    for path in plan["deletes"]: writes.append({"delete": base + path, "currentDocument": {"exists": True}})
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    for key, value in plan["settings"].items():
        fields = {**value, "generatedBy": actor_uid, "generatedByName": actor_name}
        encoded = {k: encode(v) for k, v in fields.items()};encoded["generatedAt"] = {"timestampValue": now}
        writes.append({"update": {"name": base + f"settings/{key}", "fields": encoded}})
    audit_id = uuid.uuid4().hex
    audit = {"action": "firestore_performance_cleanup", "sourceDocumentCount": plan["report"]["sourceDocumentCount"], "documentWrites": plan["report"]["documentWrites"], "sessionFieldsDeleted": plan["report"]["sessionFieldsDeleted"], "facultyMetadataDeleted": plan["report"]["facultyMetadataDeleted"], "doeFieldsDeleted": plan["report"]["doeFieldsDeleted"], "doeMismatchesPreserved": plan["report"]["doeMismatches"], "changedBy": actor_uid, "changedByName": actor_name, "changedAt": now}
    writes.append({"update": {"name": base + f"account_audit/{audit_id}", "fields": {k: ({"timestampValue": v} if k == "changedAt" else encode(v)) for k, v in audit.items()}}, "currentDocument": {"exists": False}})
    return writes


def commit(project, writes):
    token = cli_token();url = f"{API_ROOT}/projects/{project}/databases/(default)/documents:commit"
    for offset in range(0, len(writes), 300): request_json(token, url, {"writes": writes[offset:offset + 300]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True);parser.add_argument("--backup", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True);mode.add_argument("--dry-run", action="store_true");mode.add_argument("--apply", action="store_true")
    parser.add_argument("--actor-uid");parser.add_argument("--actor-name");parser.add_argument("--report", type=Path)
    args = parser.parse_args();raw = args.backup.resolve().read_bytes();digest = hashlib.sha256(raw).hexdigest();data = json.loads(raw)
    if data.get("format") != "firestore-rest-typed-v1" or data.get("sourceProject") != args.project: raise SystemExit("Backup format or sourceProject does not match the requested project.")
    plan = plan_cleanup(data);report = {**plan["report"], "project": args.project, "backupSha256": digest, "mode": "apply" if args.apply else "dry-run"}
    if args.apply:
        if not args.actor_uid or not args.actor_name: raise SystemExit("--apply requires --actor-uid and --actor-name")
        if hashlib.sha256(args.backup.resolve().read_bytes()).hexdigest() != digest: raise SystemExit("Backup changed after validation.")
        writes = firestore_writes(args.project, plan, args.actor_uid, args.actor_name);commit(args.project, writes);report["committedWrites"] = len(writes)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report: args.report.resolve().write_text(output + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__": sys.exit(main())
