# Automatic market conditions

The existing Codex automation runs weekdays at **8 AM, 10 AM, noon, 4 PM and
5 PM America/New_York**. Codex must be running and the computer awake and online.
No manual market-condition entry is required. These are timestamped snapshots,
not an exchange tick feed. The public archive is shared by all planner devices.

## Run

From `C:\Users\Sarphik\nq-planner-repo`:

```powershell
python collect_market_conditions.py --deploy
```

The collector discovers the provider's front NQ contract, then downloads that
explicit contract's bars (never continuous-contract bars for session comparisons),
VIX, the 10-year yield index, DXY and the seven tech stocks. It validates all
measurements, preserves existing same-day fields on partial updates with their
original source times, retains dated history and publishes using the existing
Vercel sign-in. No credentials, account data or private notes belong in the archive.
`work/automatic-snapshot.json` contains the most recent collected input.

## Automatic calculations

- VIX level and volatility label versus provider previous close: more than +2%
  Expanding, below -2% Contracting, otherwise Stable. This is a descriptive
  daily-change label, not a measured intraday acceleration or a probability.
- Yield direction versus previous close: Rising/Falling beyond 0.01 percentage
  point (one basis point); Flat within that band. DXY uses 0.05 index point.
- Overnight net: same-contract prior 18:00 NY opening price to 09:29 NY closing
  price. Exact endpoints suffice for net; full range and behavior require every
  bar in the window. Complete 5-minute bars may replace incomplete 1-minute bars
  for the whole overnight window; null/missing bars are never forward-filled.
- RTH opening gap: 09:30 open minus previous RTH last-minute close, same contract.
  Current/prior RTH high-low require complete bars, including holiday early closes.
- Overnight/current behavior: net divided by full high-low range >=60% is Trend
  up, <=-60% Trend down, otherwise Balanced (overnight) / Range (RTH).
  These are labeled heuristics, not a prediction or proof of investor inventory.
- Tech changes and NQ direction use an identical completed minute and the prior
  RTH close for each instrument. Breadth counts names, not index weight.
- Macro context uses a shared completed minute for rates and dollar: both rising
  means potential Headwinds, both falling Supportive, otherwise Mixed. This is
  an interpretation of cross-asset context, not a directional forecast.
- Monthly OPEX and quarterly expiry calculate in the UI with holiday adjustments;
  the next four dates remain visible. Quarterly rebalance windows are labeled as
  scheduled context; they do not confirm an actual announced rebalance or flow.

At 8 AM the 09:29 endpoint, opening gap and RTH range do not yet exist. Later runs
fill these once measured. No future values or stale-session quotes are substituted.
The source may be delayed, rate-limited or incomplete; preserve/report missing
coverage honestly. A previous source field can remain visible with its original
timestamp when a later run cannot refresh it. Never claim a successful fresh value
merely because an earlier observation was retained.

## Positioning and research

Dealer gamma, gamma flip and actual inventory need direct positioning data; do
not infer them from OHLC, option volume or the overnight direction. There is no
connected positioning feed yet. Keep them explicitly unavailable until sourced.
The automation researches index announcements/rebalances and concise market
commentary from dated sources, using OUTLOOK_STYLE.md. Only a direct announcement
can establish a confirmed rebalance. A calendar window is not evidence of flow.

To supplement automatic measurements with researched facts, use a separate JSON
snapshot with the same NY date, current `recordedAt`, `values` and `sources`.
Each source needs a public HTTPS URL, actual `asOf` timestamp and supported field
names. Run `python record_market_conditions.py --input <path> --validate-only`,
then `python record_market_conditions.py --input <path> --deploy`.
Only submit verified supplemental fields; same-day merging preserves other fields.

## UI and publishing

Conditions are read-only. Legacy device overrides are ignored but not deleted.
Daily, weekly and monthly views summarize dated recordings and the calendar;
period lows/highs compare snapshots, not full period extrema. The page refreshes
recordings on reload. Existing scheduled red restrictions stay in force.

The recorder refuses deployment if live history cannot be read. It stages current
live assets (including reference guides), verifies the published entry and commits
only the archive after Git/live asset checks. It refuses a Git push that could roll
back production. The initial code/UI deployment must precede routine recorder runs.
