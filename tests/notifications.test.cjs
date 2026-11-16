'use strict';
const assert = require('node:assert/strict');
const data = require('../data.json');
const content = require('../notification-content.js');
const dispatch = require('../scripts/dispatch-push.cjs');
const {shouldDeliver,ttlFor}=require('../api/push-dispatch.js');

const day = date => data.days.find(item => item.date === date);
const ny = (date, minute) => content.nyWallEpoch(date, minute);
const previewAt = date => dispatch.previewEvents(ny(date, 21 * 60));

// The alert is keyed to the following New York calendar day, even at the DST changes.
assert.equal(content.addDays('2026-03-08', 1), '2026-03-09');
assert.equal(new Date(ny('2026-03-08', 21 * 60)).toISOString(), '2026-03-09T01:00:00.000Z');
assert.equal(new Date(ny('2026-11-01', 21 * 60)).toISOString(), '2026-11-02T02:00:00.000Z');
assert.equal(content.nyDay(ny('2026-11-01', 21 * 60)), '2026-11-01');

// A 9 PM notification has a stable ID through the retry window; none is due outside it.
assert.equal(dispatch.previewEvents(ny('2026-12-08', 20 * 60 + 59)).length, 0);
const fomcAtNine = previewAt('2026-12-08');
assert.equal(fomcAtNine.length, 1);
assert.equal(fomcAtNine[0].id, '2026-12-09:tomorrow-preview:v1');
assert.equal(dispatch.previewEvents(ny('2026-12-08', 21 * 60 + 9))[0].id, fomcAtNine[0].id);
assert.equal(dispatch.previewEvents(ny('2026-12-08', 21 * 60 + 10)).length, 0);
assert.equal(dispatch.scheduledEvents(ny('2026-12-08', 21 * 60)).filter(item => item.id.includes('tomorrow-preview')).length, 1);
assert.equal(ttlFor({id:'2026-11-16:tomorrow-preview:v1',delivery:'always'}),600);
assert.equal(ttlFor({id:'2026-11-16:selected-window:9:30-10:00',delivery:'selected-window'}),0,'A 9 AM reminder must not arrive well after its window starts');
assert.equal(ttlFor({id:'2026-11-16:news:8:30',delivery:'always'}),0,'Pre-release news must not arrive after the release');
assert.equal(ttlFor({id:'2026-11-16:overnight-8am:v1',delivery:'always'}),300);
assert.equal(dispatch.eventsForMode(['--news'],ny('2026-12-08',21*60))[0].id,'2026-12-09:tomorrow-preview:v1','Already-running recorders still call the legacy mode');

// Closure and half-day language must take priority over ordinary grades and news.
const thanksgiving = previewAt('2026-11-25')[0];
assert.equal(thanksgiving.day, '2026-11-26');
assert.equal(thanksgiving.severity, 'danger');
assert.match(thanksgiving.title, /Markets closed tomorrow.*Thanksgiving/);
assert.match(thanksgiving.message, /Stay out/);
const afterThanksgiving = previewAt('2026-11-26')[0];
assert.equal(afterThanksgiving.day, '2026-11-27');
assert.equal(afterThanksgiving.severity, 'caution');
assert.match(afterThanksgiving.title, /Light day tomorrow.*Day after Thanksgiving/);
assert.match(afterThanksgiving.message, /Size light/);

// A rate-decision day is blocked; FOMC Minutes with an OK grade is a distinct event.
assert.equal(fomcAtNine[0].severity, 'danger');
assert.match(fomcAtNine[0].title, /FOMC tomorrow.*stay out/);
assert.match(fomcAtNine[0].message, /Decision 2:00 PM NY/);
const minutes = previewAt('2026-11-17')[0];
assert.equal(minutes.day, '2026-11-18');
assert.equal(minutes.severity, 'info');
assert.match(minutes.title, /FOMC Minutes/);
assert.doesNotMatch(minutes.title, /stay out/i);

// Use the scheduled release and the saved grade, with explicit source uncertainty.
const cpi = previewAt('2026-12-09')[0];
assert.equal(cpi.day, '2026-12-10');
assert.match(cpi.title, /Great day tomorrow.*CPI 8:30 AM NY/);
assert.match(cpi.message, /post-data setup/);
const tentative = content.preview({ date: '2026-11-19', label: 'Good', news: [{ time: '8:30', name: 'Jobless Claims (est.)', impact: 'red' }] });
assert.match(tentative.title, /\(est\.\)/);
assert.match(tentative.message, /time is estimated/i);
const beforeCpi = content.preview({ date: '2026-12-09', label: 'Light', why: 'Day before CPI', news: [] }, day('2026-12-10'));
assert.match(beforeCpi.title, /Light day tomorrow.*day before CPI/);
const monday = day('2026-11-16');
assert.equal(monday.label, 'OK', 'A non-red Empire State release does not lower the saved grade');
assert(monday.news.some(item => item.name === 'Empire State Manufacturing Survey' && item.time === '8:30' && item.impact === 'orange'));
const mondayPreview = previewAt('2026-11-15')[0];
assert.match(mondayPreview.title, /^OK day tomorrow.*Empire State Manufacturing Survey 8:30 AM NY/);
assert.equal(mondayPreview.message, 'No red folder tmrw. Prime time: 9:30–10:00 AM NY.');
assert.equal(content.preview(day('2026-11-12')).message, 'No red folder tmrw. No green window; size light or skip.');
for(const calendarDay of data.days)assert.doesNotMatch(content.preview(calendarDay).message, /overnight range/i, 'The 9 PM preview leaves overnight readings to the separate 8 AM alert');
assert.match(beforeCpi.message, /size down/i);

