// Phone push notifications for NQ Planner updates, through ntfy (https://ntfy.sh).
// Runs after each recording (GitHub Actions and the PC backup). It evaluates today's
// readings with the same engine the site uses and pushes only updates not sent before.
// Sent ids are kept in notified.json (committed with the archive) so the cloud and the PC
// never repeat each other.
//
// Phone alert plan: on the site (bell, top right, or any block's "Phone alerts" button) he
// picks the blocks he'll trade each day. The site publishes each day's picks to the private
// channel "<NTFY_TOPIC>-plan". This script merges them into plan.json, encrypted with a key
// made from the channel name (the repo is public), and pushes only while a picked block is
// on, from 30 minutes before it starts until it ends. Nothing picked for a day = only the
// overnight-session updates (always sent by 8 AM).
// At the start of each picked block it sends that block's grade and why; tapping it opens
// the day on the site.
//
// `node notify_updates.cjs --sync-only` only merges the picks (the loop runs it around the
// clock, because ntfy keeps messages for about 12 hours).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const engine = require('./conditions-engine.js');
const here = (...p) => path.join(__dirname, ...p);
// The channel name is private: a GitHub secret in the cloud, a file outside the repo on the PC.
const TOPIC = (process.env.NTFY_TOPIC || '').trim();
if (!TOPIC) { console.log('notify: NTFY_TOPIC not set, skipping'); process.exit(0); }
const SITE = 'https://nq-planner.vercel.app/';
const SKIP = [':stale', ':missing', ':connection']; // housekeeping, not market news
const LEAD = 30; // minutes before a picked block when its pushes start
// Overnight-session updates go out whatever is picked, by 8 AM: the first morning recording
// (6:07) sends them, and later ones catch up if the overnight reading lands late.
const ALWAYS = id => id.includes(':overnight-');

const nyDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const nyMin = t => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)); return +p.find(x => x.type === 'hour').value * 60 + +p.find(x => x.type === 'minute').value; };
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const clock = m => { let h = Math.floor(m / 60) % 24; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m % 60).padStart(2, '0')} ${ap}`; };

// ---------- plan store (encrypted, AES-256-GCM, same scheme the site decrypts) ----------
const PLAN_FILE = here('plan.json');
const planKey = () => crypto.createHash('sha256').update('nq-plan:' + TOPIC).digest();
function readPlan() {
  if (!fs.existsSync(PLAN_FILE)) return { days: {} };
  try {
    const j = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')), buf = Buffer.from(j.data, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', planKey(), Buffer.from(j.iv, 'base64'));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
  } catch (e) { console.log('notify: plan.json unreadable, starting fresh', e.message); return { days: {} }; }
}
function writePlan(plan) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', planKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(plan), 'utf8'), c.final(), c.getAuthTag()]);
  fs.writeFileSync(PLAN_FILE, JSON.stringify({ v: 1, iv: iv.toString('base64'), data: data.toString('base64') }) + '\n');
}
async function syncPlan(now) {
  const plan = readPlan(); plan.days = plan.days || {};
  const before = JSON.stringify(plan.days);
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC + '-plan')}/json?poll=1&since=all`);
    if (!res.ok) throw new Error('ntfy ' + res.status);
    for (const line of (await res.text()).split('\n')) {
      try {
        const m = JSON.parse(line); if (m.event !== 'message') continue;
        const e = JSON.parse(m.message);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Array.isArray(e.blocks)) continue;
        const cur = plan.days[e.date];
        if (!cur || (+e.at || 0) > (cur.at || 0)) plan.days[e.date] = { blocks: e.blocks.filter(k => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(k)), at: +e.at || 0 };
      } catch {}
    }
  } catch (e) { console.log('notify: could not read plan picks', e.message); }
  for (const d of Object.keys(plan.days)) if (d < nyDay(now - 14 * 864e5)) delete plan.days[d];
  if (JSON.stringify(plan.days) !== before) { writePlan(plan); console.log('notify: plan picks updated'); }
  return plan;
}

async function push(body) {
  const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: TOPIC, ...body }) });
  if (!res.ok) console.log(`notify: ntfy refused "${body.title}" (${res.status})`);
  return res.ok;
}

