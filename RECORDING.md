# Automatic market conditions

The existing Codex automation runs weekdays at **8 AM, 9 AM, 10 AM, noon, 4 PM and
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
- Overnight net: same-contract prior 18:00 NY opening price to 01:59 NY closing
  price, the last completed minute before the 02:00 NY boundary. Exact endpoints
  suffice for net; full range and behavior require every
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

At 8 AM the overnight window is complete, but the opening gap and RTH range do
not yet exist. Later runs fill those once measured. No future values or
stale-session quotes are substituted.
The source may be delayed, rate-limited or incomplete; preserve/report missing
coverage honestly. A previous source field can remain visible with its original
timestamp when a later run cannot refresh it. Never claim a successful fresh value
merely because an earlier observation was retained.

## Positioning and research

Gamma, dealer hedging and inferred overnight inventory have been removed from
the active interface and condition assessment at the user's request. Do not
research or repopulate them. Price data cannot establish dealer positioning.
The automation may research index announcements/rebalances and concise market
commentary from dated sources using OUTLOOK_STYLE.md. Only a direct announcement
can establish a confirmed rebalance; expiry is not evidence of actual flows.

To supplement automatic measurements with researched facts, use a separate JSON
snapshot with the same NY date, current `recordedAt`, `values` and `sources`.
Each source needs a public HTTPS URL, actual `asOf` timestamp and supported field
names. Run `python record_market_conditions.py --input <path> --validate-only`,
then `python record_market_conditions.py --input <path> --deploy`.
Only submit verified supplemental fields; same-day merging preserves other fields.

## UI and publishing

Conditions are read-only. Legacy device overrides are ignored but not deleted.
Weekly Outlook shows the detailed conditions for its latest recorded session.
period lows/highs compare snapshots, not full period extrema. The page refreshes
recordings on reload. Existing scheduled red restrictions stay in force.

The recorder refuses deployment if live history cannot be read. It stages current
live assets (including reference guides), verifies the published entry and commits
only the archive after Git/live asset checks. It refuses a Git push that could roll
back production. The initial code/UI deployment must precede routine recorder runs.

## Evaluations and in-app updates

`conditions-engine.js` is the shared, testable evaluation engine. It evaluates
VIX, overnight net movement, gap/RTH range, tech participation, rates/dollar,
expiry and source quality separately, then gives a priority-based Overall
conclusion. It never presents an uncalibrated weighted score as a probability.
Each group shows the measured inputs, interpretation, conclusion, missing data
and source times. Source observation time drives freshness, not recording time.
Dynamic values older than 90 minutes during 08:00–16:30 NY are excluded; fixed
final overnight/opening-gap/prior-range measurements keep their source times.
Historical session views remain explicitly dated.

User rules: VIX >18 is caution; VIX >18 and >2% above previous close reduces
aggression. A net overnight move of at least 500 points in either direction
blocks the New York AM session and raises a red alert. Once the final 02:00
reading is available, an otherwise eligible 13:30–16:00 NY segment becomes a
yellow PM watch if the AM session was choppy and a cleaner setup confirms.
This is a conditional observation window, not a claim that PM will trade well.
Original red calendar windows, Election Day and closed/short sessions remain
blocked. The illustrated 04:15–07:15 NY move describes a later premarket move
outside the defined overnight measurement; it is not the PM trading window.
Before the final reading, use `mcOvernightSoFar` with its actual source minute
and keep a provisional restriction in effect until the final
`mcOvernight` reading supersedes it and uses the 18:00-to-02:00 NY definition.
Old 09:29-window readings must not be labeled as 02:00-window readings. The
evaluation accepts final overnight sources only when observed at 01:59 NY.
Use the signed net move for this rule.

**Updated Election Day rule:** do not trade after 09:30 New York; the user expects
poor, unpredictable price action. This supersedes the old after-09:30 1:1R rule.
The established pre-open restriction remains. The calendar generator paints
Election Day NY windows red and assigns Sit out; no claim is made that every
Election Day must statistically have poor price action.

The Updates control beside Market conditions has a red unread count and a persistent
high-risk indicator. Alerts use stable date/type/threshold identifiers, allowing
read warnings to stay available without repeatedly becoming new. A materially
larger overnight bucket (50 points) or final measurement gets a new identifier.
Opening a specific update marks it read on that device. It never clears the risk
rule or day warning. The list scrolls after four entries, and the date appears
in an opened update. Each new published snapshot gets its own update entry.
Updates also shows the signed overnight net move each trading day. The
provisional entry updates as measurements arrive. The final 02:00 NY reading
takes its place. Market conditions is a separate weekly navigation view beside
Show list, with day-specific recorded readings and source times.
The page checks the archive every minute while open and on return to the app;
failed refreshes show a connection warning and retain dated cached readings.
These are in-app notices about scheduled observations, not OS push notifications
or instant exchange-price alerts. Codex still needs to be awake/online for runs.
