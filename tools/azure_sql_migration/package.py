from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .workbooks import WorkbookRecord, inspect_workbook

FORMAT = "paws-azure-sql-import-v1"


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _source_manifest_core(records: list[WorkbookRecord]) -> dict:
    files = []
    for record in sorted(records, key=lambda item: item.file_name.casefold()):
        files.append(
            {
                "fileName": record.file_name,
                "fileSha256": record.file_sha256,
                "fileByteLength": record.file_byte_length,
                "sheets": sorted(record.sheets, key=lambda item: item["sheetIndex"]),
            }
        )
    return {
        "format": FORMAT,
        "files": files,
        "totals": {"nonEmptyRows": sum(len(record.rows) for record in records)},
    }


def _source_manifest_sha(core: dict) -> str:
    return hashlib.sha256(_canonical_json(core).encode("utf-8")).hexdigest()


def _write_jsonl(path: Path, rows) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(_canonical_json(row))
            handle.write("\n")


def build_package(workbook_paths: Iterable[str | Path], output_root: str | Path) -> Path:
    records = [inspect_workbook(path) for path in workbook_paths]
    core = _source_manifest_core(records)
    manifest_sha = _source_manifest_sha(core)
    output_root = Path(output_root).resolve()
    package_dir = output_root / manifest_sha
    package_dir.mkdir(parents=True, exist_ok=True)

    raw_rows = [row for record in records for row in record.rows]
    _write_jsonl(package_dir / "raw_rows.jsonl", raw_rows)

    manifest = {
        **core,
        "sourceManifestSha256": manifest_sha,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (package_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )

    from .normalize import normalize_package
    summary = normalize_package(package_dir)
    manifest.update(summary)
    (package_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return package_dir
