'use strict';
const store = require('./_push-store');
const HOST = 'https://nq-planner.vercel.app';
function safeSubscription(value) {
  const sub = value?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048 || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return null;
  try { if (new URL(sub.endpoint).protocol !== 'https:') return null; } catch { return null; }
  if (sub.keys.p256dh.length > 256 || sub.keys.auth.length > 128) return null;
  return { endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null, ready: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.GITHUB_PUSH_TOKEN) });
  if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).end();
  if (req.headers.origin !== HOST) return res.status(403).json({ error: 'Same-origin requests only' });
  const sub = safeSubscription(req.body);
  if (!sub) return res.status(400).json({ error: 'Invalid subscription' });
  try {
    if (req.method === 'DELETE') await store.remove(sub.endpoint);
    else {
      const seeded = Array.isArray(req.body?.currentIds) ? req.body.currentIds.filter(id => typeof id === 'string' && id.length < 180).slice(0, 80) : [];
      await store.update(sub.endpoint, current => ({ subscription: sub, sentIds: current?.sentIds || seeded, plans: current?.plans || {}, lastTestAt: current?.lastTestAt || null, createdAt: current?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Push subscription storage failed:', error.message);
    return res.status(503).json({ error: 'Push subscription storage unavailable' });
  }
};
