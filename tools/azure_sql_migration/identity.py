from __future__ import annotations

import unicodedata
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Any

from .constants import PLACEHOLDERS


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFC", str(value or "")).strip()
    return " ".join(text.split()).casefold()


def normalize_email(value: Any) -> str:
    return str(value or "").strip().casefold()


def parse_preferred_name(value: Any) -> tuple[str, str, str]:
    text = unicodedata.normalize("NFC", str(value or "")).strip()
    if "," not in text:
        raise ValueError(f"Preferred name must be in 'Last, First' form: {text!r}")
    last, first = text.split(",", 1)
    last = " ".join(last.strip().split())
    first = " ".join(first.strip().split())
    if not first or not last:
        raise ValueError(f"Preferred name must include both first and last name: {text!r}")
    return first, last, f"{first}, {last}"


def stable_id(kind: str, key: Any) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://paws.ucalgary.ca/azure-sql/{kind}/{str(key)}"))


@dataclass(frozen=True)
class Resolution:
    resolved: bool
    faculty_id: str | None
    record_type: str | None
    preferred_first_name: str | None
    preferred_last_name: str | None
    display_name: str | None
    preferred_source_name: str | None
    match_method: str


class FacultyResolver:
    def __init__(self, master_rows: list[dict[str, Any]], aliases: dict[str, str] | None = None):
        self.master_rows = []
        self.aliases = aliases or {}
        self.by_ucid: dict[str, dict[str, Any]] = {}
        self.by_email: dict[str, dict[str, Any]] = {}
        self.by_preferred: dict[str, dict[str, Any]] = {}
        hr_keys = [normalize_name(row.get("hr_name")) for row in master_rows if normalize_name(row.get("hr_name"))]
        hr_counts = Counter(hr_keys)
        self.by_hr: dict[str, dict[str, Any]] = {}

        for source in master_rows:
            row = dict(source)
            preferred = str(row.get("preferred_name") or "").strip()
            first, last, display = parse_preferred_name(preferred)
            row.update(
                faculty_id=row.get("faculty_id") or stable_id("faculty", row.get("ucid") or normalize_name(preferred)),
                preferred_first_name=first,
                preferred_last_name=last,
                display_name=display,
                record_type="faculty",
            )
            self.master_rows.append(row)
            if str(row.get("ucid") or "").strip():
                self.by_ucid[str(row["ucid"]).strip()] = row
            if normalize_email(row.get("email")):
                self.by_email[normalize_email(row["email"])] = row
            self.by_preferred[normalize_name(preferred)] = row
            hr = normalize_name(row.get("hr_name"))
            if hr and hr_counts[hr] == 1:
                self.by_hr[hr] = row

        self.alias_targets: dict[str, dict[str, Any]] = {}
        for alias, target in self.aliases.items():
            row = self.by_preferred.get(normalize_name(target))
            if row:
                self.alias_targets[normalize_name(alias)] = row

    @staticmethod
    def _resolution(row: dict[str, Any], method: str) -> Resolution:
        return Resolution(
            resolved=True,
            faculty_id=row["faculty_id"],
            record_type=row["record_type"],
            preferred_first_name=row["preferred_first_name"],
            preferred_last_name=row["preferred_last_name"],
            display_name=row["display_name"],
            preferred_source_name=row.get("preferred_name"),
            match_method=method,
        )

    def resolve(self, source_name: Any, ucid: Any = None, email: Any = None) -> Resolution:
        if str(ucid or "").strip() and str(ucid).strip() in self.by_ucid:
            return self._resolution(self.by_ucid[str(ucid).strip()], "ucid")
        email_key = normalize_email(email)
        if email_key and email_key in self.by_email:
            return self._resolution(self.by_email[email_key], "email")

        source_text = unicodedata.normalize("NFC", str(source_name or "")).strip()
        for label, record_type in PLACEHOLDERS.items():
            if normalize_name(source_text) == normalize_name(label):
                return Resolution(
                    resolved=True,
                    faculty_id=stable_id("placeholder", label),
                    record_type=record_type,
                    preferred_first_name=None,
                    preferred_last_name=None,
                    display_name=label,
                    preferred_source_name=label,
                    match_method="placeholder",
                )

        key = normalize_name(source_text)
        if key in self.by_preferred:
            return self._resolution(self.by_preferred[key], "preferred_name")
        if key in self.by_hr:
            return self._resolution(self.by_hr[key], "hr_name")
        if key in self.alias_targets:
            return self._resolution(self.alias_targets[key], "alias")
        return Resolution(False, None, None, None, None, None, None, "unresolved")
