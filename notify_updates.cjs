// Phone push notifications for NQ Planner updates, through ntfy (https://ntfy.sh).
// Runs after each recording (GitHub Actions and the PC backup). It evaluates today's
// readings with the same engine the site uses and pushes only updates not sent before.
// Sent ids are kept in notified.json (committed with the archive) so the cloud and the PC
// never repeat each other.
'use strict';
const fs = require('fs'), path = require('path');
const engine = require('./conditions-engine.js');
const here = (...p) => path.join(__dirname, ...p);
// The channel name is private: a GitHub secret in the cloud, a file outside the repo on the PC.
const TOPIC = (process.env.NTFY_TOPIC || '').trim();
if (!TOPIC) { console.log('notify: NTFY_TOPIC not set, skipping'); process.exit(0); }
const SITE = 'https://nq-planner.vercel.app/';
const SKIP = [':stale', ':missing', ':connection']; // housekeeping, not market news

const nyDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

async function main() {
  const now = Date.now(), day = nyDay(now);
  const record = JSON.parse(fs.readFileSync(here('market-conditions.json'), 'utf8')).days?.[day];
  if (!record) { console.log(`notify: no reading for ${day}`); return; }
  const base = (JSON.parse(fs.readFileSync(here('data.json'), 'utf8')).days || []).find(d => d.date === day);
  // Same PM-watch eligibility as the site.
  const pmEligible = !!base && base.score !== -2 && !['closed', 'half', 'bank'].includes(base.holidayType)
    && (base.segs || []).some(s => s[2] !== 'r' && toMin(s[0]) < 960 && toMin(s[1]) > 810);
  const a = engine.evaluate(record, { day, now, expiry: '', upcomingExpiry: [], calendarKnown: !!base, closed: base?.holidayType === 'closed', pmEligible });

  const file = here('notified.json');
  const sent = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const d of Object.keys(sent)) if (d < nyDay(now - 7 * 864e5)) delete sent[d];
  const done = new Set(sent[day] || []);
  const fresh = a.alerts.filter(x => !done.has(x.id) && !SKIP.some(s => x.id.endsWith(s)))
    .sort((x, y) => ({ danger: 0, caution: 1, info: 2 }[x.severity] - { danger: 0, caution: 1, info: 2 }[y.severity]));

  for (const x of fresh) {
    const res = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: TOPIC, title: x.title, message: x.message, click: SITE,
        priority: x.severity === 'danger' ? 4 : 3,
        tags: [x.severity === 'danger' ? 'rotating_light' : x.severity === 'caution' ? 'warning' : 'chart_with_upwards_trend'],
      }),
    });
    if (!res.ok) { console.log(`notify: ntfy refused "${x.title}" (${res.status})`); continue; }
    done.add(x.id);
    console.log(`notify: sent "${x.title}"`);
  }
  sent[day] = [...done];
  fs.writeFileSync(file, JSON.stringify(sent, null, 2) + '\n');
  if (!fresh.length) console.log('notify: nothing new');
}
main().catch(e => { console.log('notify: failed', e.message); process.exitCode = 0; });
