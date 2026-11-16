"""The saved overnight rule uses the 18:00–02:00 New York window."""
import unittest
from datetime import datetime, timedelta

from collect_market_conditions import NY, build, instant
from record_market_conditions import validate


class OvernightWindowTest(unittest.TestCase):
    def test_final_uses_last_completed_minute_before_two(self):
        day = datetime(2026, 11, 4, tzinfo=NY).date()
        start = instant(day - timedelta(days=1), 18)
        end = instant(day, 2) - 60
        later = instant(day, 9, 29)
        bars = {stamp: [1000, 1000, 1000, 1000]
                for stamp in range(start, later + 1, 60)}
        bars[end] = [1500, 1500, 1500, 1500]
        bars[later] = [9000, 9000, 9000, 9000]
        contract = {"bars": bars, "url": "https://example.com/nq"}
        now = datetime(2026, 11, 4, 10, tzinfo=NY)

        snapshot, _ = build({"NQZ26.CME": contract}, now, {day.isoformat(): {}})
        self.assertEqual(snapshot["values"]["mcOvernight"], 500)
        source = next(source for source in snapshot["sources"]
                      if "mcOvernight" in source["fields"])
        self.assertEqual(datetime.fromisoformat(source["asOf"]).astimezone(NY).strftime("%H:%M"), "01:59")

        del bars[end]
        incomplete, _ = build({"NQZ26.CME": contract}, now, {day.isoformat(): {}})
        self.assertNotIn("mcOvernight", incomplete["values"])

    def test_missing_sunday_open_keeps_exact_unknown_but_records_observed_floor(self):
        day = datetime(2026, 11, 16, tzinfo=NY).date()
        start = instant(day - timedelta(days=1), 18)
        end = instant(day, 2) - 60
        bars = {stamp: [1000, 1000, 1000, 1000]
                for stamp in range(start + 10 * 60, end + 1, 60)}
        bars[start + 60 * 60] = [1500, 1500, 1500, 1500]
        bars[end - 60 * 60] = [900, 900, 900, 900]
        contract = {"bars": bars, "url": "https://example.com/NQZ26.CME"}
        now = datetime(2026, 11, 16, 9, 30, tzinfo=NY)

        snapshot, _ = build({"NQZ26.CME": contract}, now, {day.isoformat(): {}})
        self.assertNotIn("mcOvernightRange", snapshot["values"])
        self.assertNotIn("mcOvernight", snapshot["values"])
        self.assertEqual(snapshot["values"]["mcOvernightRangeMin"], 600)
        source = next(source for source in snapshot["sources"]
                      if "mcOvernightRangeMin" in source["fields"])
        self.assertEqual(datetime.fromisoformat(source["asOf"]).astimezone(NY).strftime("%H:%M"), "01:59")
        self.assertIn("10/480 bars missing, first 18:10", source["title"])
        validate(snapshot)

    def test_midnight_provider_gap_is_only_a_lower_bound(self):
        day = datetime(2026, 11, 13, tzinfo=NY).date()
        start = instant(day - timedelta(days=1), 18)
        end = instant(day, 2) - 60
        midnight = instant(day, 0)
        bars = {stamp: [1000, 1000, 1000, 1000]
                for stamp in range(start, end + 1, 60)}
        for stamp in range(midnight - 60, midnight + 9 * 60, 60):
            del bars[stamp]
        bars[start + 40 * 60] = [1500, 1500, 1500, 1500]
        bars[end - 20 * 60] = [900, 900, 900, 900]
        contract = {"bars": bars, "url": "https://example.com/NQZ26.CME"}
        now = datetime(2026, 11, 13, 9, 30, tzinfo=NY)

        snapshot, _ = build({"NQZ26.CME": contract}, now, {day.isoformat(): {}})
        self.assertEqual(snapshot["values"]["mcOvernight"], 0)
        self.assertEqual(snapshot["values"]["mcOvernightRangeMin"], 600)
        for field in ("mcOvernightRange", "mcOvernightType", "mcOvernightHigh",
                      "mcLondonTook"):
            self.assertNotIn(field, snapshot["values"])
        source = next(source for source in snapshot["sources"]
                      if "mcOvernightRangeMin" in source["fields"])
        self.assertIn("10/480 bars missing", source["title"])
        validate(snapshot)


if __name__ == "__main__":
    unittest.main()
