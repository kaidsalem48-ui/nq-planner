// NQ Planner as a calendar feed (Apple Calendar: File > New Calendar Subscription, or tap the
// webcal:// link on the site). Built on each request from the files deployed with the site, so
// the weekly schedule update and every recording (each one redeploys) show up on their own.
//
// Per trading day: an all-day event with the day's grade and why (plus Sit out / Light size from
// the latest market conditions), one event per green or yellow block, and one per news time.
// Red "don't trade" blocks are left out to keep the calendar readable.
//
// Apple Calendar gives every event in one subscribed calendar the same colour, so ?show= splits
// the feed into separate calendars, each subscribed once and coloured on its own:
//   green  = Great/Good days + green blocks      yellow = OK/Light days + yellow blocks
//   red    = Sit out / closed days               news   = news times
// No ?show= gives everything in one calendar.
'use strict';
const data = require('../data.json');
const archive = require('../market-conditions.json');
const engine = require('../conditions-engine.js');
let history = {};
try { history = require('../overnight-history.json').ranges || {}; } catch (e) {}

const SITE = 'https://nq-planner.vercel.app/';
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const nyParts = t => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// New York wall time -> epoch ms (EST/EDT aware). Minutes past 24:00 roll into the next day.
function nyEpoch(day, m) {
  if (m >= 1440) return nyEpoch(addDays(day, 1), m - 1440);
  const [y, mo, d] = day.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, Math.floor(m / 60), m % 60) + 5 * 36e5;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(t), pd = `${p.year}-${p.month}-${p.day}`;
    const diff = (pd === day ? 0 : pd < day ? 1440 : -1440) + m - (+p.hour * 60 + +p.minute);
    if (!diff) break; t += diff * 6e4;
  }
  return t;
}
const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545: lines over 75 octets fold with CRLF + space.
function fold(line) {
  const out = []; let cur = '', len = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (len + b > 74) { out.push(cur); cur = ' '; len = 1; } cur += ch; len += b; }
  out.push(cur); return out.join('\r\n');
}
const clock = m => { let h = Math.floor(m / 60) % 24; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m % 60).padStart(2, '0')} ${ap}`; };
const GRADE = { g: '🟢 Trade', y: '🟡 Risky / light size' };

const FEEDS = { green: ['NQ Good', '#34C759'], yellow: ['NQ Light / risky', '#FFCC00'], red: ['NQ Sit out', '#FF3B30'], news: ['NQ News', '#AF52DE'] };
module.exports = (req, res) => {
  const now = Date.now(), today = engine.nyDate(now), from = addDays(today, -14);
  const show = FEEDS[new URL(req.url || '/', 'https://x').searchParams.get('show')] ? new URL(req.url, 'https://x').searchParams.get('show') : null;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NQ Planner//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${show ? FEEDS[show][0] : 'NQ Planner'}`, ...(show ? [`X-APPLE-CALENDAR-COLOR:${FEEDS[show][1]}`] : []), 'X-WR-TIMEZONE:America/New_York', 'X-WR-CALDESC:NQ trading schedule: day grades\\, trade windows and news (New York times).',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const event = (cls, uid, fields) => { if (show && show !== cls) return; lines.push('BEGIN:VEVENT', `UID:${uid}@nq-planner`, `DTSTAMP:${stamp(now)}`, ...fields, 'END:VEVENT'); };

  for (const dd of (data.days || []).filter(d => d.date >= from)) {
    const day = dd.date, link = `${SITE}#day-${day}`;
    let extra = '', note = '';
    const record = archive.days?.[day];
    if (record) {
      try {
        const a = engine.evaluate(record, { day, now, calendarKnown: true, closed: dd.holidayType === 'closed', recentRanges: engine.recentOvernightRanges(archive, history, day),
          pmEligible: dd.score !== -2 && !['closed', 'half', 'bank'].includes(dd.holidayType) && (dd.segs || []).some(s => s[2] !== 'r' && toMin(s[0]) < 960 && toMin(s[1]) > 810) });
        if (a.restricted && a.level !== dd.label) extra = ' · ' + a.level;
        else if (a.overnightTrend?.desens === 'light') extra = ' · Light size';
        note = '\n\nMarket conditions: ' + a.plan;
      } catch (e) {}
    }
    const blocks = (dd.segs || []).map(([a, b, k, n]) => `${clock(toMin(a))}–${clock(toMin(b))}  ${k === 'g' ? 'Trade' : k === 'y' ? 'Risky' : 'No trade'} · ${n}`).join('\n');
    const news = (dd.news || []).map(n => `${n.time} ${n.name}${n.impact === 'red' ? ' (red folder)' : ''}`).join('\n');
    const next = addDays(day, 1).replace(/-/g, '');
    const dayCls = dd.holidayType === 'closed' || dd.score === -2 || /sit out/i.test(extra) ? 'red' : dd.score >= 1 && !extra ? 'green' : 'yellow';
    event(dayCls, `day-${day}`, [`DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next}`, 'TRANSP:TRANSPARENT',
      `SUMMARY:${esc(`NQ ${dd.label || ''}${extra}`)}`,
      `DESCRIPTION:${esc(`${dd.why || ''}${note}\n\nNews:\n${news || 'No scheduled news'}\n\nBlocks (New York):\n${blocks}\n\n${link}`)}`, `URL:${link}`]);
    if (dd.holidayType === 'closed') continue;
    for (const [a, b, k, n] of dd.segs || []) {
      if (!GRADE[k]) continue;
      event(k === 'g' ? 'green' : 'yellow', `seg-${day}-${a}-${b}`, [`DTSTART:${stamp(nyEpoch(day, toMin(a)))}`, `DTEND:${stamp(nyEpoch(day, toMin(b)))}`, 'TRANSP:TRANSPARENT',
        `SUMMARY:${esc(`${GRADE[k]} · ${n}`)}`, `DESCRIPTION:${esc(`${dd.label || ''} day. ${dd.why || ''}\n\n${link}`)}`, `URL:${link}`]);
    }
    // Asia & London: these blocks belong to this trading day but run the evening before.
    const eve = addDays(day, -1);
    for (const [a, b, k, n] of dd.asia || []) {
      if (!GRADE[k]) continue;
      event(k === 'g' ? 'green' : 'yellow', `asia-${day}-${a}-${b}`, [`DTSTART:${stamp(nyEpoch(eve, toMin(a)))}`, `DTEND:${stamp(nyEpoch(eve, toMin(b)))}`, 'TRANSP:TRANSPARENT',
        `SUMMARY:${esc(`${GRADE[k]} · ${n}`)}`, `DESCRIPTION:${esc(`Overnight session for ${day}.\n\n${link}`)}`, `URL:${link}`]);
    }
    const times = {};
    for (const n of dd.news || []) (times[n.time] = times[n.time] || []).push(n);
    for (const [time, list] of Object.entries(times)) {
      const t = nyEpoch(day, toMin(time)), red = list.some(n => n.impact === 'red');
      event('news', `news-${day}-${time}`, [`DTSTART:${stamp(t)}`, `DTEND:${stamp(t + 5 * 6e4)}`, 'TRANSP:TRANSPARENT',
        `SUMMARY:${esc(`${red ? '🔴' : '🟠'} ${list.map(n => n.name).join(', ')}`)}`, `DESCRIPTION:${esc(`${time} New York news.\n\n${link}`)}`, `URL:${link}`]);
    }
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="nq-planner.ics"');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=900');
  res.end(lines.map(fold).join('\r\n') + '\r\n');
};
