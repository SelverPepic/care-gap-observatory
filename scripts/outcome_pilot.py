#!/usr/bin/env python3
"""Resumable 60-case calibration of Pomozi.ba Facebook outcome discovery.

This writes a research dataset under the project tree only. It never updates
the live Care Gap Observatory cases file.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request

PILOT_SIZE = 60
CONTROL_SIZE = 12
SOURCE_PAGE = "https://www.facebook.com/pomozi.ba"
YEAR_QUOTAS = {2020: 4, 2021: 5, 2022: 6, 2023: 8, 2024: 9, 2025: 9, 2026: 7}


def atomic_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_json(path: pathlib.Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def stable_key(row: dict) -> str:
    raw = f"care-gap-outcome-pilot-v1:{row.get('record_id')}:{row.get('patient_name')}"
    return hashlib.sha256(raw.encode()).hexdigest()


def representative_pick(rows: list[dict], count: int) -> list[dict]:
    """Deterministically approximate the specialty mix without losing breadth."""
    buckets: dict[str, list[dict]] = {}
    for row in sorted(rows, key=stable_key):
        buckets.setdefault(row.get("policy_specialty_group") or "Unknown", []).append(row)
    ranked = []
    for specialty, bucket in buckets.items():
        for index, row in enumerate(bucket):
            # Evenly spaced quantiles give large specialties proportionally
            # more slots, while the hash tie-break preserves reproducibility.
            ranked.append(((index + 0.5) / len(bucket), stable_key(row), specialty, row))
    return [item[3] for item in sorted(ranked)[:count]]


def create_sample(rows: list[dict]) -> tuple[list[dict], dict]:
    source_counts: dict[int, int] = {}
    for row in rows:
        source_counts[int(row["source_id"])] = source_counts.get(int(row["source_id"]), 0) + 1
    eligible = [r for r in rows if source_counts[int(r["source_id"])] == 1 and r.get("patient_name")]

    known = [r for r in eligible if r.get("treatment_outcome")]
    controls = representative_pick(known, CONTROL_SIZE)
    control_ids = {r["record_id"] for r in controls}

    discovery: list[dict] = []
    used_names = {str(r.get("patient_name") or "").casefold() for r in controls}
    for year, quota in YEAR_QUOTAS.items():
        pool = [
            r for r in eligible
            if not r.get("treatment_outcome")
            and int(str(r.get("published_at"))[:4]) == year
            and str(r.get("patient_name") or "").casefold() not in used_names
        ]
        picks = representative_pick(pool, quota)
        discovery.extend(picks)
        used_names.update(str(r.get("patient_name") or "").casefold() for r in picks)

    sample_rows = controls + discovery
    if len(sample_rows) != PILOT_SIZE:
        raise RuntimeError(f"sample construction produced {len(sample_rows)} records, expected {PILOT_SIZE}")

    def public_row(row: dict) -> dict:
        return {
            "record_id": str(row["record_id"]),
            "source_id": int(row["source_id"]),
            "patient_name": row.get("patient_name"),
            "campaign_title": row.get("title"),
            "campaign_url": row.get("url"),
            "published_at": row.get("published_at"),
            "specialty": row.get("policy_specialty_group") or row.get("primary_specialty"),
            "diagnosis": row.get("main_diagnosis"),
            "location_city": row.get("location_city"),
            "calibration_role": "positive_control" if row["record_id"] in control_ids else "outcome_discovery",
        }

    sample = [public_row(r) for r in sample_rows]
    evaluation = {
        "positive_control_targets": [
            {"record_id": str(r["record_id"]), "existing_website_outcome": r.get("treatment_outcome")}
            for r in controls
        ]
    }
    return sample, evaluation


def read_codex_usage() -> dict | None:
    backend = pathlib.Path(os.environ.get("DATA_DIR", "/data")) / "platform" / "backend"
    try:
        sys.path.insert(0, str(backend))
        from app import provider_usage  # type: ignore
        snapshot = asyncio.run(provider_usage.read_provider_usage("codex", os.environ.get("DATA_DIR", "/data"), force_refresh=True))
        return snapshot if isinstance(snapshot, dict) and snapshot.get("state") == "ready" else None
    except Exception:
        return None


def usage_summary(snapshot: dict | None) -> dict | None:
    if not snapshot:
        return None
    windows = snapshot.get("windows") or []
    five = next((w for w in windows if w.get("label") == "5-hour"), None)
    weekly = next((w for w in windows if w.get("kind") == "weekly"), None)
    return {
        "five_hour_used_percent": five.get("used_percent") if five else None,
        "five_hour_resets_at": five.get("resets_at") if five else None,
        "weekly_used_percent": weekly.get("used_percent") if weekly else None,
        "weekly_resets_at": weekly.get("resets_at") if weekly else None,
        "observed_at": snapshot.get("observed_at"),
        "stale": bool(snapshot.get("stale")),
    }


def prompt(batch: list[dict]) -> str:
    return """You are conducting a calibration study of outcome discovery for public medical-charity campaigns. Use live web search to look only for publicly indexed posts from the official Pomozi.ba Facebook page (facebook.com/pomozi.ba) that can be matched to each input case.

