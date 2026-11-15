'use strict';
const crypto = require('node:crypto');
const REPO = 'kaidsalem48-ui/nq-planner-push-state';
const BASE = `https://api.github.com/repos/${REPO}/contents/subscriptions`;

function idFor(endpoint) { return crypto.createHash('sha256').update(endpoint).digest('hex'); }
function headers() {
  if (!process.env.GITHUB_PUSH_TOKEN) throw new Error('Push storage is not configured');
  return { Authorization: `Bearer ${process.env.GITHUB_PUSH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nq-planner-push' };
}
async function github(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...options.headers }, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Private push store returned ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
async function get(endpoint) {
  const id = idFor(endpoint);
  const file = await github(`${BASE}/${id}.json`);
  return file ? { id, sha: file.sha, value: JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8')) } : { id, sha: null, value: null };
}
async function save(endpoint, value, sha) {
  const id = idFor(endpoint);
  await github(`${BASE}/${id}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Update NQ Planner push device ${id.slice(0, 10)}`, content: Buffer.from(JSON.stringify(value)).toString('base64'), ...(sha ? { sha } : {}) }) });
}
async function remove(endpoint) {
  const { id, sha } = await get(endpoint);
  if (sha) await github(`${BASE}/${id}.json`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Remove NQ Planner push device ${id.slice(0, 10)}`, sha }) });
}
async function list() {
  const files = await github(BASE);
  return Array.isArray(files) ? files.filter(x => x.type === 'file' && /^[a-f0-9]{64}\.json$/.test(x.name)) : [];
}
async function getByFile(file) {
  const response = await github(file.url);
  return response ? { sha: response.sha, value: JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8')) } : null;
}
module.exports = { get, save, remove, list, getByFile };
