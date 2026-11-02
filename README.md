# NQ Planner

Which days and hours to trade NQ, graded from the US economic calendar with Kaid's rules.

- `events.json` — calendar input (dates, ET times, holidays). Edit this.
- `build.py` — applies the trading rules and writes `data.json`. Run `python3 build.py` after editing events.
- `index.html` — the site (Month / Week / Day views, expandable hours). Hosted on GitHub Pages.

Monthly OPEX is calculated in `build.py` (standard third Friday, shifted earlier
for Good Friday, observed Juneteenth, or a configured full exchange holiday).
OPEX days are capped at Light, with existing Sit out restrictions preserved;
green windows become yellow. The calendar labels OPEX and shows the user's
1:1 / no-partials reminder in the day details. This is a personal rulebook
preference, not a claim that OPEX prices must behave a particular way.
