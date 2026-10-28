# NQ Planner

Which days and hours to trade NQ, graded from the US economic calendar with Kaid's rules.

- `events.json` — calendar input (dates, ET times, holidays). Edit this.
- `build.py` — applies the trading rules and writes `data.json`. Run `python3 build.py` after editing events.
- `index.html` — the site (Month / Week / Day views, expandable hours). Hosted on GitHub Pages.
