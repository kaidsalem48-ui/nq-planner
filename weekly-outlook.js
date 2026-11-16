/* Calendar-backed weekly outlook. Returns plain text; the view escapes it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NQWeeklyOutlook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function dayOf(date) { return new Date(date + 'T12:00:00Z').getUTCDay(); }
  function weekday(date) { return WEEKDAY[dayOf(date)]; }
  function shortDay(date) { return DAY[dayOf(date)]; }
  function timeLabel(time) {
    if (time == null || time === '') return '';
    const match = String(time).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return String(time);
    const hour = Number(match[1]);
    return (hour % 12 || 12) + ':' + match[2] + (hour < 12 ? ' AM' : ' PM');
  }
  function list(items) {
    if (items.length < 2) return items[0] || '';
    if (items.length === 2) return items.join(' and ');
    return items.slice(0, -1).join(', ') + ', and ' + items.at(-1);
  }
  function eventKind(name) {
    if (/FOMC.*(?:rate|decision)|rate decision/i.test(name)) return 'decision';
    if (/Non.?Farm|Payroll/i.test(name)) return 'payrolls';
    if (/\bCPI\b|Consumer Price Index/i.test(name)) return 'cpi';
    if (/\bGDP\b/i.test(name) && /\bPCE\b/i.test(name)) return 'gdpPce';
    if (/Retail Sales/i.test(name) && /\bPPI\b/i.test(name)) return 'retailPpi';
    if (/ISM Manufacturing/i.test(name) && /JOLTS/i.test(name)) return 'manufacturingJolts';
    if (/\bPCE\b/i.test(name)) return 'pce';
    if (/\bGDP\b/i.test(name)) return 'gdp';
    if (/Retail Sales/i.test(name)) return 'retail';
    if (/FOMC Minutes/i.test(name)) return 'minutes';
    if (/\bPPI\b|Producer Price/i.test(name)) return 'ppi';
    if (/ISM Services/i.test(name)) return 'services';
    if (/ISM Manufacturing/i.test(name)) return 'manufacturing';
    if (/JOLTS/i.test(name)) return 'jolts';
    if (/ADP/i.test(name)) return 'adp';
    if (/Jobless Claims/i.test(name)) return 'claims';
    if (/Consumer Confidence|Sentiment/i.test(name)) return 'sentiment';
    if (/Philly Fed|Empire State/i.test(name)) return 'regional';
    if (/Fed Chair Press Conference/i.test(name)) return 'presser';
    return 'other';
  }
  const WEIGHT = {
    decision: 110, payrolls: 105, cpi: 100, gdpPce: 98, pce: 95, gdp: 90,
    retailPpi: 90, manufacturingJolts: 80,
    retail: 80, minutes: 78, ppi: 75, services: 72, manufacturing: 70,
    jolts: 65, presser: 62, adp: 58, sentiment: 52, claims: 42,
    regional: 38, other: 35
  };
  function isElection(day) {
    return !!(day.electionDay || (day.notes || []).some(note =>
      /^(?:Your Election Day rule:|(?:Midterm )?Election Day$)/i.test(note)));
  }
  function releases(days) {
    return days.flatMap(day => (day.news || []).map(event => ({
      date: day.date, name: String(event.name || ''), time: event.time || '',
      impact: event.impact || 'orange', estimated: !!event.est || /\(est\.\)/i.test(event.name || ''),
      kind: eventKind(event.name || '')
    })));
  }
  function mainEvents(items) {
    return items.filter(event => event.kind !== 'presser')
      .sort((a, b) => (WEIGHT[b.kind] + (b.impact === 'red' ? 4 : 0)) -
        (WEIGHT[a.kind] + (a.impact === 'red' ? 4 : 0)) ||
        a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
  }
  function when(event) { return weekday(event.date) + (event.time ? ' at ' + timeLabel(event.time) + ' NY' : ''); }
  function name(event) {
    const names = {
      decision: 'The Fed rate decision', payrolls: 'Nonfarm Payrolls', cpi: 'CPI',
      gdpPce: 'GDP and Core PCE', retailPpi: 'Retail Sales and PPI',
      manufacturingJolts: 'ISM Manufacturing and JOLTS',
      pce: 'PCE', gdp: 'GDP', retail: 'Retail Sales', minutes: 'FOMC minutes',
      ppi: 'PPI', services: 'ISM Services PMI', manufacturing: 'ISM Manufacturing PMI',
      jolts: 'JOLTS', adp: 'ADP employment'
    };
    return names[event.kind] || event.name;
  }
  function theme(first, second, redCount) {
    if (!first) return 'A lighter week on the calendar.';
    if (first.kind === 'decision') return 'Fed week.';
    if (first.kind === 'payrolls') return 'Jobs week.';
    if (first.kind === 'gdpPce') return 'Growth and inflation week.';
    if (first.kind === 'retailPpi') return 'Inflation and consumer-data week.';
    if (first.kind === 'manufacturingJolts') return 'Business activity and jobs week.';
    if (['cpi', 'pce', 'ppi'].includes(first.kind)) return 'Inflation week.';
    if (first.kind === 'gdp') return 'Growth and inflation week.';
    if (first.kind === 'retail' && second?.kind === 'minutes') return 'A quieter week with two spots to watch.';
    if (first.kind === 'minutes' && second?.kind === 'retail') return 'A quieter week with two spots to watch.';
    if (redCount <= 1) return 'A lighter week on the calendar.';
    if (first.kind === 'minutes') return 'Fed minutes week.';
    return 'The calendar has a few important checkpoints.';
  }
  function whyItMatters(kind) {
    switch (kind) {
      case 'decision': return 'The statement and guidance can reset rate expectations; price can react again during the press conference.';
      case 'payrolls': return 'Hiring and unemployment can change rate expectations. A surprise may produce a fast, two-way move in the first minutes.';
      case 'cpi': return 'Inflation is the main rate-expectations test. A hotter or cooler print can move yields and NQ quickly in either direction.';
      case 'gdpPce': return 'Growth and inflation land together. The combination can reset rate expectations if either side surprises.';
      case 'retailPpi': return 'Consumer demand and producer inflation land together; their mix can change the growth and rates read.';
      case 'manufacturingJolts': return 'Business activity and job openings test growth and labor demand at the same time.';
      case 'pce': return 'This inflation reading is another check on the path of prices and Fed policy. A surprise can change rate expectations.';
      case 'gdp': return 'Growth data can change how traders read demand and the Fed outlook; the first reaction may not hold.';
      case 'retail': return 'It is the main read on consumer demand; a surprise can change how traders read growth.';
      case 'minutes': return 'These are a record of the prior meeting, not a new rate decision. Details could still shift expectations for the next meeting.';
      case 'ppi': return 'Producer prices add to the inflation picture; compare the result with other price data before assuming a direction.';
      case 'services': return 'Services activity can change the growth and inflation read, particularly when prices or employment surprise.';
      case 'manufacturing': return 'Business activity and prices can affect growth and rate expectations, especially if they surprise.';
      case 'jolts': return 'Job openings are a check on labor demand and can change the read on the Fed outlook.';
      case 'adp': return 'Private hiring is an early labor-market check, but it does not determine the payrolls result.';
      default: return 'The release may change expectations; wait for its actual result and price reaction.';
    }
  }
  function firstParagraph(primary, secondary, all, days) {
    if (!primary) return 'No major economic release is recorded for this week. Follow the saved schedule and watch for confirmed headline risk.';
    let text = name(primary) + ' lands ' + when(primary) + '. ' + whyItMatters(primary.kind);
    if (primary.kind === 'decision') {
      const presser = all.find(event => event.kind === 'presser' && event.date === primary.date);
      if (presser) text = name(primary) + ' lands ' + when(primary) +
        ', followed by the Chair’s press conference at ' + timeLabel(presser.time) + ' NY. ' +
        whyItMatters(primary.kind);
    }
    if (secondary && secondary.date !== primary.date && WEIGHT[secondary.kind] >= 70) {
      const transition = secondary.date < primary.date ? 'Earlier in the week, ' : 'Later in the week, ';
      if (secondary.kind === 'minutes')
        text += ' ' + transition + 'FOMC minutes arrive ' + when(secondary) +
          '. They record the prior meeting, not a new decision. Price may tighten beforehand, then move quickly if details shift Fed expectations.';
      else if (secondary.kind === 'retail')
        text += ' ' + transition + 'Retail Sales arrives ' + when(secondary) +
          ', adding a consumer-demand check.';
      else if (secondary.kind === 'cpi')
        text += ' ' + transition + 'CPI arrives ' + when(secondary) +
          ', testing inflation and rate expectations again.';
      else
        text += ' ' + transition + name(secondary) + ' arrives ' + when(secondary) +
          ', giving the week a second possible volatility point.';
    }
    const election = days.find(isElection);
    if (election) text += ' Election Day on ' + weekday(election.date) + ' adds headline risk.';
    return text;
  }
  function secondParagraph(primary, secondary, all, days) {
    const used = new Set([primary?.date + ':' + primary?.time, secondary?.date + ':' + secondary?.time]);
    const others = all.filter(event => !used.has(event.date + ':' + event.time) &&
      event.kind !== 'presser').sort((a, b) => a.date.localeCompare(b.date) ||
      String(a.time).localeCompare(String(b.time)));
    const interesting = others.filter(event => event.impact === 'red' || ['claims', 'regional'].includes(event.kind));
    const specials = [];
    for (const day of days) {
      if (day.holidayType === 'closed') specials.push(weekday(day.date) + ' is ' + day.holiday + ', when the planner marks markets closed');
      else if (day.holidayType === 'bank') specials.push(weekday(day.date) + ' is a bank holiday with futures marked open');
      else if (day.holidayType === 'half') specials.push(weekday(day.date) + ' is a shortened session');
      if (day.opex) specials.push(weekday(day.date) + ' is ' +
        (day.expiryLabel === 'OPEX' || !day.expiryLabel ? 'monthly options expiration' : day.expiryLabel));
    }
    const details = interesting.slice(0, 3).map(event =>
      weekday(event.date) + '’s ' + name(event).replace(/\s*\(est\.\)/gi, '') +
      (event.estimated ? ' (estimated)' : ''));
    if (!details.length && !specials.length) return '';
    let text = details.length ? 'Elsewhere, ' + list(details) + ' ' +
      (details.length === 1 ? 'is' : 'are') + ' on the calendar.' : '';
    if (specials.length) text += (text ? ' ' : '') + list(specials) + '.';
    return text;
  }
  function keyEvents(days, primary, secondary) {
    return days.filter(day => (day.news || []).length || day.holiday || day.opex || isElection(day))
      .map(day => ({
        date: day.date,
        weekday: shortDay(day.date),
        items: [
          ...(isElection(day) ? [{name: 'Election Day', impact: 'special', time: '', main: true}] : []),
          ...(day.holiday ? [{name: day.holiday + (day.holidayType === 'bank' ? ' (bank holiday; futures open)' :
            day.holidayType === 'closed' ? ' (markets closed)' : ' (shortened session)'),
            impact: 'special', time: '', main: true}] : []),
          ...(day.news || []).map(event => ({
            name: String(event.name || ''), time: event.time || '',
            impact: event.impact || 'orange',
            estimated: !!event.est || /\(est\.\)/i.test(event.name || ''),
            main: [primary, secondary].some(lead => lead && lead.date === day.date &&
              lead.time === event.time && lead.name === event.name)
          })),
          ...(day.opex ? [{name: day.expiryLabel === 'OPEX' || !day.expiryLabel ?
            'Monthly options expiration' : day.expiryLabel, impact: 'special', time: '', main: true}] : [])
        ]
      }));
  }
  function tradingPlan(days, primary, secondary) {
    const rules = [];
    const election = days.find(isElection);
    if (election) rules.push(weekday(election.date) + ': follow your saved rule to stop trading after 9:30 AM NY.');
    const decision = days.find(day => (day.news || []).some(event => eventKind(event.name || '') === 'decision'));
    if (decision) rules.push(weekday(decision.date) + ': follow the saved FOMC restrictions.');
    const minutes = days.find(day => (day.news || []).some(event => eventKind(event.name || '') === 'minutes'));
    if (minutes && !decision) {
      const mainGreen = (minutes.segs || []).find(segment => segment[2] === 'g' &&
        Number(String(segment[0]).split(':')[0]) >= 9);
      if (mainGreen) rules.push(weekday(minutes.date) + ': the saved main window ends at ' +
        timeLabel(mainGreen[1]) + ' NY ahead of the minutes.');
    }
    const expiry = days.find(day => day.opex);
    if (expiry) rules.push(weekday(expiry.date) + ': use the saved 1:1, no-partials expiry plan.');
    if (!rules.length && (primary?.impact === 'red' || secondary?.impact === 'red'))
      rules.push('Respect the saved red-folder blackout and trade only when a clean setup appears in a green window.');
    return rules.join(' ');
  }
  function build(model) {
    const days = (model?.days || []).filter(day => day && typeof day.date === 'string' &&
      dayOf(day.date) > 0 && dayOf(day.date) < 6)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const all = releases(days);
    if (!days.length) return {
      theme: 'No weekly calendar yet.',
      paragraphs: ['No recorded weekday coverage is available for this week.'],
      events: [], plan: '', partial: true
    };
    const ranked = mainEvents(all);
    const primary = ranked[0] || null;
    const secondary = ranked.find(event => event !== primary &&
      (event.date !== primary?.date || event.kind !== primary?.kind)) || null;
    const redCount = all.filter(event => event.impact === 'red' && event.kind !== 'presser').length;
    const paragraphs = [firstParagraph(primary, secondary, all, days)];
    const second = secondParagraph(primary, secondary, all, days);
    if (second) paragraphs.push(second);
    return {
      theme: (model.missing || 0) > 0 ? 'Partial weekly outlook.' : theme(primary, secondary, redCount),
      paragraphs, events: keyEvents(days, primary, secondary),
      plan: tradingPlan(days, primary, secondary), partial: !!model.missing
    };
  }
  return {build, timeLabel};
});
