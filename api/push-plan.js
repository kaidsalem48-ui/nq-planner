'use strict';
const store = require('./_push-store');
const calendar = require('../data.json');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers.origin !== 'https://nq-planner.vercel.app') return res.status(403).json({ error: 'Same-origin requests only' });
  const endpoint = req.body?.endpoint, requested = req.body?.plans;
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).length > 40) return res.status(400).json({ error: 'Invalid alert windows' });
  try {
    const row = await store.get(endpoint);
    if (!row.value?.subscription || row.value.subscription.endpoint !== endpoint) return res.status(404).json({ error: 'Enable device alerts first' });
    const byDate = new Map((calendar.days || []).map(day => [day.date, day]));
    const plans = { ...(row.value.plans || {}) };
    for (const [date, blocks] of Object.entries(requested)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(blocks) || blocks.length > 30 || !byDate.has(date)) return res.status(400).json({ error: 'Unknown day or alert window' });
      const allowed = new Set((byDate.get(date).segs || []).map(seg => seg[0] + '-' + seg[1]));
      if (blocks.some(key => typeof key !== 'string' || !allowed.has(key))) return res.status(400).json({ error: 'Unknown alert window' });
      plans[date] = [...new Set(blocks)];
    }
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    for (const date of Object.keys(plans)) if (date < cutoff) delete plans[date];
    await store.save(endpoint, { ...row.value, plans, updatedAt: new Date().toISOString() }, row.sha);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Push window settings failed:', error.message);
    return res.status(503).json({ error: 'Could not save alert windows' });
  }
};
