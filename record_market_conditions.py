#!/usr/bin/env python3
"""Validate, archive and optionally publish a source-backed daily market snapshot.

python record_market_conditions.py --input snapshot.json --deploy
Missing values stay missing. Never infer positioning or gamma from price alone.
"""
import argparse
from datetime import datetime, timezone, date
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import urlopen, Request

HERE = Path(__file__).resolve().parent
SITE = "https://nq-planner.vercel.app"
ARCHIVE = HERE / "market-conditions.json"
NUMBERS = {"mcVixChange", "mcYieldChangeBp", "mcDxyChange", "mcMacroYieldChangeBp", "mcMacroDxyChange", "mcOvernightSoFar", "mcVix", "mcOvernight", "mcOvernightRange", "marketGapPoints", "mcRange",
           "mcPriorRange", "mcGammaFlip", "mcYieldLevel", "mcDxy", "mcAAPL", "mcMSFT", "mcNVDA",
           "mcAMZN", "mcGOOGL", "mcMETA", "mcTSLA"}
ENUMS = {"mcOvernightType": {"Trend up", "Trend down", "Reversal", "Balanced"},
         "mcPositioning": {"Long", "Short", "Balanced", "Crowded longs", "Crowded shorts"},
         "marketType": {"Trend up", "Trend down", "Range", "Reversal", "Choppy"},
         "mcMacro": {"Supportive", "Mixed", "Headwinds"},
         "mcBreadth": {"Broad participation", "Narrow participation", "Narrow / mixed", "Divergent"},
         "mcVol": {"Expanding", "Contracting", "Stable"},
         "mcYields": {"Rising", "Falling", "Flat"},
         "mcDollar": {"Rising", "Falling", "Flat"},
         "mcDirection": {"Up", "Down", "Flat"},
         "mcGamma": {"Long gamma", "Short gamma", "Mixed / near flip", "Unknown"},
         "mcRebalance": {"None confirmed", "Possible", "Confirmed"}}
TEXT = {"mcGammaSource", "mcComment"}
NONNEGATIVE = {"mcGammaFlip", "mcVix", "mcOvernightRange", "mcRange", "mcPriorRange", "mcDxy", "mcYieldLevel"}


def instant(value):
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamps must include their UTC offset")
    return parsed


