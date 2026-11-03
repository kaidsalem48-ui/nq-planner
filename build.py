#!/usr/bin/env python3
"""Turn events.json into data.json using Kaid's NQ trading rules.

Run:  python3 build.py
Edit events.json (dates, times, holidays), never data.json by hand.
"""
import json
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
T0, T1 = 2 * 60, 16 * 60  # schedule covers 2:00am-4:00pm New York time


def mins(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def hm(m):
    return f"{m // 60}:{m % 60:02d}"


class Day:
    def __init__(self):
        self.st = ["r"] * (T1 - T0)
        self.why = [""] * (T1 - T0)

    def paint(self, a, b, s, why):
        for m in range(max(a, T0), min(b, T1)):
            self.st[m - T0] = s
            self.why[m - T0] = why

    def recolor(self, frm, to, why):
        for i, s in enumerate(self.st):
            if s == frm:
                self.st[i] = to
                self.why[i] = why

    def segs(self):
        out, start = [], 0
        for i in range(1, len(self.st) + 1):
            if i == len(self.st) or self.st[i] != self.st[start] or self.why[i] != self.why[start]:
                out.append([hm(start + T0), hm(i + T0), self.st[start], self.why[start]])
                start = i
        return out


LABEL = {2: "Great", 1: "Good", 0: "OK", -1: "Light", -2: "Sit out"}
OPEX_RULE = "Your OPEX rule: lower probability. Don't expect price to keep running the highs. Target 1:1. No partials."
ELECTION_RULE = "Your Election Day rule: random volatility and unpredictable price action. Trade only after 9:30 AM New York time, take only clean V-shape setups, and target 1R."


def monthly_opex(year, month, holidays):
    """Standard monthly equity/index OPEX; shift back for exchange holidays."""
    first = date(year, month, 1)
    expiry = first + timedelta(days=(4 - first.weekday()) % 7 + 14)
    # Gregorian Easter (Good Friday can coincide with March/April OPEX).
    a, b, c = year % 19, year // 100, year % 100
    h = (19 * a + b - b // 4 - (b - (b + 8) // 25 + 1) // 3 + 15) % 30
    l = (32 + 2 * (b % 4) + 2 * (c // 4) - h - c % 4) % 7
    m = (a + 11 * h + 22 * l) // 451
    n = h + l - 7 * m + 114
    good_friday = date(year, n // 31, n % 31 + 1) - timedelta(days=2)
    june = date(year, 6, 19)
    juneteenth = june + timedelta(days=-1 if june.weekday() == 5 else 1 if june.weekday() == 6 else 0)
    while (expiry.weekday() > 4 or expiry == good_friday
           or (year >= 2022 and expiry == juneteenth)
           or holidays.get(expiry.isoformat(), {}).get("type") == "closed"):
        expiry -= timedelta(days=1)
    return expiry


def main():
    src = json.loads((HERE / "events.json").read_text())
    hol = src["holidays"]
    notes_in = src.get("notes", {})
    by_date = {}
    for e in src["events"]:
        by_date.setdefault(e["date"], []).append(e)
    for v in by_date.values():
        v.sort(key=lambda e: mins(e["time"]))

    d0 = date.fromisoformat(src["range"][0])
    d1 = date.fromisoformat(src["range"][1])

    def ev(d):
        return by_date.get(d.isoformat(), [])

    def red(d):
        return [e for e in ev(d) if e["impact"] == "red"]

    def kinds(d):
        return {e["kind"] for e in ev(d)}

    def prev_wd(d):
        d -= timedelta(days=1)
        while d.weekday() > 4:
            d -= timedelta(days=1)
        return d

    def next_wd(d):
        d += timedelta(days=1)
        while d.weekday() > 4:
            d += timedelta(days=1)
        return d

    days = []
    d = d0
    while d <= d1:
        if d.weekday() > 4:
            d += timedelta(days=1)
            continue
        iso = d.isoformat()
        h = hol.get(iso)
        es = ev(d)
        reds = red(d)
        ks = kinds(d)
        why = []
        notes = [notes_in[iso]] if iso in notes_in else []
        out = {"date": iso, "news": [], "marks": [], "holiday": None}
        is_opex = d == monthly_opex(d.year, d.month, hol)
        if is_opex:
            out.update(opex=True, opexRule=OPEX_RULE)

        for e in es:
            tag = " (est.)" if e.get("est") else ""
            out["news"].append({"time": e["time"], "name": e["name"] + tag, "impact": e["impact"]})
            out["marks"].append([e["time"], e["short"], "news" if e["impact"] == "red" else "minor"])

        if h and h["type"] == "closed":
            day = Day()
            day.paint(T0, T1, "r", "Market closed")
            out.update(holiday=h["name"], holidayType="closed", score=None, label="Bank holiday",
                       segs=day.segs(), why="Market closed for " + h["name"] + ".", notes=notes, asia=[])
            days.append(out)
            d += timedelta(days=1)
            continue

        day = Day()
        # Default: Asia/London off, pre-open light, 9:30+ is the main window.
        day.paint(T0, 480, "r", "Asia / London, skip")
        day.paint(480, 565, "y", "Pre-open, light only")
        day.paint(565, 570, "r", "Too close to 9:30 open")
        day.paint(570, 630, "g", "NY AM, main window")
        day.paint(630, 720, "y", "Should be done by 10:30")
        day.paint(720, 810, "y", "Lunch: only if AM was bad")
        day.paint(810, 960, "y", "PM: only if AM was bad")
        score = 1
        red830 = any(mins(e["time"]) == 510 for e in reds)

        if red830:
            day.paint(480, 500, "r", "Nothing before 8:30 news")
            day.paint(500, 510, "r", "News in < 10 min")
            day.paint(510, 565, "g", "Post-news volatility, data highs")
            score = 2
            why.append("Red folder at 8:30 makes the morning volatile: trade off the 8:30 data highs or wait for 9:30.")
        if reds:
            day.paint(630, 720, "g", "NY AM, main window")
            if d.weekday() == 0:
                day.paint(720, 960, "y", "Monday w/ news: lunch/PM good if AM bad")
        if not reds:
            score = 1
            why.append("No red folder: trade 9:30-10:30 on good price action, be done by 10:30, don't hold long.")

        for e in es:
            t = mins(e["time"])
            if e["kind"] in ("fomc", "minutes", "chair"):
                continue
            if e["impact"] == "red" and t != 510:
                if t < 570:
                    day.paint(480, t - 10, "r", "Nothing before " + e["short"])
                    day.paint(t - 10, t, "r", e["short"] + " in < 10 min")
                    day.paint(t, 565, "g", "Post-news volatility")
                    score = max(score, 2)
                else:
                    day.paint(570 if t - 25 < 585 else t - 25, t - 10, "y", e["short"] + " at " + e["time"] + ", risky")
                    day.paint(t - 10, t, "r", e["short"] + " in < 10 min")
                    why.append(f"{e['short']} at {e['time']}: stay out the 10 min before it.")
            # Orange folder (incl. non-Chair Fed speakers) doesn't change the windows: he ignores it.
            # It still shows as a marker on the timeline.

        if "fomc" in ks:
            day.paint(T0, 14 * 60, "r", "No trades before FOMC")
            day.paint(14 * 60, T1, "r", "FOMC + Chair speaking")
            score = -2
            why = ["FOMC day: no trades before the decision, none while the Chair speaks, none in the FOMC afternoon."]
        elif "chair" in ks:
            for e in es:
                if e["kind"] == "chair":
                    t = mins(e["time"])
                    day.paint(t - 10, t + 60, "r", "Fed Chair speaking")
            score = min(score, 0)
            why.append("Don't trade while the Fed Chair speaks.")
        if "minutes" in ks:
            day.paint(660, T1, "r", "Minutes at 2pm, done by 11")
            score = min(score, 0) if score < 2 else 1
            why.append("FOMC minutes at 2pm: AM is fine, be done by 11.")
        if "nfp" in ks:
            score = min(score, 1)
            why.append("NFP: if yesterday's price action was good, today is likely bad. Check yesterday first.")
        if "cpi" in ks:
            why.append("CPI: never before the release. Low volatility if at all-time highs.")

        # Neighbour-day rules
        nxt, prv = next_wd(d), prev_wd(d)
        if "cpi" in kinds(nxt) and "fomc" not in ks:
            day.recolor("g", "y", "Day before CPI, small scalps")
            score = min(score, -1)
            why.append("Day before CPI is sloppy: small scalps only, eval account.")
        if "fomc" in kinds(nxt) and "fomc" not in ks:
            score = min(score, 0)
            why.append("Day before FOMC: less volatile, won't run every liquidity. Take more off TP1.")
        if "nfp" in kinds(nxt):
            day.recolor("g", "y", "Day before NFP, light")
            score = min(score, -1)
            why.append("Day before NFP: light only, the market waits on the jobs number.")
            notes.append("NFP tomorrow: if today's price action is good, tomorrow is likely bad.")
        if d.weekday() == 0 and not reds and "cpi" not in kinds(nxt):
            day.recolor("g", "y", "No-news Monday, light")
            day.paint(570, 610, "g", "9:30-10:10 window")
            day.paint(720, 960, "r", "Bad AM won't get better")
            score = min(score, -1)
            why = ["No-news Monday: only 9:30-10:10 is worth it. If AM is bad, lunch and PM won't be much better."]
            if red(nxt):
                day.paint(480, 565, "g", "Pre-open setups OK")
                why.append("Red folder tomorrow, so before 9:30 is the best spot today if a setup forms.")
        ph = hol.get(prv.isoformat())
        if ph and ph["type"] in ("bank", "closed"):
            day.recolor("g", "y", "Day after holiday, sloppy")
            score = min(score, -1)
            why.append("Days after bank holidays usually have bad price action.")

        if h and h["type"] == "bank":
            day.recolor("g", "y", "Bank holiday, thin volume")
            out.update(holiday=h["name"], holidayType="bank")
            why.insert(0, f"{h['name']}: bonds/banks closed, futures open with thin volume.")
            score = min(score, -1)
        if h and h["type"] == "half":
            c = mins(h["close"])
            day.paint(c, T1, "r", "Market closed early")
            day.recolor("g", "y", "Half day, hit or miss")
            out.update(holiday=h["name"] + " (half day)", holidayType="half")
            score = min(score, -1)
            why.insert(0, f"{h['name']}: early close at {h['close']}. Half days are hit or miss.")

        if is_opex:
            score = min(score, -1)
            day.recolor("g", "y", "OPEX: lower probability, target 1:1, no partials")
            why.insert(0, OPEX_RULE)

        # Federal Election Day: Tuesday after the first Monday in November,
        # in even-numbered years. Keep this rule when new calendar years are added.
        if d.year % 2 == 0 and d.month == 11 and d.weekday() == 1 and 2 <= d.day <= 8:
            score = min(score, -1)
            day.paint(T0, 570, "r", "Election Day: wait until after 9:30 AM")
            for i, state in enumerate(day.st):
                if i + T0 >= 570 and state != "r":
                    day.st[i] = "y"
                    day.why[i] += " · Election Day: clean V-shape setups only, target 1R"
            why.insert(0, ELECTION_RULE)
            notes.append(ELECTION_RULE)

        # Asia session: the evening before this trading day (times past 24:00 are after midnight)
        kz = ["20:00", "24:00", "y", "Asia kill zone, light size"]
        if "fomc" in kinds(prv):
            kz = ["20:00", "24:00", "g", "Post-FOMC Asia, fine to trade"]
        elif ks & {"cpi", "nfp", "fomc"}:
            kz = ["20:00", "24:00", "r", "Big news tomorrow, skip Asia"]
        open_txt = "Sunday Globex open, thin" if d.weekday() == 0 else "Globex reopen, thin"
        if red830 or ks & {"cpi", "nfp", "fomc"}:
            ldn = ["26:00", "29:00", "r", "No London before 8:30 news"]
        else:
            ldn = ["26:00", "29:00", "y", "London kill zone, risky"]
        out["asia"] = [["18:00", "20:00", "r", open_txt], kz, ["24:00", "26:00", "r", "Late Asia, skip"], ldn]

        out.update(score=score, label=("Bank holiday" if h and h["type"] == "bank" else LABEL[score]),
                   segs=day.segs(), why=" ".join(dict.fromkeys(why)) or "Normal day: trade 9:30 to 12.",
                   notes=notes)
        days.append(out)
        d += timedelta(days=1)

    data = {"updated": src["updated"], "sources": src["sources"], "days": days}
    (HERE / "data.json").write_text(json.dumps(data, indent=1))
    print(f"wrote {len(days)} days")


if __name__ == "__main__":
    main()
