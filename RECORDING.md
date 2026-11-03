# Daily market-condition recording

The Codex automation **Record NQ Planner market conditions** runs in the existing
chat at **9:35 AM America/New_York, Monday–Friday**. Codex must be running and the
computer awake/online for local scheduled runs. This is a daily sourced snapshot,
not an exchange data feed. Successful runs are quiet; failed runs may notify.

`market-conditions.json` is public market information shared by the planner on
all devices. Private chart notes and manual overrides remain in device storage.
Never put account data, credentials, trade records or personal notes in this file.

## Recording procedure

Use current primary sources or a timestamped quote provider. Verify the date,
actual quote time, instrument/contract, units and baseline. Missing data stays
absent. Do not infer dealer gamma or inventory from price/volume. Do not label
volatility Expanding/Contracting from a single VIX tick without a defined interval.
Do not combine stock quotes from different times into a breadth signal. A daily
article can quote previous-session numbers: its publication time is not proof of
the observation time. Omit those values unless their true session is verified.

The source day must match the New York recording date. A valid partial snapshot:

```json
{
  "date": "2026-11-03",
  "recordedAt": "2026-11-03T09:35:00-05:00",
  "values": {"mcVix": 20.86},
  "sources": [{
    "title": "Provider's timestamped market snapshot",
    "url": "https://provider.example/snapshot",
    "asOf": "2026-11-03T09:16:00-05:00",
    "fields": ["mcVix"]
  }]
}
```

The example illustrates the schema; use real verified values and URLs in runs.
Record a partial snapshot if only some fields can be verified. An empty values
object and sources array represent no verified data, including a market closure;
they never mean neutral or zero market conditions. Report a data failure honestly.
Known gamma requires `mcGammaSource` and a direct positioning source for both fields.
Allowed fields and enums are enforced in `record_market_conditions.py`.

Run from `C:\Users\Sarphik\nq-planner-repo`:

```powershell
python -m pip install -r requirements-recording.txt
python record_market_conditions.py --input <snapshot-path> --validate-only
python record_market_conditions.py --input <snapshot-path> --deploy
```

The recorder validates all fields, merges local and live history, rejects replacing
a newer same-day record, and publishes the **current live UI**, calendar data and
assets with the updated archive. It does not rebuild the calendar or deploy a stale
local UI. It refuses to publish if existing live history cannot be read, and checks
the published entry afterward. It commits and pushes only the public archive after
checking that Git's UI/assets match production and no unrelated work is staged.
If those checks fail, the published snapshot stays live and the job reports that
the Git copy needs reconciliation; it never pushes an older UI over the live one.
On a failed deployment, retry using the same input;
the previous live archive remains available and the local entry is preserved.

## Planner behavior

The planner fetches the archive on refresh. Automatic values fill missing manual
fields; local manual values, including deliberate blanks, take precedence. The
panel shows recording time and linked source observation times. Snapshots are
historical observations for that day and never claim to be current tick data.
Existing news restrictions stay intact. The planner's established market-condition
rules may reduce a day's aggression; missing inputs never create a green light.

## Deployment

The planner's Vercel link is `.vercel/project.json` (not committed). The daily task
uses the existing Vercel CLI sign-in. Do not copy keys or tokens into the archive.
Initial UI/support-file changes are saved in Git; routine recording commits only
the archive. If a run reports a Git/live mismatch, reconcile the current live UI
and archive before another Git-based deployment so history is not rolled back.