// At 8 AM, unknown overnight data is not turned into a small or safe move.
const awaiting = content.morningSummary('2026-11-16', { n: {} }, null);
assert.equal(awaiting.severity, 'caution');
assert.match(awaiting.title, /awaiting verified data/);
assert.match(awaiting.message, /Do not treat missing data as a small move/);
assert.equal(dispatch.morningEvents(ny('2026-11-16', 7 * 60 + 59)).length, 0);
assert.equal(dispatch.morningEvents(ny('2026-11-16', 8 * 60)).length, 1);
assert.equal(dispatch.morningEvents(ny('2026-11-16', 8 * 60))[0].id, '2026-11-16:overnight-8am:v1');
assert.equal(dispatch.morningEvents(ny('2026-11-16', 8 * 60 + 10)).length, 0);
assert.equal(dispatch.morningEvents(ny('2026-11-26', 8 * 60)).length, 0, 'Closed holidays do not get an overnight trading alert');

const overnightSource = { sources: [{ asOf: '2026-11-04T01:59:00-05:00', fields: ['mcOvernightRange'] }] };
const restricted = content.morningSummary('2026-11-04', { n: { mcOvernightRange: 896.25, mcOvernight: -193 }, large: true }, overnightSource);
assert.equal(restricted.severity, 'danger');
assert.match(restricted.title, /Overnight range 896\.25.*net -193/);
assert.match(restricted.message, /500-point AM sit-out rule/);
assert.equal(restricted.observedAt, '2026-11-04T01:59:00-05:00');
const incompleteRange = content.morningSummary('2026-11-04', { n: { mcOvernight: 75 }, large: false }, null);
assert.match(incompleteRange.title, /range missing/);
assert.match(incompleteRange.message, /cannot clear your 500-point rule/);

// The selected-window reminder fires only in its lead window and remains conditional.
assert.equal(dispatch.windowEvents(ny('2026-11-17', 7 * 60 + 59)).some(item => item.windowKey === '8:30-9:25'), false);
const windows = dispatch.windowEvents(ny('2026-11-17', 8 * 60));
assert(windows.some(item => item.windowKey === '8:30-9:25' && item.delivery === 'selected-window'));
assert(windows.every(item => /Check live Updates before trading/.test(item.message)));
assert(dispatch.windowEvents(ny('2026-11-17', 8 * 60 + 2)).some(item => item.windowKey === '8:30-9:25'));
assert.equal(dispatch.windowEvents(ny('2026-11-17', 8 * 60 + 10)).some(item => item.windowKey === '8:30-9:25'), false);
assert.equal(dispatch.windowEvents(ny('2026-11-26', 8 * 60)).length, 0);

// Test choices are samples, never invented live market observations.
for (const choice of content.testChoices) {
  const sample = content.testSample(choice.type);
  assert(sample && sample.title.startsWith('Test · '));
  assert.match(sample.message, /Test only/);
}
assert.equal(content.testSample('unknown'), null);

// A device's picked windows gate live snapshots, while scheduled essentials remain on.
const picked={'2026-11-17':['8:30-9:25']},snapshot={day:'2026-11-17',delivery:'window-if-picked'};
assert.equal(shouldDeliver(snapshot,picked,'2026-11-17',8*60),true);
assert.equal(shouldDeliver(snapshot,picked,'2026-11-17',9*60+24),true);
assert.equal(shouldDeliver(snapshot,picked,'2026-11-17',9*60+25),false);
assert.equal(shouldDeliver(snapshot,picked,'2026-11-18',8*60),false);
assert.equal(shouldDeliver(snapshot,{},'2026-11-17',9*60+25),true);
assert.equal(shouldDeliver({day:'2026-11-17',delivery:'selected-window',windowKey:'8:30-9:25'},picked,'2026-11-17',8*60),true);
assert.equal(shouldDeliver({day:'2026-11-17',delivery:'selected-window',windowKey:'8:30-9:25'},picked,'2026-11-17',8*60+11),false,'A delayed 8 AM reminder is stale after its lead window');
assert.equal(shouldDeliver({day:'2026-11-17',delivery:'selected-window',windowKey:'9:30-10:25'},picked,'2026-11-17',9*60),false);
assert.equal(shouldDeliver({id:'2026-11-17:news:8:30',day:'2026-11-17',delivery:'always'},picked,'2026-11-17',8*60+28),true);
assert.equal(shouldDeliver({id:'2026-11-17:news:8:30',day:'2026-11-17',delivery:'always'},picked,'2026-11-17',8*60+30),false,'Pre-release news must not be sent after the print');
assert.equal(shouldDeliver({day:'2026-11-18',delivery:'always'},picked,'2026-11-17',21*60),true);

console.log('notification content and schedule tests passed');
