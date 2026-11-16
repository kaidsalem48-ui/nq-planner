'use strict';
const assert = require('node:assert/strict');
const store = require('../api/_push-store.js');

const endpoint = 'https://push.example.test/device';
const originalFetch = global.fetch;
const originalToken = process.env.GITHUB_PUSH_TOKEN;
process.env.GITHUB_PUSH_TOKEN = 'test-token';

let state = {
  subscription: { endpoint },
  sentIds: ['sent-before'],
  plans: { '2026-11-16': ['9:30-10:00'] },
  lastTestAt: null
};
let sha = 'first-sha';
let writes = 0;
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
global.fetch = async (_url, options = {}) => {
  if (!options.method || options.method === 'GET') return response(200, { sha, content: Buffer.from(JSON.stringify(state)).toString('base64') });
  assert.equal(options.method, 'PUT');
  const body = JSON.parse(options.body);
  writes++;
  if (writes === 1) {
    assert.equal(body.sha, 'first-sha');
    // The scheduled dispatcher saved another alert between this request's read and write.
    state = { ...state, sentIds: ['sent-before', 'sent-during-test'] };
    sha = 'second-sha';
    return response(409, {});
  }
  assert.equal(body.sha, sha);
  state = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  sha = 'third-sha';
  return response(200, {});
};

(async () => {
  const testAt = '2026-11-16T14:00:00.000Z';
  const updated = await store.update(endpoint, current => ({ ...current, lastTestAt: testAt }));
  assert.equal(writes, 2, 'A conflict must refetch and retry');
  assert.deepEqual(updated.value.sentIds, ['sent-before', 'sent-during-test']);
  assert.deepEqual(state.plans, { '2026-11-16': ['9:30-10:00'] });
  assert.equal(state.lastTestAt, testAt);

  await store.update(endpoint, current => ({ ...current, plans: { ...current.plans, '2026-11-17': ['9:30-10:30'] } }));
  assert.deepEqual(state.sentIds, ['sent-before', 'sent-during-test']);
  assert.equal(state.lastTestAt, testAt);
  assert.deepEqual(state.plans['2026-11-17'], ['9:30-10:30']);
  console.log('push store retry and merge tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_PUSH_TOKEN;
  else process.env.GITHUB_PUSH_TOKEN = originalToken;
});
