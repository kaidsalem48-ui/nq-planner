const assert = require('node:assert/strict');
const test = require('node:test');
const calendar = require('../data.json');
const {build} = require('../weekly-outlook.js');

function week(start, end, missing = 0) {
  return build({
    start, end, missing,
    days: calendar.days.filter(day => day.date >= start && day.date <= end)
  });
}

test('retail sales and minutes week explains distinct catalysts and lists each day', () => {
  const brief = week('2026-11-16', '2026-11-20');
  assert.match(brief.theme, /quieter week/i);
  assert.match(brief.paragraphs[0], /Retail Sales.*Tuesday.*8:30 AM NY/);
  assert.match(brief.paragraphs[0], /FOMC minutes.*Wednesday.*2:00 PM NY/);
  assert.match(brief.paragraphs[0], /prior meeting, not a new decision/);
  assert.match(brief.paragraphs[1], /Thursday.*estimated/);
  assert.match(brief.paragraphs[1], /monthly options expiration/);
  assert.deepEqual(brief.events.map(day => day.weekday), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.equal(brief.events.find(day => day.weekday === 'Mon').items[0].impact, 'orange');
  assert.match(brief.plan, /11:00 AM NY.*minutes/);
  assert.doesNotMatch(JSON.stringify(brief), /9:25/);
});

test('jobs week puts payrolls ahead of earlier events and preserves Election Day rule', () => {
  const brief = week('2026-11-02', '2026-11-06');
  assert.equal(brief.theme, 'Jobs week.');
  assert.match(brief.paragraphs[0], /Nonfarm Payrolls.*Friday/);
  assert.match(brief.paragraphs[0], /Earlier in the week, ISM Services PMI arrives Wednesday/);
  assert.match(brief.paragraphs[0], /Election Day on Tuesday/);
  assert.match(brief.plan, /stop trading after 9:30 AM NY/);
});

test('decision week distinguishes decision, press conference and next-day CPI', () => {
  const brief = week('2026-12-07', '2026-12-11');
  assert.equal(brief.theme, 'Fed week.');
  assert.match(brief.paragraphs[0], /Wednesday at 2:00 PM NY/);
  assert.match(brief.paragraphs[0], /press conference at 2:30 PM NY/);
  assert.match(brief.paragraphs[0], /CPI arrives Thursday at 8:30 AM NY/);
  assert.match(brief.plan, /saved FOMC restrictions/);
});

test('incomplete coverage stays explicit and does not claim a quiet week', () => {
  const brief = build({start:'2026-12-28', end:'2027-01-02', missing:3, days:[]});
  assert.equal(brief.partial, true);
  assert.match(brief.paragraphs[0], /No recorded weekday coverage/);
  assert.deepEqual(brief.events, []);
});

test('calendar names remain plain text for the view to escape', () => {
  const brief = build({
    start:'2026-12-21', end:'2026-12-26',
    days:[{date:'2026-12-22', news:[{name:'<img src=x onerror=alert(1)>', time:'8:30', impact:'orange'}]}]
  });
  assert.match(brief.events[0].items[0].name, /<img/);
  assert.doesNotMatch(brief.paragraphs[0], /<strong>|<p>/);
});
