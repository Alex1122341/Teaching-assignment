from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.azure_sql_migration.package import build_package


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a private PAWS Azure SQL import package.")
    parser.add_argument("--workload", required=True)
    parser.add_argument("--afc", required=True)
    parser.add_argument("--faculty", required=True)
    parser.add_argument("--output-root", required=True)
    args = parser.parse_args()

    package = build_package(
        [Path(args.workload), Path(args.afc), Path(args.faculty)],
        Path(args.output_root),
    )
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    print(json.dumps({"packagePath": str(package), "sourceManifestSha256": manifest["sourceManifestSha256"], "totals": manifest["totals"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
