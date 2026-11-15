'use strict';
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../conditions-engine.js');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const nyDay = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const nyMinute = time => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)); return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value); };
const toMinute = text => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };
const atNY = time => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(time));
function updateEvents(now) {
  const day = nyDay(now), archive = read('market-conditions.json'), record = archive.days?.[day];
  if (!record) return [];
  const base = (read('data.json').days || []).find(d => d.date === day);
  const history = fs.existsSync(path.join(root, 'overnight-history.json')) ? read('overnight-history.json').ranges : {};
  const pmEligible = !!base && base.score !== -2 && !['closed', 'half', 'bank'].includes(base.holidayType) && (base.segs || []).some(s => s[2] !== 'r' && toMinute(s[0]) < 960 && toMinute(s[1]) > 810);
  const result = engine.evaluate(record, { day, now, recentRanges: engine.recentOvernightRanges(archive, history, day), expiry: '', upcomingExpiry: [], calendarKnown: !!base, closed: base?.holidayType === 'closed', pmEligible });
  const events = result.alerts.filter(a => ![':stale', ':missing', ':connection'].some(s => a.id.endsWith(s))).map(a => ({ ...a, updatedAt: record.recordedAt }));
  events.push({ id: `${day}:snapshot:${record.recordedAt}`, day, title: 'Market conditions updated', message: `New snapshot collected ${atNY(record.recordedAt)} NY. Open NQ Planner to see the recorded conditions and source times.`, severity: 'info', updatedAt: record.recordedAt });
  return events;
}
function newsEvents(now) {
  const day = nyDay(now), minute = nyMinute(now), base = (read('data.json').days || []).find(d => d.date === day);
  if (!base || base.holidayType === 'closed') return [];
  const grouped = new Map();
  for (const item of base.news || []) if (toMinute(item.time) - minute === 2) grouped.set(item.time, [...(grouped.get(item.time) || []), item]);
  return [...grouped].map(([time, list]) => ({ id: `${day}:news:${time}`, day, title: 'News in 2 min', message: `${time} NY · ${list.map(n => n.name).join(', ')}. Check the release before trading.`, severity: list.some(n => n.impact === 'red' || /sentiment|consumer confidence/i.test(n.name)) ? 'danger' : 'caution', updatedAt: new Date(now).toISOString() }));
}
async function dispatch(events) {
  if (!events.length) return console.log('native push: nothing due');
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) return console.log('native push: GitHub Actions OIDC unavailable; skipping local delivery');
  const audience = 'https://nq-planner.vercel.app/api/push-dispatch';
  const tokenURL = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  tokenURL.searchParams.set('audience', audience);
  const authResponse = await fetch(tokenURL, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!authResponse.ok) throw new Error(`GitHub OIDC returned ${authResponse.status}`);
  const token = (await authResponse.json()).value;
  const response = await fetch(audience, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
  if (!response.ok) throw new Error(`Push dispatch returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const result = await response.json();
  console.log(`native push: ${result.sent} delivered, ${result.failed} failed, ${result.removed} expired devices, ${result.events} candidate updates`);
  if (result.failed) process.exitCode = 1;
}
dispatch(process.argv.includes('--news') ? newsEvents(Date.now()) : updateEvents(Date.now())).catch(error => { console.error('native push:', error.message); process.exitCode = 1; });
