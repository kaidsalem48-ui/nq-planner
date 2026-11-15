'use strict';
const store = require('./_push-store');
const content = require('../notification-content.js');
const AUDIENCE = 'https://nq-planner.vercel.app/api/push-dispatch';
let jwks;
function shouldDeliver(event,plans,currentDay,currentMinute){
  if(event.delivery==='selected-window')return (plans?.[event.day]||[]).includes(event.windowKey);
  if(event.delivery!=='window-if-picked')return true;
  const selected=plans?.[event.day]||[];
  if(!selected.length)return true;
  return event.day===currentDay&&selected.some(key=>{const [start,end]=key.split('-');return currentMinute>=content.toMinute(start)-30&&currentMinute<content.toMinute(end);});
}
async function authenticated(req) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return false;
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  jwks ||= createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: 'https://token.actions.githubusercontent.com', audience: AUDIENCE });
    return payload.repository === 'kaidsalem48-ui/nq-planner' && payload.ref === 'refs/heads/main' && typeof payload.workflow_ref === 'string' && /\/.github\/workflows\/(recorder-loop|record-market-conditions)\.yml@refs\/heads\/main$/.test(payload.workflow_ref);
  } catch { return false; }
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await authenticated(req))) return res.status(401).json({ error: 'Unauthorized' });
  const raw = req.body?.events;
  if (!Array.isArray(raw) || raw.length > 30) return res.status(400).json({ error: 'Invalid events' });
  const events = raw.filter(x => typeof x.id === 'string' && x.id.length < 180 && typeof x.title === 'string' && x.title.length < 180 && typeof x.message === 'string' && x.message.length < 1200 && /^\d{4}-\d{2}-\d{2}$/.test(x.day));
  try {
    const webpush = await import('web-push');
    if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) throw new Error('VAPID keys unavailable');
    webpush.setVapidDetails('mailto:nq-planner@users.noreply.github.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    let sent = 0, removed = 0, failed = 0;
    for (const file of await store.list()) {
      const row = await store.getByFile(file);
      if (!row?.value?.subscription?.endpoint) continue;
      const { subscription, sentIds = [] } = row.value;
      const done = new Set(sentIds);
      const currentDay=content.nyDay(Date.now()),currentMinute=content.nyMinute(Date.now());
      let dead = false;
      for (const event of events) {
        if (done.has(event.id)) continue;
        if (!shouldDeliver(event,row.value.plans,currentDay,currentMinute)) continue;
        try {
          await webpush.sendNotification(subscription, JSON.stringify({ id: event.id, title: event.title, body: event.message, day: event.day, severity: event.severity || 'info', updatedAt: event.updatedAt || new Date().toISOString(), url: `https://nq-planner.vercel.app/?push=${encodeURIComponent(event.id)}` }), { TTL: 3600, urgency: event.severity === 'danger' ? 'high' : 'normal' });
          done.add(event.id); sent++;
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) { await store.remove(subscription.endpoint); removed++; dead = true; break; }
          failed++; console.error('Push delivery failed:', error.statusCode || error.message);
        }
      }
      if (!dead && done.size !== sentIds.length) {
        const keep = [...done].slice(-180);
        try { await store.save(subscription.endpoint, { ...row.value, sentIds: keep, updatedAt: new Date().toISOString() }, row.sha); }
        catch (error) { failed++; console.error('Push deduplication save failed:', error.message); }
      }
    }
    return res.status(200).json({ ok: true, sent, removed, failed, events: events.length });
  } catch (error) {
    console.error('Push dispatch failed:', error.message);
    return res.status(503).json({ error: 'Push dispatch unavailable' });
  }
};
module.exports.shouldDeliver=shouldDeliver;