// ---------- "News in 2 min": scheduled ahead with ntfy's delayed delivery ----------
// Every run (recordings and the around-the-clock plan sync) books a push for each news time
// today and the next two days, 2 minutes before it. ntfy holds it and delivers on time, so it
// does not depend on a recording landing at that minute. Sent whatever blocks are picked.
// Booked ids ("DAY:news:8:30") live in notified.json so nothing is booked twice.
const NEWS_LEAD = 2;
function nyEpoch(day, m) { // NY wall time -> epoch ms (handles EST/EDT)
  const [y, mo, d] = day.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, Math.floor(m / 60), m % 60) + 5 * 36e5;
  for (let i = 0; i < 3; i++) {
    const dd = nyDay(t), diff = (dd === day ? 0 : dd < day ? 1440 : -1440) + m - nyMin(t);
    if (!diff) break; t += diff * 6e4;
  }
  return t;
}
async function scheduleNews(now) {
  const file = here('notified.json');
  const sent = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const days = JSON.parse(fs.readFileSync(here('data.json'), 'utf8')).days || [];
  const horizon = [0, 1, 2].map(i => nyDay(now + i * 864e5));
  let changed = false;
  // Never book twice, even if notified.json lost a booking: skip times already queued on ntfy.
  const queued = new Set();
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}/json?poll=1&since=all&scheduled=1`);
    for (const line of (await res.text()).split(/\r?\n/)) { try { const m = JSON.parse(line); if (m.title === 'News in 2 min') queued.add(m.time); } catch {} }
  } catch {}
  for (const dd of days.filter(d => horizon.includes(d.date) && d.holidayType !== 'closed')) {
    const byTime = {};
    for (const n of dd.news || []) (byTime[n.time] = byTime[n.time] || []).push(n);
    for (const [time, list] of Object.entries(byTime)) {
      const id = `${dd.date}:news:${time}`, at = nyEpoch(dd.date, toMin(time)) - NEWS_LEAD * 6e4;
      if ((sent[dd.date] || []).includes(id) || at < now + 30e3) continue;
      if (queued.has(Math.floor(at / 1000))) { (sent[dd.date] = sent[dd.date] || []).push(id); changed = true; continue; }
      const red = list.some(n => n.impact === 'red' || /sentiment|consumer confidence/i.test(n.name));
      const ok = await push({
        title: 'News in 2 min',
        message: `${clock(toMin(time))} · ${list.map(n => `${n.name}${n.impact === 'red' || /sentiment|consumer confidence/i.test(n.name) ? ' (red folder)' : ''}`).join(', ')}`,
        click: `${SITE}#day-${dd.date}`, priority: red ? 4 : 3, tags: [red ? 'red_circle' : 'orange_circle'],
        delay: String(Math.floor(at / 1000)),
      });
      if (ok) { (sent[dd.date] = sent[dd.date] || []).push(id); changed = true; console.log(`notify: booked "News in 2 min" for ${dd.date} ${time}`); }
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(sent, null, 2) + '\n');
}

async function main() {
  const now = Date.now(), day = nyDay(now), min = nyMin(now);
  const plan = await syncPlan(now);
  await scheduleNews(now);
  if (process.argv.includes('--sync-only')) return;

  const base = (JSON.parse(fs.readFileSync(here('data.json'), 'utf8')).days || []).find(d => d.date === day);
  const picks = (plan.days[day]?.blocks || []).map(k => { const [a, b] = k.split('-'); return { key: k, A: toMin(a), B: toMin(b), seg: (base?.segs || []).find(s => s[0] === a && s[1] === b) }; });
  const live = picks.filter(p => min >= p.A - LEAD && min < p.B);
  if (!live.length) console.log(picks.length ? `notify: outside your picked blocks (${picks.map(p => p.key).join(', ')}), only overnight updates go out` : `notify: no blocks picked for ${day}, only overnight updates go out`);

  const file = here('notified.json');
  const sent = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const d of Object.keys(sent)) if (d < nyDay(now - 7 * 864e5)) delete sent[d];
  const done = new Set(sent[day] || []);
  const save = () => { sent[day] = [...done]; fs.writeFileSync(file, JSON.stringify(sent, null, 2) + '\n'); };

  // Block start: the grade and why, tap opens the day.
  for (const p of live) {
    const id = `${day}:block:${p.key}`;
    if (done.has(id)) continue;
    const k = p.seg?.[2], grade = k === 'g' ? 'Trade' : k === 'y' ? 'Risky · light size' : k === 'r' ? 'No trade' : 'Your block';
    const ok = await push({
      title: `${clock(p.A)}–${clock(p.B)} · ${grade}`,
      message: `${p.seg?.[3] ? p.seg[3] + '. ' : ''}Day: ${base?.label || ''}${base?.why ? '. ' + base.why : ''}`.trim(),
      click: `${SITE}#day-${day}`, priority: 3, tags: [k === 'g' ? 'green_circle' : k === 'y' ? 'yellow_circle' : k === 'r' ? 'red_circle' : 'bell'],
    });
    if (ok) { done.add(id); console.log(`notify: block ${p.key} sent`); }
  }

  const record = JSON.parse(fs.readFileSync(here('market-conditions.json'), 'utf8')).days?.[day];
  if (!record) { console.log(`notify: no reading for ${day}`); save(); return; }
  // Same PM-watch eligibility as the site.
  const pmEligible = !!base && base.score !== -2 && !['closed', 'half', 'bank'].includes(base.holidayType)
    && (base.segs || []).some(s => s[2] !== 'r' && toMin(s[0]) < 960 && toMin(s[1]) > 810);
  const a = engine.evaluate(record, { day, now, expiry: '', upcomingExpiry: [], calendarKnown: !!base, closed: base?.holidayType === 'closed', pmEligible });
  const fresh = a.alerts.filter(x => !done.has(x.id) && !SKIP.some(s => x.id.endsWith(s)) && (live.length || ALWAYS(x.id)))
    .sort((x, y) => ({ danger: 0, caution: 1, info: 2 }[x.severity] - { danger: 0, caution: 1, info: 2 }[y.severity]));
  for (const x of fresh) {
    const ok = await push({
      title: x.title, message: x.message, click: SITE,
      priority: x.severity === 'danger' ? 4 : 3,
      tags: [x.severity === 'danger' ? 'rotating_light' : x.severity === 'caution' ? 'warning' : 'chart_with_upwards_trend'],
    });
    if (ok) { done.add(x.id); console.log(`notify: sent "${x.title}"`); }
  }
  save();
  if (!fresh.length) console.log('notify: nothing new');
}
main().catch(e => { console.log('notify: failed', e.message); process.exitCode = 0; });
