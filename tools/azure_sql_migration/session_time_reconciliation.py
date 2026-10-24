from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from copy import deepcopy
from typing import Any, Iterable, Mapping

from .session_time_corrections import canonical_time


_TYPE_ALIASES = {
    "lecture": "lec",
    "lec": "lec",
    "lab": "lab",
    "laboratory": "lab",
    "srl": "srl",
    "quiz/midterm": "quiz/midterm",
    "quiz-midterm": "quiz/midterm",
    "osce": "osce",
}


def normalize_topic(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(str.maketrans({"–": "-", "—": "-", "−": "-", "“": '"', "”": '"', "’": "'"}))
    text = text.strip().strip('"').strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*-\s*", "-", text)
    return text.casefold()


def normalize_session_type(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).casefold()
    return _TYPE_ALIASES.get(text, text)


def _match_key(row: Mapping[str, Any], *, source: bool) -> tuple[str, str, str, str]:
    topic_field = "TimetableTopic" if source else "PAWS_Topic"
    return (
        str(row.get("Date") or "").strip()[:10],
        str(row.get("CourseCode") or "").strip(),
        normalize_session_type(row.get("SessionType")),
        normalize_topic(row.get(topic_field)),
    )


def _time(value: Any, field: str) -> str:
    return canonical_time(value, field=field)


def _seconds(value: str) -> int:
    h, m, s = (int(part) for part in value.split(":"))
    return h * 3600 + m * 60 + s


def _is_positionable(start: str, end: str) -> bool:
    return _seconds(start) >= 7 * 3600 + 30 * 60 and _seconds(end) <= 17 * 3600 and _seconds(start) < _seconds(end)


def reconcile_sessions(
    current_sessions: Iterable[Mapping[str, Any]],
    timetable_sessions: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    current_rows = [dict(row) for row in current_sessions]
    current_index: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in current_rows:
        current_index[_match_key(row, source=False)].append(row)

    source_index: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in timetable_sessions:
        normalized = dict(row)
        normalized["TimetableStart"] = _time(normalized.get("TimetableStart"), "TimetableStart")
        normalized["TimetableEnd"] = _time(normalized.get("TimetableEnd"), "TimetableEnd")
        key = _match_key(normalized, source=True)
        interval = (normalized["TimetableStart"], normalized["TimetableEnd"])
        if not any((item["TimetableStart"], item["TimetableEnd"]) == interval for item in source_index[key]):
            source_index[key].append(normalized)

    results: list[dict[str, Any]] = []
    for current in current_rows:
        row = deepcopy(dict(current))
        start = _time(row.get("CurrentStart"), "CurrentStart")
        end = _time(row.get("CurrentEnd"), "CurrentEnd")
        row["CurrentStart"] = start
        row["CurrentEnd"] = end
        key = _match_key(row, source=False)
        matches = source_index.get(key, [])
        row.update({
            "TimetableMatched": "NO",
            "TimetableTopic": "",
            "TimetableStart": "",
            "TimetableEnd": "",
            "MatchMethod": "none",
            "Confidence": "0.00",
            "CorrectionRequired": "NO",
            "ProposedStart": start,
            "ProposedEnd": end,
            "Classification": "NO_TIMETABLE_MATCH",
            "Evidence": "No exact normalized date/course/type/topic match",
        })
        if len(current_index[key]) > 1 and matches:
            row["TimetableMatched"] = "AMBIGUOUS"
            row["MatchMethod"] = "exact-key-multiple-current"
            row["Classification"] = "SOURCE_AMBIGUOUS"
            row["Evidence"] = f"{len(current_index[key])} current sessions share one authoritative semantic key"
        elif len(matches) > 1:
            row["TimetableMatched"] = "AMBIGUOUS"
            row["MatchMethod"] = "exact-key-multiple"
            row["Classification"] = "MULTIPLE_TIMETABLE_MATCHES"
            row["Evidence"] = f"{len(matches)} authoritative timetable rows share the exact normalized key"
        elif len(matches) == 1:
            match = matches[0]
            source_start = _time(match.get("TimetableStart"), "TimetableStart")
            source_end = _time(match.get("TimetableEnd"), "TimetableEnd")
            row.update({
                "TimetableMatched": "YES",
                "TimetableTopic": str(match.get("TimetableTopic") or ""),
                "TimetableStart": source_start,
                "TimetableEnd": source_end,
                "MatchMethod": "exact-date-course-type-topic",
                "Confidence": "1.00",
                "ProposedStart": source_start,
                "ProposedEnd": source_end,
                "Evidence": "Unique exact controlled-normalization match to authoritative timetable",
            })
            if _seconds(source_start) >= _seconds(source_end):
                row["Classification"] = "OTHER_DATA_DEFECT"
                row["CorrectionRequired"] = "NO"
                row["ProposedStart"] = start
                row["ProposedEnd"] = end
                row["Evidence"] = "Authoritative timetable interval is not forward"
            elif (start, end) == (source_start, source_end):
                row["Classification"] = "MATCH_ALREADY_CORRECT" if _is_positionable(start, end) else "LEGITIMATE_OUT_OF_WINDOW"
            else:
                row["CorrectionRequired"] = "YES"
                row["Classification"] = (
                    "UNKNOWN_TIME_CONFIRMED_BY_TIMETABLE"
                    if (start, end) == ("00:00:00", "00:00:00")
                    else "DETERMINISTIC_TIME_CORRECTION"
                )
        results.append(row)
    return results
