"""An admitted provider gap cannot remain an exact archived overnight range."""
import unittest

from scripts.repair_incomplete_overnight import correct_archive
from record_market_conditions import validate


class ArchiveOvernightRepairTest(unittest.TestCase):
    def test_reclassifies_gap_and_preserves_independent_net(self):
        day = "2026-11-13"
        observed = "2026-11-13T06:59:00+00:00"
        url = "https://example.com/NQZ26.CME"
        def source(title, fields):
            return {"title": title, "url": url, "asOf": observed, "fields": fields}
        values = {
            "mcOvernight": -51.75, "mcOvernightRange": 350.5,
            "mcOvernightType": "Balanced", "mcOvernightHigh": 28607.75,
            "mcOvernightLow": 28257.25, "mcLondonTook": "low",
            "mcComment": "PPI is the catalyst. NQ's overnight range was 350.5, below 500.",
        }
        entry = {
            "recordedAt": "2026-11-13T15:00:00+00:00", "values": values,
            "sources": [
                source("Exact 18:00 open to 01:59 close", ["mcOvernight"]),
                source("complete 1-minute bars; range excludes the provider's empty 23:59-00:08 bars",
                       ["mcOvernight", "mcOvernightRange", "mcOvernightType",
                        "mcOvernightHigh", "mcOvernightLow"]),
                source("London vs Asia high/low", ["mcLondonTook"]),
                source("PPI release", ["mcComment"]),
                source("Same-contract NQ completed overnight high-low", ["mcComment"]),
            ],
        }
        archive = {"version": 1, "days": {day: entry}}

        self.assertEqual(correct_archive(archive), 1)
        self.assertEqual(correct_archive(archive), 0)
        corrected = archive["days"][day]
        self.assertEqual(corrected["values"]["mcOvernight"], -51.75)
        self.assertEqual(corrected["values"]["mcOvernightRangeMin"], 350.5)
        self.assertNotIn("mcOvernightRange", corrected["values"])
        self.assertNotIn("mcOvernightType", corrected["values"])
        self.assertNotIn("mcLondonTook", corrected["values"])
        self.assertEqual(corrected["values"]["mcComment"], "PPI is the catalyst.")
        self.assertEqual(corrected["recordedAt"], entry["recordedAt"])
        self.assertTrue(any("mcOvernightRangeMin" in s["fields"] and s["asOf"] == observed
                            for s in corrected["sources"]))
        validate({"date": day, **corrected})


if __name__ == "__main__":
    unittest.main()
