from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import time
from pathlib import Path
from typing import Any, Mapping, Sequence


FORMAT = "paws-session-time-corrections-v1"
DEFAULT_MANIFEST_PATH = Path(__file__).with_name("session_time_corrections.json")
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_REQUIRED_FIELDS = {
    "sessionId",
    "oldStart",
    "oldEnd",
    "newStart",
    "newEnd",
    "source",
    "sourceDate",
    "sourceCourse",
    "sourceTopic",
    "sourceMatchMethod",
}


class CorrectionManifestError(ValueError):
    """Raised when a correction manifest cannot be applied safely."""


def canonical_time(value: Any, *, field: str) -> str:
    match = _TIME_RE.fullmatch(str(value or "").strip())
    if not match:
        raise CorrectionManifestError(f"{field} must be HH:MM or HH:MM:SS")
    hour, minute, second = (int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))
    try:
        parsed = time(hour, minute, second)
    except ValueError as exc:
        raise CorrectionManifestError(f"{field} is not a valid clock time") from exc
    return parsed.strftime("%H:%M:%S")


def _seconds(value: str) -> int:
    hour, minute, second = (int(part) for part in value.split(":"))
    return hour * 3600 + minute * 60 + second


def load_correction_manifest(path: str | Path = DEFAULT_MANIFEST_PATH) -> dict[str, dict[str, Any]]:
    path = Path(path)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CorrectionManifestError(f"unable to read correction manifest {path}: {exc}") from exc
    if not isinstance(document, dict) or document.get("format") != FORMAT:
        raise CorrectionManifestError(f"correction manifest format must be {FORMAT}")
    entries = document.get("corrections")
    if not isinstance(entries, list):
        raise CorrectionManifestError("corrections must be an array")

    result: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(entries, start=1):
        if not isinstance(raw, dict):
            raise CorrectionManifestError(f"correction {index} must be an object")
        missing = sorted(_REQUIRED_FIELDS.difference(raw))
        if missing:
            raise CorrectionManifestError(f"correction {index} missing fields: {', '.join(missing)}")
        session_id = str(raw["sessionId"]).strip().lower()
        if not session_id:
            raise CorrectionManifestError(f"correction {index} has an empty SessionId")
        if session_id in result:
            raise CorrectionManifestError(f"duplicate SessionId in correction manifest: {session_id}")
        entry = deepcopy(raw)
        entry["sessionId"] = session_id
        for field in ("oldStart", "oldEnd", "newStart", "newEnd"):
            entry[field] = canonical_time(entry[field], field=f"correction {index} {field}")
        if _seconds(entry["newStart"]) >= _seconds(entry["newEnd"]):
            raise CorrectionManifestError(f"correction {index} new interval must have newStart before newEnd")
        if (entry["oldStart"], entry["oldEnd"]) == (entry["newStart"], entry["newEnd"]):
            raise CorrectionManifestError(f"correction {index} does not change the interval")
        for field in ("source", "sourceDate", "sourceCourse", "sourceTopic", "sourceMatchMethod"):
            if not str(entry[field] or "").strip():
                raise CorrectionManifestError(f"correction {index} {field} must not be empty")
        result[session_id] = entry
    return result


def apply_corrections(
    sessions: Sequence[Mapping[str, Any]],
    corrections: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    corrected: list[dict[str, Any]] = []
    consumed: set[str] = set()
    seen_sessions: set[str] = set()

    for source_row in sessions:
        row = deepcopy(dict(source_row))
        session_id = str(row.get("sessionId") or "").strip().lower()
        if not session_id:
            raise CorrectionManifestError("normalized session has no SessionId")
        if session_id in seen_sessions:
            raise CorrectionManifestError(f"normalized sessions contain duplicate SessionId: {session_id}")
        seen_sessions.add(session_id)
        entry = corrections.get(session_id)
        if entry is not None:
            current = (
                canonical_time(row.get("start"), field=f"session {session_id} start"),
                canonical_time(row.get("end"), field=f"session {session_id} end"),
            )
            expected = (str(entry["oldStart"]), str(entry["oldEnd"]))
            if current != expected:
                raise CorrectionManifestError(
                    f"old time mismatch for SessionId {session_id}: expected {expected[0]}-{expected[1]}, "
                    f"found {current[0]}-{current[1]}"
                )
            row["start"] = str(entry["newStart"])
            row["end"] = str(entry["newEnd"])
            consumed.add(session_id)
        corrected.append(row)

    unknown = sorted(set(corrections).difference(consumed))
    if unknown:
        raise CorrectionManifestError(f"correction references unknown SessionId(s): {', '.join(unknown)}")
    return corrected

