#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.benchmark_seed_service import create_benchmark_task, list_benchmark_seeds


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a standalone benchmark task prefilled from a benchmark seed fixture."
    )
    parser.add_argument(
        "--seed-key",
        default="da_te_big_v1",
        help="Benchmark seed key. Use --list-seeds to inspect available keys.",
    )
    parser.add_argument(
        "--task-name",
        default="",
        help="Task name override. Defaults to 基准任务-<seed_key>-<timestamp>.",
    )
    parser.add_argument("--import-template-type", default="", help="Import template path override.")
    parser.add_argument("--export-template-id", default="", help="Export template id override.")
    parser.add_argument("--export-template-name", default="", help="Export template name/path override.")
    parser.add_argument("--source-image", default="", help="Optional source image path; if provided it is copied into uploads and bound to all seed rows.")
    parser.add_argument(
        "--list-seeds",
        action="store_true",
        help="List available benchmark seeds and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.list_seeds:
        seeds = list_benchmark_seeds()
        print(json.dumps({"seeds": seeds}, ensure_ascii=False, indent=2))
        return 0

    result = create_benchmark_task(
        seed_key=args.seed_key,
        task_name=args.task_name,
        import_template_type=args.import_template_type,
        export_template_id=args.export_template_id,
        export_template_name=args.export_template_name,
        source_image_path=args.source_image,
    )
    task = (result or {}).get("task", {}) if isinstance(result, dict) else {}
    payload = {
        "task_id": str(task.get("id", "") or ""),
        "task_name": str(task.get("task_name", "") or ""),
        "seed_key": str((result or {}).get("seed_key", "") or ""),
        "row_count": int((result or {}).get("row_count", 0) or 0),
        "source_image": str((result or {}).get("source_image", "") or ""),
        "source_file_id": str((result or {}).get("source_file_id", "") or ""),
        "workspace_url": f"/workspace/{str(task.get('id', '') or '')}",
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
