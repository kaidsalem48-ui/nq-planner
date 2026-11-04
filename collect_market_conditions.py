#!/usr/bin/env python3
"""Collect timestamped public quotes; derive conditions with documented rules."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, time, timezone
import json
import math
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from record_market_conditions import record, validate

HERE = Path(__file__).resolve().parent
NY = ZoneInfo("America/New_York")
TECH = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"]

def fetch(symbol, interval="1m"):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol, safe="") + "?interval=" + interval + "&range=5d&includePrePost=true"
    data = json.load(urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 NQPlanner/1.0"}), timeout=25))
    result = data["chart"]["result"][0]
    if result["meta"]["symbol"] != symbol:
        raise ValueError("Provider returned another instrument")
    q = result["indicators"]["quote"][0]
    bars = {}
    for i, timestamp in enumerate(result.get("timestamp", [])):
        values = [q[k][i] for k in ["open", "high", "low", "close"]]
        if timestamp % 60 == 0 and all(isinstance(v, (float, int)) and math.isfinite(v) for v in values):
            bars[timestamp] = values
    return {"meta": result["meta"], "bars": bars, "url": url}

def instant(day, hour, minute=0):
    return int(datetime.combine(day, time(hour, minute), NY).timestamp())

def complete(bars, start, end, step=60, skip=(), stamped=False):
    # Every minute, inclusive. Missing minutes invalidate the measurement, except the named provider gap.
    keys = [k for k in range(start, end + 1, step) if k not in skip]
    if not keys or not all(k in bars for k in keys):
        return None
    return [(k, bars[k]) for k in keys] if stamped else [bars[k] for k in keys]

def legs(stamped, start):
    # High, low and when each printed, as minutes after the 18:00 NY open, so the app can show both swings.
    hi = max(stamped, key=lambda kb: kb[1][1])
    lo = min(stamped, key=lambda kb: kb[1][2])
    return {"mcOvernightOpen": round(stamped[0][1][0], 2), "mcOvernightHigh": round(hi[1][1], 2),
            "mcOvernightLow": round(lo[1][2], 2), "mcOvernightClose": round(stamped[-1][1][3], 2),
            "mcOvernightHighMin": (hi[0] - start) // 60, "mcOvernightLowMin": (lo[0] - start) // 60}

def direction(change, tolerance):
    return "Rising" if change > tolerance else "Falling" if change < -tolerance else "Flat"

def build(results, now, calendar):
    today = now.astimezone(NY).date()
    day = today.isoformat()
    cutoff = int(now.timestamp()) // 60 * 60 - 60
    values, sources, diagnostics = {}, [], []
    def add(data, fields, timestamp, title):
        if not fields:
            return
        if datetime.fromtimestamp(timestamp, NY).date() != today or timestamp > now.timestamp():
            return
        values.update(fields)
        sources.append({"title": title, "url": data["url"], "asOf": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(), "fields": list(fields)})
    for symbol, key, trend, tolerance in [("^VIX", "mcVix", "mcVol", .02), ("^TNX", "mcYieldLevel", "mcYields", .01), ("DX-Y.NYB", "mcDxy", "mcDollar", .05)]:
        data = results.get(symbol)
        if not data:
            diagnostics.append(symbol + " feed unavailable")
            continue
        meta = data["meta"]
        timestamp, price = meta.get("regularMarketTime", 0), meta.get("regularMarketPrice")
        if not isinstance(price, (int, float)) or not math.isfinite(price):
            continue
        fields = {key: price}
        previous = meta.get("previousClose")
        if isinstance(previous, (int, float)) and previous > 0:
            change = (price / previous - 1) if symbol == "^VIX" else price - previous
            change_key = {"^VIX": "mcVixChange", "^TNX": "mcYieldChangeBp", "DX-Y.NYB": "mcDxyChange"}[symbol]
            fields[change_key] = round(change * (100 if symbol in ("^VIX", "^TNX") else 1), 4)
            fields[trend] = ("Expanding" if change > tolerance else "Contracting" if change < -tolerance else "Stable") if symbol == "^VIX" else direction(change, tolerance)
        add(data, fields, timestamp, symbol + " quote; direction versus prior close" + (" (VIX +/-2%)" if symbol == "^VIX" else ""))
    nq_symbols = [s for s in results if s.startswith("NQ") and s.endswith(".CME")]
    nq = results.get(nq_symbols[0]) if nq_symbols else None
    session = calendar.get(day)
    closed = today.weekday() > 4 or session and session.get("holidayType") == "closed"
    # No regular session measurements on known exchange closures.
    close_hour = 13 if session and session.get("holidayType") == "half" else 16
    if nq and not closed:
        bars = {k: v for k, v in nq["bars"].items() if k <= cutoff}
        previous = today - timedelta(days=1)
        while previous.weekday() > 4 or calendar.get(previous.isoformat(), {}).get("holidayType") == "closed":
            previous -= timedelta(days=1)
        prior_hour = 13 if calendar.get(previous.isoformat(), {}).get("holidayType") == "half" else 16
        prior_start, prior_end = instant(previous, 9, 30), instant(previous, prior_hour) - 60
        prior = complete(bars, prior_start, prior_end)
        # Prior-session data is calculated/observed now, with its baseline explicit.
        latest = max((k for k in bars if datetime.fromtimestamp(k, NY).date() == today), default=0)
        if prior and latest:
            add(nq, {"mcPriorRange": round(max(b[1] for b in prior) - min(b[2] for b in prior), 2)}, latest, nq_symbols[0] + " prior RTH range " + previous.isoformat() + " (recomputed at observation time)")
        # The 18:00–02:00 NY window ends with the 01:59 completed bar.
        overnight_start, overnight_end = instant(today - timedelta(days=1), 18), instant(today, 2) - 60
        premarket_end = max((k for k in bars if overnight_start <= k <= min(cutoff, overnight_end)), default=0)
        if cutoff < overnight_end and overnight_start in bars and premarket_end:
            add(nq, {"mcOvernightSoFar": round(bars[premarket_end][3] - bars[overnight_start][0], 2)}, premarket_end, nq_symbols[0] + " overnight so far: completed source-minute close minus prior 18:00 open; provisional until 02:00 NY")
        # The provider publishes empty NQ bars for 23:59-00:08 NY every night, although the contract trades.
        midnight = instant(today, 0)
        hole = set(range(midnight - 60, midnight + 9 * 60, 60))
        overnight = complete(bars, overnight_start, overnight_end, stamped=True) if cutoff >= overnight_end else None
        gap_note = ""
        if overnight is None and cutoff >= overnight_end:
            overnight = complete(bars, overnight_start, overnight_end, skip=hole, stamped=True)
            gap_note = "; range excludes the provider's empty 23:59-00:08 bars"
        if cutoff >= overnight_end and overnight_start in bars and overnight_end in bars:
            add(nq, {"mcOvernight": round(bars[overnight_end][3] - bars[overnight_start][0], 2)}, overnight_end, nq_symbols[0] + " 01:59 close minus prior 18:00 open; 02:00 NY boundary, exact endpoints")
        overnight_data = nq
        resolution = "1-minute"
        if overnight is None and cutoff >= overnight_end and results.get(nq_symbols[0] + ":5m"):
            five = results[nq_symbols[0] + ":5m"]
            overnight = complete(five["bars"], overnight_start, overnight_end - 240, 300, stamped=True)
            overnight_data, resolution, gap_note = five, "5-minute", ""
        if overnight:
            swing = legs(overnight, overnight_start)
            overnight = [b for _, b in overnight]
            net = overnight[-1][3] - overnight[0][0]
            span = max(b[1] for b in overnight) - min(b[2] for b in overnight)
            behavior = "Trend up" if span and net / span >= .6 else "Trend down" if span and net / span <= -.6 else "Balanced"
            add(overnight_data, {"mcOvernight": round(net, 2), "mcOvernightRange": round(span, 2), "mcOvernightType": behavior, **swing}, overnight_end, nq_symbols[0] + " complete " + resolution + " bars, 18:00 open to 01:59 close (02:00 NY boundary); trend if net/range >=60%" + gap_note)
        rth_start = instant(today, 9, 30)
        end = min(cutoff, instant(today, close_hour) - 60, latest)
        current = complete(bars, rth_start, end) if end >= rth_start else None
        if current:
            span = max(b[1] for b in current) - min(b[2] for b in current)
            net = current[-1][3] - current[0][0]
            fields = {"mcRange": round(span, 2), "marketType": "Trend up" if span and net / span >= .6 else "Trend down" if span and net / span <= -.6 else "Range"}
            if prior:
                fields["marketGapPoints"] = round(current[0][0] - prior[-1][3], 2)
            add(nq, fields, end, nq_symbols[0] + " complete RTH bars; behavior heuristic net/range >=60%; gap versus prior RTH close")
        else:
            diagnostics.append("NQ RTH bars not yet available or incomplete")
        if not overnight:
            diagnostics.append("Full defined overnight window not yet available or incomplete")
        # All eight instruments must share the exact same completed minute and a previous RTH baseline.
        if all(s in results for s in TECH):
            common = set(bars)
            for symbol in TECH:
                common &= set(results[symbol]["bars"])
            common = [k for k in common if instant(today, 4) <= k <= min(cutoff, instant(today, close_hour) - 60)]
            stamp = max(common, default=0)
            baselines = {}
            for symbol in TECH:
                prior_keys = [k for k in results[symbol]["bars"] if prior_start <= k <= prior_end]
                if prior_keys and max(prior_keys) >= prior_end - 60:
                    baselines[symbol] = results[symbol]["bars"][max(prior_keys)][3]
            if stamp and len(baselines) == 7 and prior:
                change = bars[stamp][3] - prior[-1][3]
                add(nq, {"mcDirection": "Up" if change > 0 else "Down" if change < 0 else "Flat"}, stamp, nq_symbols[0] + " direction vs prior RTH close; synchronized minute")
                for symbol in TECH:
                    add(results[symbol], {"mc" + symbol: round((results[symbol]["bars"][stamp][3] / baselines[symbol] - 1) * 100, 3)}, stamp, symbol + " synchronized change vs prior RTH close " + previous.isoformat())
    # Interpret rates and dollar only at a shared, completed observation minute.
    rate, dollar = results.get("^TNX"), results.get("DX-Y.NYB")
    if rate and dollar:
        common = set(rate["bars"]) & set(dollar["bars"])
        stamp = max((k for k in common if instant(today, 0) <= k <= cutoff), default=0)
        rb, db = rate["meta"].get("previousClose"), dollar["meta"].get("previousClose")
        if stamp and isinstance(rb, (int, float)) and isinstance(db, (int, float)):
            y = direction(rate["bars"][stamp][3] - rb, .01)
            d = direction(dollar["bars"][stamp][3] - db, .05)
            macro = "Headwinds" if y == d == "Rising" else "Supportive" if y == d == "Falling" else "Mixed"
            title = "Macro heuristic at synchronized minute: yield " + y.lower() + ", dollar " + d.lower() + "; both rising=headwinds, both falling=supportive, otherwise mixed (not a forecast)"
            add(rate, {"mcMacro": macro, "mcMacroYieldChangeBp": round((rate["bars"][stamp][3] - rb) * 100, 4)}, stamp, title)
            add(dollar, {"mcMacro": macro, "mcMacroDxyChange": round(dollar["bars"][stamp][3] - db, 4)}, stamp, title)
    return {"date": day, "recordedAt": now.isoformat(), "values": values, "sources": sources}, diagnostics

def collect():
    now = datetime.now(timezone.utc)
    local = now.astimezone(NY)
    # Discover the provider's actual front contract, then request explicit-contract bars only.
    discovery = fetch("NQ=F")
    import re
    name = discovery["meta"].get("shortName", "")
    match = re.search(r"(Mar|Jun|Sep|Dec) (\d{2})$", name)
    if not match:
        raise ValueError("Cannot verify front NQ contract from provider metadata")
    contract = "NQ" + {"Mar": "H", "Jun": "M", "Sep": "U", "Dec": "Z"}[match[1]] + match[2] + ".CME"
    symbols = ["^VIX", "^TNX", "DX-Y.NYB", contract] + TECH
    results, failures = {}, []
    def one(symbol):
        try:
            return symbol, fetch(symbol), None
        except Exception as error:
            return symbol, None, type(error).__name__
    with ThreadPoolExecutor(max_workers=4) as pool:
        for symbol, data, error in pool.map(one, symbols):
            if data:
                results[symbol] = data
            else:
                failures.append(symbol + ": " + error)
    try:
        results[contract + ":5m"] = fetch(contract, "5m")
    except Exception:
        failures.append("NQ 5-minute fallback unavailable")
    calendar = {d["date"]: d for d in json.loads((HERE / "data.json").read_text(encoding="utf-8"))["days"]}
    snapshot, diagnostics = build(results, datetime.now(timezone.utc), calendar)
    # Use post-fetch timestamp so every included observation precedes recording.
    snapshot["recordedAt"] = datetime.now(timezone.utc).isoformat()
    validate(snapshot)
    return snapshot, failures + diagnostics

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--output", type=Path, default=HERE / "work" / "automatic-snapshot.json")
    args = parser.parse_args()
    snapshot, diagnostics = collect()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print("Collected", len(snapshot["values"]), "fields for", snapshot["date"])
    print("Coverage:", "; ".join(diagnostics) or "All measurable quote fields available")
    if not snapshot["values"]:
        raise SystemExit("No verified measurements; previous recordings preserved")
    record(snapshot, args.deploy)
