'use strict';
const store = require('./_push-store');
const content = require('../notification-content.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers.origin !== 'https://nq-planner.vercel.app') return res.status(403).json({ error: 'Same-origin requests only' });
  const endpoint = req.body?.endpoint, sample = content.testSample(req.body?.type);
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !sample) return res.status(400).json({ error: 'Choose a notification type' });
  try {
    const row = await store.get(endpoint);
    if (!row.value?.subscription || row.value.subscription.endpoint !== endpoint) return res.status(404).json({ error: 'Device alerts are not enabled' });
    if (row.value.lastTestAt && Date.now() - Date.parse(row.value.lastTestAt) < 10000) return res.status(429).json({ error: 'Wait 10 seconds before sending another test' });
    const webpush = await import('web-push');
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys unavailable');
    webpush.setVapidDetails('mailto:nq-planner@users.noreply.github.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    await webpush.sendNotification(row.value.subscription, JSON.stringify({ id: `test:${req.body.type}:${now.getTime()}`, title: sample.title, body: sample.message, day, severity: 'info', updatedAt: now.toISOString(), url: 'https://nq-planner.vercel.app/' }), { TTL: 300, urgency: 'normal' });
    await store.save(endpoint, { ...row.value, lastTestAt: now.toISOString() }, row.sha);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await store.remove(endpoint).catch(() => {});
      return res.status(410).json({ error: 'This device subscription expired. Enable alerts again.' });
    }
    console.error('Push test failed:', error.statusCode || error.message);
    return res.status(503).json({ error: 'Test notification could not be sent' });
  }
};
