#!/usr/bin/env python3
"""Resumable Pomozi.ba full-corpus collector and medical-coding batch runner."""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import html
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import sys

BASE = "https://pomoziba.org"
LIST_URL = f"{BASE}/bs/campaign/api"
COLLECTION_ID = 18
POOLED_TITLES = {"Pomoć oboljelima", "Pomoć oboljelim građanima - Fond za liječenja"}
REQUIRED = set(json.loads((pathlib.Path(__file__).parent / "coding_schema.json").read_text())["properties"]["records"]["items"]["required"])


def atomic_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 medical-charity-research/1.0"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", errors="replace")


def clean(fragment: str) -> str:
    fragment = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", " ", fragment, flags=re.I | re.S)
    fragment = re.sub(r"<br\s*/?>|</p\s*>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    fragment = html.unescape(fragment).replace("\xa0", " ")
    lines = [re.sub(r"\s+", " ", line).strip() for line in fragment.splitlines()]
    return "\n".join(line for line in lines if line)


def parse_money(text: str) -> float | None:
    match = re.search(r"([0-9.]+,[0-9]{2})\s*KM", text)
    return float(match.group(1).replace(".", "").replace(",", ".")) if match else None


def parse_card(item: dict) -> dict:
    fragment = html.unescape(item.get("excerpt") or "")
    link = re.search(r'href="([^"]+)"', fragment)
    title = re.search(r'(?:h-campaign-name|campaign-name)[^>]*>(.*?)</', fragment, flags=re.S)
    figures = re.findall(r"([0-9.]+,[0-9]{2})\s*KM", clean(fragment))
    return {
        "source_id": int(item["id"]),
        "title": clean(title.group(1)) if title else None,
        "url": urllib.parse.urljoin(BASE, link.group(1)) if link else None,
        "status": "completed" if re.search(r">\s*Završena\s*<", fragment) else "active",
        "website_raised_bam": parse_money(figures[0] + " KM") if figures else None,
        "campaign_target_bam": parse_money(figures[1] + " KM") if len(figures) > 1 else None,
    }


def parse_page(card: dict, page: str) -> dict:
    title = re.search(r'<h1[^>]*class="page-title"[^>]*>(.*?)</h1>', page, flags=re.S)
    blocks = re.findall(r'<div class="text-break mx-lg-5(?: mb-4)?">(.*?)</div>', page, flags=re.S)
    narrative = "\n".join(clean(block) for block in blocks if clean(block))
    date_match = re.search(r'<span class="date">\s*([0-3]\d\.[01]\d\.20\d{2})\.?(?:\s+(\d{2}:\d{2}))?', page)
    published = None
    if date_match:
        published = dt.datetime.strptime(f"{date_match.group(1)} {date_match.group(2) or '00:00'}", "%d.%m.%Y %H:%M").isoformat()
    page_text = clean(page)
    donations = re.search(r"Broj donacija:\s*([0-9.]+)", page_text)
    donors = re.search(r"Broj donatora:\s*([0-9.]+)", page_text)
    return {
        **card,
        "title": clean(title.group(1)) if title else card.get("title"),
        "status": "completed" if "Ova kampanja je završena" in page_text else card.get("status"),
        "published_at": published,
        "source_text": narrative,
        "donation_count": int(donations.group(1).replace(".", "")) if donations else None,
        "donor_count": int(donors.group(1).replace(".", "")) if donors else None,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def collect_inventory() -> list[dict]:
    cards: dict[int, dict] = {}
    page = 1
    while True:
        query = urllib.parse.urlencode({"page": page, "sort": "newest", "collection_id": COLLECTION_ID, "per_page": 100})
        payload = json.loads(fetch(f"{LIST_URL}?{query}"))
        data = payload.get("data") or []
        for item in data:
            card = parse_card(item)
            if card["url"] and card["title"] not in POOLED_TITLES:
                cards[card["source_id"]] = card
        meta = payload.get("meta") or {}
        if not data or not meta.get("has_more_pages") or page >= int(meta.get("last_page") or page): break
        page += 1
        time.sleep(0.15)
    return list(cards.values())


def load_json(path: pathlib.Path, default):
    try: return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError): return default


def read_codex_usage() -> dict | None:
    """Read the same fresh allowance snapshot shown in Settings, without exposing auth."""
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
    if not five or not isinstance(five.get("used_percent"), (int, float)):
        return None
    return {
        "five_hour_used_percent": five.get("used_percent"),
        "five_hour_resets_at": five.get("resets_at"),
        "weekly_used_percent": weekly.get("used_percent") if weekly else None,
        "weekly_resets_at": weekly.get("resets_at") if weekly else None,
        "observed_at": snapshot.get("observed_at"),
        "stale": bool(snapshot.get("stale")),
    }


def notify_milestones(state_dir: pathlib.Path, before: int, after: int, total: int) -> list[int]:
    """Send one owner-authorized progress message for each new 100-record mark."""
    token = os.environ.get("APP_TOKEN")
    if not token or after <= before:
        return []
    state_path = state_dir / "milestone-notifications.json"
    state = load_json(state_path, {})
    last = int(state.get("last_notified", (before // 100) * 100))
    milestones = [n for n in range(last + 100, (after // 100) * 100 + 1, 100)]
    sent = []
    base = os.environ.get("API_BASE_URL", "http://localhost:8080").rstrip("/")
    app_id = os.environ.get("APP_ID", "14")
    for milestone in milestones:
        payload = json.dumps({
            "title": f"{milestone} campaign records processed",
            "body": f"Background analysis has coded {milestone} of {total} records. The live Care Gap Observatory remains unchanged.",
            "source_type": "app",
            "source_id": str(app_id),
            "target": f"/shell/?app={app_id}",
            "tag": "care-gap-processing",
        }).encode()
        request = urllib.request.Request(
            f"{base}/api/notifications/send", data=payload, method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                if response.status not in (200, 201, 204):
                    break
        except Exception:
            break
        sent.append(milestone)
        last = milestone
        atomic_json(state_path, {"last_notified": last, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()})
    return sent


def next_batch_size(current: int, usage: dict | None, succeeded: bool) -> int:
    """Use spare five-hour allowance, while bounding one structured output."""
    if not succeeded or not usage or usage.get("stale"):
        return 30
    five = usage.get("five_hour_used_percent")
    weekly = usage.get("weekly_used_percent")
    if not isinstance(five, (int, float)) or (isinstance(weekly, (int, float)) and weekly >= 85):
        return 30
    if five <= 50:
        return 45
    if five <= 70:
        return 40
    if five < 85:
        return 35
    return 30


def fetch_pages(state_dir: pathlib.Path, inventory: list[dict], limit: int) -> int:
    source_dir = state_dir / "source"
    coded_dir = state_dir / "coded"
    source_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for card in inventory:
        if (coded_dir / f"{card['source_id']}.json").exists():
            continue
        path = source_dir / f"{card['source_id']}.json"
        existing = load_json(path, {})
        if existing.get("source_text") or existing.get("terminal_fetch_error"): continue
        if count >= limit: break
        attempts = int(existing.get("fetch_attempts", 0)) + 1
        try:
            row = parse_page(card, fetch(card["url"]))
            row["fetch_attempts"] = attempts
        except Exception as exc:
            row = {**card, "source_text": "", "fetch_attempts": attempts, "fetch_error": str(exc)}
            if attempts >= 3: row["terminal_fetch_error"] = True
        atomic_json(path, row)
        count += 1
        time.sleep(0.08)
    return count


def next_batch(state_dir: pathlib.Path, inventory: list[dict], size: int) -> list[dict]:
    coded_dir = state_dir / "coded"; source_dir = state_dir / "source"
    coded_dir.mkdir(parents=True, exist_ok=True)
    batch = []
    for card in inventory:
        sid = card["source_id"]
        if (coded_dir / f"{sid}.json").exists(): continue
        row = load_json(source_dir / f"{sid}.json", {})
        if not row.get("source_text"): continue
        batch.append(row)
        if len(batch) >= size: break
    return batch


def seed_reviewed_pilot(project_root: pathlib.Path, state_dir: pathlib.Path, inventory: list[dict]) -> int:
    """Reuse the manually reviewed pilot without overwriting later full-corpus work."""
    pilot_path = project_root / "app" / "data" / "cases.json"
    pilot = load_json(pilot_path, [])
    if not isinstance(pilot, list):
        return 0
    valid_ids = {row["source_id"] for row in inventory}
    coded_dir = state_dir / "coded"
    coded_dir.mkdir(parents=True, exist_ok=True)
    seeded = 0
    for row in pilot:
        source_id = row.get("source_id")
        target = coded_dir / f"{source_id}.json"
        if source_id not in valid_ids or target.exists():
            continue
        reused = dict(row)
        reused["campaign_type"] = "individual_medical_case"
        reused["review_required"] = False
        reused["coding_source"] = "manually_reviewed_30_case_pilot"
        provenance = dict(reused.get("field_provenance") or {})
        provenance["campaign_type"] = "inferred"
        reused["field_provenance"] = provenance
        atomic_json(target, reused)
        seeded += 1
    return seeded


def coding_prompt(batch: list[dict]) -> str:
    compact = [{k: row.get(k) for k in ("source_id", "title", "url", "published_at", "status", "campaign_target_bam", "website_raised_bam", "donation_count", "donor_count", "source_text")} for row in batch]
    return """You are coding public medical-charity campaign narratives for descriptive health-services research. Return only JSON matching the supplied schema, with one record for every input source_id and in the same order.

Rules:
- Never invent. Use null/[] and provenance=unknown when the narrative does not state a fact.
- Distinguish explicit source facts from cautious medical/administrative inference. Every substantive field must appear in field_provenance as explicit, inferred, unknown, or derived.
- primary_specialty and diagnosis_group are analyst classifications and normally inferred. Use consistent broad English labels.
- campaign_type must identify individual cases versus pooled funds, institutional/equipment requests, or unclear pages.
- earlier_failure_reason_codes and abroad_reason_codes must be concise snake_case analytical categories grounded in the text; do not infer that care is unavailable domestically unless the text supports that conclusion.
- Treatment cost is the medically quoted total, not automatically the campaign target. available_funding is only money explicitly already available from patient/family/fund/insurer before this campaign.
- Do not treat website_raised_bam as total raised; that figure is merged deterministically later.
- Mark review_required true for contradictions, ambiguous identity/diagnosis, non-individual campaigns, missing narrative, or uncertain money interpretation.
- Do not provide medical advice or judge treatment appropriateness.

INPUT RECORDS:
""" + json.dumps(compact, ensure_ascii=False)


def run_codex(batch: list[dict], schema: pathlib.Path, timeout: int) -> dict:
    executable = shutil.which("codex")
    if not executable: raise RuntimeError("codex CLI unavailable")
    with tempfile.TemporaryDirectory(prefix="care-gap-coding-") as tmp:
        output = pathlib.Path(tmp) / "answer.json"
        cmd = [executable, "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-schema", str(schema), "--output-last-message", str(output), "-"]
        env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "LANG", "LC_ALL", "CODEX_HOME"}}
        proc = subprocess.run(cmd, input=coding_prompt(batch), text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, cwd=tmp, env=env, timeout=timeout)
        if proc.returncode != 0:
            tail = (proc.stderr or "")[-1200:].replace("\n", " ")
            raise RuntimeError(f"codex failed rc={proc.returncode}: {tail}")
        return json.loads(output.read_text())


def validate_and_store(state_dir: pathlib.Path, batch: list[dict], result: dict) -> int:
    records = result.get("records") if isinstance(result, dict) else None
    expected = [row["source_id"] for row in batch]
    if not isinstance(records, list) or [r.get("source_id") for r in records] != expected:
        raise ValueError("model output source_ids or order do not match batch")
    coded_dir = state_dir / "coded"
    for source, coded in zip(batch, records):
        missing = REQUIRED - set(coded)
        if missing: raise ValueError(f"source {source['source_id']} missing fields: {sorted(missing)}")
        merged = {
            **coded,
            "title": source.get("title"), "url": source.get("url"),
            "published_at": source.get("published_at"), "status": source.get("status"),
            "campaign_target_bam": source.get("campaign_target_bam"),
            "requested_campaign_amount_bam": source.get("campaign_target_bam"),
            "website_raised_bam": source.get("website_raised_bam"),
            "donation_count": source.get("donation_count"), "donor_count": source.get("donor_count"),
            "source_text": source.get("source_text"), "collection_date": dt.date.today().isoformat(),
            "charity": "Pomozi.ba",
            "source_scope_note": "Website donation amount covers the website's Doniraj odmah channel only; other channels may not be reflected.",
        }
        atomic_json(coded_dir / f"{source['source_id']}.json", merged)
    return len(records)


def write_progress(state_dir: pathlib.Path, inventory: list[dict], *, last_error: str | None = None, run_details: dict | None = None) -> dict:
    source_dir = state_dir / "source"; coded_dir = state_dir / "coded"
    fetched = sum(1 for c in inventory if load_json(source_dir / f"{c['source_id']}.json", {}).get("source_text"))
    fetch_failed = sum(1 for c in inventory if load_json(source_dir / f"{c['source_id']}.json", {}).get("terminal_fetch_error"))
    coded = sum(1 for c in inventory if (coded_dir / f"{c['source_id']}.json").exists())
    progress = {
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "inventory_total": len(inventory), "pages_fetched": fetched,
        "terminal_fetch_failures": fetch_failed, "records_coded": coded,
        "remaining_to_fetch": max(0, len(inventory) - fetched - fetch_failed - coded),
        "remaining_to_code": max(0, fetched - coded),
        "complete": bool(inventory and coded + fetch_failed == len(inventory)),
        "last_error": last_error,
    }
    previous = load_json(state_dir / "progress.json", {})
    if previous.get("last_processed_case"):
        progress["last_processed_case"] = previous["last_processed_case"]
    if run_details:
        progress.update(run_details)
    atomic_json(state_dir / "progress.json", progress)
    return progress


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=pathlib.Path, required=True)
    parser.add_argument("--fetch-limit", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=30)
    parser.add_argument("--model-timeout", type=int, default=2700)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--refresh-inventory", action="store_true")
    args = parser.parse_args()
    state_dir = args.project_root / "data" / "full-analysis"
    state_dir.mkdir(parents=True, exist_ok=True)
    inventory_path = state_dir / "inventory.json"
    inventory_doc = load_json(inventory_path, {})
    inventory = inventory_doc.get("records") or []
    # Refresh inventory once per day so newly published campaigns can join a
    # still-running corpus without invalidating already-coded source IDs.
    collected = inventory_doc.get("collected_at", "")[:10]
    if args.refresh_inventory or not inventory or collected != dt.date.today().isoformat():
        inventory = collect_inventory()
        atomic_json(inventory_path, {"source": "https://pomoziba.org/bs/lijecenja", "collection_id": COLLECTION_ID, "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(), "records": inventory})
    seeded_now = seed_reviewed_pilot(args.project_root, state_dir, inventory)
    fetched_now = fetch_pages(state_dir, inventory, args.fetch_limit)
    if args.prepare_only:
        print(json.dumps(write_progress(state_dir, inventory), ensure_ascii=False))
        return 0
    usage_before = usage_summary(read_codex_usage())
    coded_before = int(load_json(state_dir / "progress.json", {}).get("records_coded", 0))
    batch = next_batch(state_dir, inventory, args.batch_size)
    if not batch:
        progress = write_progress(state_dir, inventory, run_details={"current_batch_size": args.batch_size, "next_batch_size": 30, "usage_before": usage_before, "usage_after": usage_before})
        print(json.dumps(progress, ensure_ascii=False))
        return 0
    try:
        result = run_codex(batch, pathlib.Path(__file__).parent / "coding_schema.json", args.model_timeout)
        coded_now = validate_and_store(state_dir, batch, result)
        usage_after = usage_summary(read_codex_usage())
        adaptive = next_batch_size(args.batch_size, usage_after, True)
        last = batch[-1]
        last_processed = {key: last.get(key) for key in ("source_id", "title", "url", "published_at")}
        progress = write_progress(state_dir, inventory, run_details={"current_batch_size": args.batch_size, "next_batch_size": adaptive, "usage_before": usage_before, "usage_after": usage_after, "last_processed_case": last_processed, "stopped_reason": None})
        milestones = notify_milestones(state_dir, coded_before, progress["records_coded"], progress["inventory_total"])
        print(json.dumps({**progress, "pilot_records_seeded_this_run": seeded_now, "pages_fetched_this_run": fetched_now, "records_coded_this_run": coded_now, "milestone_notifications_sent": milestones}, ensure_ascii=False))
        return 0
    except Exception as exc:
        usage_after = usage_summary(read_codex_usage())
        message = str(exc)
        limited = any(term in message.lower() for term in ("usage limit", "rate limit", "quota", "resets at"))
        progress = write_progress(state_dir, inventory, last_error=message, run_details={"current_batch_size": args.batch_size, "next_batch_size": 30, "usage_before": usage_before, "usage_after": usage_after, "stopped_reason": "usage_limit" if limited else "batch_error"})
        print(json.dumps(progress, ensure_ascii=False))
        return 10


if __name__ == "__main__":
    raise SystemExit(main())
