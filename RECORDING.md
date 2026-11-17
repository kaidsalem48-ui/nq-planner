# Automatic market conditions

The Windows task "NQ Planner market conditions" runs weekdays **every 30 minutes from
8:00 AM to 4:30 PM, plus 5 PM America/New_York** (since 2026-11-04), so live inputs
never pass the 90-minute limit during the session. The PC must be on or asleep
(the task wakes it) and online. Codex is no longer needed.
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
  The provider sometimes publishes empty NQ bars for 23:59–00:08 NY. Such a
  gap makes the exact range and behavior unavailable; observed high and low
  can establish only a lower bound. A missing Sunday 18:00 opening bar also
  leaves exact range and net unavailable.
- `overnight-history.json` is a legacy continuous-contract backfill. It is
  historical context only, not verified same-contract evidence. It must not
  supply or clear a current 500-point threshold, count as verified recent-night
  evidence, or fill missing dated archive ranges.
- If the full range is unavailable, `mcOvernightRangeMin` records only the high–low
  **lower bound** from nonempty bars of the same dated NQ contract. Its source
  names the observed high/low minutes, first observed minute and missing-bar
  count. The last 01:59 one-minute bar (or complete 01:55 five-minute bar) is
  required. A lower bound at or above 500 proves the threshold was crossed and
  can mark the day Risky; a lower bound below 500 cannot clear the rule or label
  the night safe. The field is retired when a complete final range is recorded.
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

User rules: VIX >18 adds sizing context; VIX >18 and >2% above previous close reduces
aggression. VIX >20 (2026-11-05) labels Volatility "Very volatile" and raises an
informational sizing update; it does not lower the day grade. An overnight high–low
range of at least 500 points makes the day **Risky (yellow)** and raises a caution
alert. The overnight move alone does not impose an AM sit-out or promise a cleaner
PM session. Existing red calendar windows, Election Day restrictions and closed or
shortened sessions remain in force; Risky does not turn them yellow. A clean setup
still has to confirm within an eligible window. Recent-night comparisons are context
and do not erase a verified 500-point Risky grade. The illustrated 04:15–07:15 NY
move describes a later premarket move outside the defined overnight measurement.
Before the final reading, use `mcOvernightSoFar` with its actual source minute
and label any threshold crossing provisional until the final 02:00 reading
supersedes it and uses the 18:00-to-02:00 NY definition.
Old 09:29-window readings must not be labeled as 02:00-window readings. The
evaluation accepts final overnight sources only when observed at 01:59 NY.
**Updated 2026-11-04 (user's call):** the rule uses the overnight high–low range,
not the signed net, so a 900-point drop that comes back still counts. Without a
final range (provisional, or range data incomplete), observed-bar high–low and
|net| are lower bounds, each labeled as such. Neither can clear the rule below 500.
Updates show both when sourced: "Range 896 · net −193".
**Updated 2026-11-16 (user's call):** reaching 500 points changes the day grade
to Risky, with a yellow caution update. It no longer creates a red AM sit-out.
**Legs (2026-11-04):** when every bar is available, the final reading also records
the overnight open, high, low, 1:59 close and the minutes after 18:00 when the high and low printed
(`mcOvernightOpen/High/Low/Close/HighMin/LowMin`, sourced at 01:59 like the range).
The Updates title shows the measured points. Details identify an exact range or
lower bound; when all bars support it, they also describe Leg 1 (first extreme
to second extreme) and Leg 2 (second extreme to the 1:59 close).

**Updated Election Day rule:** do not trade after 09:30 New York; the user expects
poor, unpredictable price action. This supersedes the old after-09:30 1:1R rule.
The established pre-open restriction remains. The calendar generator paints
Election Day NY windows red and assigns Sit out; no claim is made that every
Election Day must statistically have poor price action.

The Updates control beside Market conditions has an unread count and a persistent
risk indicator. Alerts use stable date/type/threshold identifiers, allowing
read warnings to stay available without repeatedly becoming new. A materially
larger overnight bucket (50 points) or final measurement gets a new identifier.
Opening a specific update marks it read on that device. It never clears the risk
rule or day warning. The list scrolls after four entries, and the date appears
in an opened update. Each new published snapshot gets its own update entry.
Updates also shows the signed overnight net move when exact endpoints exist. The
provisional entry updates as measurements arrive. The final 02:00 NY reading
takes its place. Market conditions is a separate weekly navigation view beside
Show list, with day-specific recorded readings and source times.
The page checks the archive every minute while open and on return to the app;
failed refreshes show a connection warning and retain dated cached readings.
New readings also show a bottom-right toast while the page is open. A user can
enable native browser notifications from Updates on each device. On iPhone,
install the site with Share → Add to Home Screen, open it from that icon, and
enable notifications there (iOS 16.4 or newer). OS placement is controlled by
the device; the in-page desktop toast is fixed to the bottom right.
After device alerts are enabled, the Updates panel no longer shows alert
settings. The bottom of the page has **Send test notification** and **Turn off
device alerts**. The test button opens a choice of overnight, VIX, holiday,
CPI, FOMC and half-day examples. `/api/push-test` sends the chosen example to
the registered device, labels it as a test, and limits repeat tests to one per
10 seconds.
The older Windows WebView2 wrapper does not implement background Web Push; use
Chrome with NQ Planner installed or open for native Windows alerts. Its in-page
bottom-right update card still works while the wrapper is open.

Native Web Push uses `sw.js`, the Vercel `/api/push` subscription endpoint and
`/api/push-dispatch`. Subscriptions and sent identifiers live in the private
`kaidsalem48-ui/nq-planner-push-state` repository. The Vercel production secrets
`GITHUB_PUSH_TOKEN`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` must stay private.
GitHub Actions dispatch is authenticated with a short-lived Actions OIDC token
restricted to this repository's main-branch recorder workflows. The recorder
sends new condition updates after each cloud collection. The continuous loop
also checks for a 9:00 PM New York preview of the next calendar day's saved
grade, catalyst and plan; an 8:00 AM New York summary of the verified prior
6 PM–2 AM range, or a clearly labeled observed lower bound when provider bars
are missing; calendar-release alerts
two minutes before scheduled releases; and selected-window alerts five minutes
before each window and when it starts. Overnight Asia/London windows are stored
under the following trading date but alert on the correct New York calendar day.
Only windows selected on that device receive these two alerts. Stable event IDs
deduplicate per device. The 9 PM
preview is a calendar plan, subject to the verified overnight reading and
later news; estimated releases stay marked estimated. The 8 AM summary never
turns missing range bars into a low-risk reading.

Time-window picks are stored per native push subscription through
`/api/push-plan`. New published market observations reach that device during
its selected window, beginning 30 minutes before the window starts. The 9 PM
preview, 8 AM overnight summary, overnight Risky alert and scheduled news
alerts still arrive independently of window picks. The old ntfy delivery route
is disabled; alerts use NQ Planner native push only. Collection runs on the
recorded schedule, so these are
published observations rather than instant exchange-price alerts.