For every case, search by exact patient name (also try an ASCII spelling where useful), campaign title, and Pomozi.ba. Return one result in the same input order.

Strict evidence rules:
- Never infer a clinical outcome from a campaign being marked completed, money being raised, treatment being planned, or a procedure being scheduled.
- A confirmed match needs at least two identity anchors where available: full name, diagnosis/treatment, city, campaign title, relative, or campaign URL context.
- Use confirmed_match only when the indexed source is clearly the same case. Use probable_match_needs_review for ambiguity.
- If Facebook blocks opening a result, search snippets may establish only what they explicitly show. Mark source_inaccessible when a likely post exists but its outcome text cannot be checked.
- no_indexed_evidence means the searches found no relevant indexed official-page post; it does not mean no outcome exists.
- Keep evidence excerpts short (maximum 25 words per post) and include the direct post URL whenever surfaced.
- Dates must be ISO YYYY-MM-DD when known, otherwise null.
- A new donation appeal is a fundraising event, not by itself a clinical deterioration or treatment failure.
- Do not provide medical advice, and do not use similarly named people from other pages.

INPUT CASES:
""" + json.dumps(batch, ensure_ascii=False)


def run_codex(batch: list[dict], schema: pathlib.Path, timeout: int) -> dict:
    executable = shutil.which("codex")
    if not executable:
        raise RuntimeError("codex CLI unavailable")
    with tempfile.TemporaryDirectory(prefix="care-gap-outcomes-") as tmp:
        output = pathlib.Path(tmp) / "answer.json"
        cmd = [executable, "--search", "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-schema", str(schema), "--output-last-message", str(output), "-"]
        env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "LANG", "LC_ALL", "CODEX_HOME"}}
        proc = subprocess.run(cmd, input=prompt(batch), text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, cwd=tmp, env=env, timeout=timeout)
        if proc.returncode != 0:
            tail = (proc.stderr or "")[-1600:].replace("\n", " ")
            raise RuntimeError(f"codex failed rc={proc.returncode}: {tail}")
        return json.loads(output.read_text())


def validate_and_store(state_dir: pathlib.Path, batch: list[dict], result: dict) -> int:
    records = result.get("records") if isinstance(result, dict) else None
    expected = [r["record_id"] for r in batch]
    if not isinstance(records, list) or [r.get("record_id") for r in records] != expected:
        raise ValueError("model output record_ids or order do not match batch")
    results_dir = state_dir / "results"
    for source, coded in zip(batch, records):
        if int(coded.get("source_id", -1)) != int(source["source_id"]):
            raise ValueError(f"source mismatch for record {source['record_id']}")
        merged = {
            **coded,
            "campaign_title": source.get("campaign_title"),
            "campaign_url": source.get("campaign_url"),
            "campaign_published_at": source.get("published_at"),
            "specialty": source.get("specialty"),
            "calibration_role": source.get("calibration_role"),
            "searched_source": SOURCE_PAGE,
            "coded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        atomic_json(results_dir / f"{source['record_id']}.json", merged)
    return len(records)


def summarize(state_dir: pathlib.Path, sample: list[dict], usage_before=None, usage_after=None, error=None) -> dict:
    results = [load_json(state_dir / "results" / f"{r['record_id']}.json", None) for r in sample]
    results = [r for r in results if r]
    statuses: dict[str, int] = {}
    outcomes: dict[str, int] = {}
    for row in results:
        statuses[row["search_status"]] = statuses.get(row["search_status"], 0) + 1
        key = row.get("outcome_category") or "none"
        outcomes[key] = outcomes.get(key, 0) + 1
    summary = {
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "pilot_size": len(sample), "records_completed": len(results),
        "records_remaining": len(sample) - len(results), "complete": len(results) == len(sample),
        "search_status_counts": statuses, "outcome_category_counts": outcomes,
        "outcomes_found": sum(1 for r in results if r.get("outcome_mentioned")),
        "review_required": sum(1 for r in results if r.get("review_required")),
        "usage_before": usage_before, "usage_after": usage_after, "last_error": error,
        "method_note": "Publicly indexed official Pomozi.ba Facebook posts only. Facebook may block direct page reading, so no-index and inaccessible results are preserved as distinct states.",
        "publication_note": "Pilot results are not published to the Care Gap Observatory automatically."
    }
    atomic_json(state_dir / "summary.json", summary)
    return summary


def notify_complete(state_dir: pathlib.Path, summary: dict) -> None:
    marker = state_dir / ".completion-notified"
    token = os.environ.get("APP_TOKEN")
    if marker.exists() or not token:
        return
    body = json.dumps({
        "title": "Facebook outcome pilot complete",
        "body": f"The 60-case calibration found explicit outcome evidence for {summary['outcomes_found']} cases; {summary['review_required']} require review. The live Observatory was not changed.",
        "source_type": "app", "source_id": os.environ.get("APP_ID", "14"),
        "target": f"/shell/?app={os.environ.get('APP_ID', '14')}", "tag": "care-gap-outcome-pilot",
    }).encode()
    request = urllib.request.Request(os.environ.get("API_BASE_URL", "http://localhost:8080").rstrip("/") + "/api/notifications/send", data=body, method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status in (200, 201, 204):
                marker.write_text(dt.datetime.now(dt.timezone.utc).isoformat() + "\n")
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=pathlib.Path, required=True)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--model-timeout", type=int, default=3300)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()

    state_dir = args.project_root / "data" / "outcome-pilot"
    source_path = args.project_root / "data" / "reconciled" / "individual-cases.json"
    rows = load_json(source_path, [])
    if not isinstance(rows, list) or len(rows) < PILOT_SIZE:
        raise RuntimeError("reconciled individual-case corpus is unavailable")

    sample_path = state_dir / "sample.json"
    sample = load_json(sample_path, [])
    if not sample:
        sample, evaluation = create_sample(rows)
        atomic_json(sample_path, sample)
        atomic_json(state_dir / "positive-control-targets.json", evaluation)
        atomic_json(state_dir / "methodology.json", {
            "version": 1, "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": SOURCE_PAGE, "sample_size": PILOT_SIZE, "positive_controls": CONTROL_SIZE,
            "outcome_discovery_cases": PILOT_SIZE - CONTROL_SIZE, "discovery_year_quotas": YEAR_QUOTAS,
            "selection": "Deterministic specialty-spread sample; split-source campaigns excluded.",
            "limitations": ["Facebook may block direct automated reading.", "Search-engine indexing is incomplete and time-varying.", "A campaign record is not necessarily a unique patient.", "No outcome is inferred from campaign completion or fundraising status."]
        })
    if args.prepare_only:
        print(json.dumps(summarize(state_dir, sample), ensure_ascii=False))
        return 0

    pending = [r for r in sample if not (state_dir / "results" / f"{r['record_id']}.json").exists()]
    if not pending:
        done = summarize(state_dir, sample)
        notify_complete(state_dir, done)
        print(json.dumps(done, ensure_ascii=False))
        return 0

    batch = pending[:max(1, min(args.batch_size, 10))]
    before = usage_summary(read_codex_usage())
    try:
        result = run_codex(batch, pathlib.Path(__file__).parent / "outcome_schema.json", args.model_timeout)
        validate_and_store(state_dir, batch, result)
        after = usage_summary(read_codex_usage())
        summary = summarize(state_dir, sample, before, after)
        if summary["complete"]:
            notify_complete(state_dir, summary)
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except Exception as exc:
        after = usage_summary(read_codex_usage())
        print(json.dumps(summarize(state_dir, sample, before, after, str(exc)), ensure_ascii=False))
        return 10


if __name__ == "__main__":
    raise SystemExit(main())
