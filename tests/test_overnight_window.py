"""The saved overnight rule uses the 18:00–02:00 New York window."""
import unittest
from datetime import datetime, timedelta

from collect_market_conditions import NY, build, instant


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


if __name__ == "__main__":
    unittest.main()
