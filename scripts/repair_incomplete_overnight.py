#!/usr/bin/env python3
"""Reclassify archived Yahoo overnight ranges that excluded ten traded minutes.

The old collector admitted that 23:59–00:08 NY bars were empty, but still
stored the observed high–low as an exact range. Keep the dated observations as
lower bounds; do not infer a complete range or London-vs-Asia comparison.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "market-conditions.json"
sys.path.insert(0, str(ROOT))
from record_market_conditions import validate
BAD_GAP = "range excludes the provider's empty 23:59-00:08 bars"
DERIVED = {
    "mcOvernightRange", "mcOvernightType", "mcOvernightOpen",
    "mcOvernightHigh", "mcOvernightLow", "mcOvernightClose",
    "mcOvernightHighMin", "mcOvernightLowMin", "mcLondonHigh",
    "mcLondonLow", "mcLondonAsiaHigh", "mcLondonAsiaLow",
    "mcLondonTook", "mcLondonThrough",
}


def correct_archive(archive):
    corrected = 0
    for day, entry in archive["days"].items():
        old = next((source for source in entry["sources"]
                    if BAD_GAP in source["title"] and
                    "mcOvernightRange" in source["fields"]), None)
        if old is None:
            continue
        values = entry["values"]
        old_range = values.get("mcOvernightRange")
        high, low = values.get("mcOvernightHigh"), values.get("mcOvernightLow")
        if not isinstance(old_range, (int, float)) or not isinstance(high, (int, float)) or not isinstance(low, (int, float)):
            raise ValueError(f"{day}: excluded-bar source lacks the observed range/high/low")
        if round(high - low, 2) != round(old_range, 2):
            raise ValueError(f"{day}: archived extrema do not support the lower bound")

        values["mcOvernightRangeMin"] = old_range
        for field in DERIVED:
            values.pop(field, None)
        comment = values.get("mcComment", "")
        if "overnight range was" in comment:
            # The following sentence declared an incomplete range below the
            # 500-point threshold. Preserve the sourced news context before it.
            cut = comment.find(" NQ's ")
            if cut < 0:
                raise ValueError(f"{day}: cannot safely remove outdated range prose")
            values["mcComment"] = comment[:cut].strip()

        clean = []
        for source in entry["sources"]:
            fields = [field for field in source["fields"] if field in values]
            if source is old:
                # The endpoint net has an independently sourced 18:00-open to
                # 01:59-close record. Do not retain the misleading gap source.
                fields = [field for field in fields if field != "mcOvernight"]
            if "Same-contract NQ completed overnight" in source["title"]:
                fields = [field for field in fields if field != "mcComment"]
            if fields:
                clean.append({**source, "fields": fields})
        clean.append({
            "title": (f"NQZ26.CME observed 18:00-02:00 NY high-low lower bound; "
                      f"{high} high, {low} low; 23:59-00:08 bars missing; "
                      "archive correction of formerly overstated coverage"),
            "url": old["url"], "asOf": old["asOf"],
            "fields": ["mcOvernightRangeMin"],
        })
        entry["sources"] = clean
        validate({"date": day, **entry})
        corrected += 1
    if corrected:
        archive["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return corrected


if __name__ == "__main__":
    archive = json.loads(ARCHIVE.read_text(encoding="utf-8"))
    count = correct_archive(archive)
    if count:
        ARCHIVE.write_text(json.dumps(archive, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Reclassified {count} incomplete historical overnight ranges")