def validate(snapshot):
    from zoneinfo import ZoneInfo
    day = date.fromisoformat(snapshot["date"]).isoformat()
    recorded = instant(snapshot["recordedAt"])
    if recorded.astimezone(ZoneInfo("America/New_York")).date().isoformat() != day:
        raise ValueError("Recording date must match the New York trading date")
    if recorded.timestamp() > datetime.now(timezone.utc).timestamp() + 60:
        raise ValueError("Recording timestamp is in the future")
    values, sources = snapshot["values"], snapshot["sources"]
    if not isinstance(values, dict) or not isinstance(sources, list):
        raise ValueError("Expected values object and sources list")
    covered = set()
    clean_sources = []
    for source in sources:
        url = urlparse(source["url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("Source must have a public HTTPS URL without credentials")
        observed = instant(source["asOf"])
        if observed > recorded:
            raise ValueError("Source observation cannot be after the recording")
        if observed.astimezone(ZoneInfo("America/New_York")).date().isoformat() != day:
            raise ValueError("Each recorded value must be dated for this New York session")
        fields = source["fields"]
        if not isinstance(fields, list) or not fields or not all(k in values for k in fields):
            raise ValueError("Each source must identify the values it supports")
        covered.update(fields)
        clean_sources.append({"title": str(source["title"])[:180], "url": source["url"],
                              "asOf": source["asOf"], "fields": fields})
    for key, value in values.items():
        if key in NUMBERS:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"Invalid numeric value for {key}")
            if key in NONNEGATIVE and value < 0:
                raise ValueError(f"Negative value not allowed for {key}")
        elif key in ENUMS:
            if value not in ENUMS[key]:
                raise ValueError(f"Unsupported value for {key}")
        elif key in TEXT:
            if not isinstance(value, str) or len(value) > 3000:
                raise ValueError(f"Invalid text for {key}")
        else:
            raise ValueError(f"Unsupported automatic field: {key}")
        if key not in covered and not (key == "mcGamma" and value == "Unknown"):
            raise ValueError(f"No dated source for {key}")
    if values.get("mcGamma") not in (None, "Unknown") and not values.get("mcGammaSource"):
        raise ValueError("A known dealer-gamma regime needs its positioning source")
    return day, {"recordedAt": snapshot["recordedAt"], "values": values, "sources": clean_sources}


def download(name):
    req = Request(f"{SITE}/{name}?daily-recording={datetime.now(timezone.utc).timestamp()}",
                  headers={"User-Agent": "NQPlannerDailyRecorder/1.0"})
    with urlopen(req, timeout=30) as response:
        return response.read()


def record(snapshot, deploy=False):
    day, entry = validate(snapshot)
    archive = json.loads(ARCHIVE.read_text()) if ARCHIVE.exists() else {"version": 1, "days": {}}
    # Prefer live history when available, preserving local records if a prior deploy failed.
    try:
        live = json.loads(download("market-conditions.json"))
    except Exception:
        if deploy:
            raise RuntimeError("Cannot read live history; refusing to overwrite it")
        live = {"days": {}}
    for key, value in live.get("days", {}).items():
        existing = archive["days"].get(key)
        if not existing or instant(value["recordedAt"]) > instant(existing["recordedAt"]):
            archive["days"][key] = value
    existing = archive["days"].get(day)
    if existing and instant(existing["recordedAt"]) > instant(entry["recordedAt"]):
        raise ValueError("Refusing to replace a newer daily record")
    if existing:
        incoming = set(entry["values"])
        retained_sources = []
        for source in existing.get("sources", []):
            fields = [key for key in source["fields"] if key not in incoming]
            if fields:
                retained_sources.append({**source, "fields": fields})
        entry["values"] = {**existing.get("values", {}), **entry["values"]}
        entry["sources"] = retained_sources + entry["sources"]
        validate({"date": day, **entry})
    archive["days"][day] = entry
    archive["updatedAt"] = datetime.now(timezone.utc).isoformat()
    serialized = json.dumps(archive, indent=2, ensure_ascii=False) + "\n"
    temp = ARCHIVE.with_suffix(".json.tmp")
    temp.write_text(serialized, encoding="utf-8")
    temp.replace(ARCHIVE)
    if deploy:
        work = HERE / "work"
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="daily-recording-", dir=work, ignore_cleanup_errors=True) as folder:
            stage = Path(folder)
            assert stage.resolve().is_relative_to(work.resolve())
            # Deploy the actual live UI, rather than replacing it with an older local checkout.
            for name in ["index.html", "data.json", "icon.png", "manifest.json", "robots.txt", "conditions-engine.js", "OUTLOOK_STYLE.md", "RECORDING.md"]:
                (stage / name).write_bytes(download(name))
            (stage / "market-conditions.json").write_text(serialized, encoding="utf-8")
            (stage / ".vercel").mkdir()
            shutil.copy2(HERE / ".vercel" / "project.json", stage / ".vercel" / "project.json")
            command = shutil.which("vercel.cmd") or shutil.which("vercel")
            if not command:
                raise RuntimeError("Vercel CLI not found")
            subprocess.run([command, "deploy", "--prod", "--yes"], cwd=stage, check=True)
        for attempt in range(6):
            published = json.loads(download("market-conditions.json"))
            if published.get("days", {}).get(day) == entry:
                break
            if attempt == 5:
                raise RuntimeError("Published daily snapshot did not pass verification after alias propagation")
            time.sleep(2)
        # Persist the public archive in Git so a subsequent calendar push keeps it.
        # Never push a Git UI that differs from what is live, or include another task's staged work.
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=HERE).returncode:
            raise RuntimeError("Snapshot is live, but Git has other staged work; archive was not committed")
        for name in ["index.html", "data.json", "icon.png", "manifest.json", "robots.txt", "conditions-engine.js", "OUTLOOK_STYLE.md", "RECORDING.md"]:
            head = subprocess.check_output(["git", "show", "HEAD:" + name], cwd=HERE)
            if head.replace(b"\r\n", b"\n") != download(name).replace(b"\r\n", b"\n"):
                raise RuntimeError("Snapshot is live, but Git and live site differ; refusing a push that could roll back the UI")
        subprocess.run(["git", "add", "--", "market-conditions.json"], cwd=HERE, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=HERE).returncode:
            subprocess.run(["git", "commit", "-m", f"Record sourced market conditions for {day}"], cwd=HERE, check=True)
            subprocess.run(["git", "push", "origin", "main"], cwd=HERE, check=True)
    print(f"{'Published and verified' if deploy else 'Recorded locally'} {day}: {len(entry['values'])} sourced fields")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    snapshot = json.loads(args.input.read_text(encoding="utf-8-sig"))
    if args.validate_only:
        validate(snapshot)
        print("Snapshot validation passed")
    else:
        record(snapshot, args.deploy)
