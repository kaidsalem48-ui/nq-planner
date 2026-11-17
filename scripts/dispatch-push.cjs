'use strict';
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../conditions-engine.js');
const content = require('../notification-content.js');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const nyDay = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const nyMinute = time => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)); return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value); };
const toMinute = text => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };
function updateEvents(now) {
  const day = nyDay(now), archive = read('market-conditions.json'), record = archive.days?.[day];
  if (!record) return [];
  const base = (read('data.json').days || []).find(d => d.date === day);
  const result = engine.evaluate(record, { day, now, recentRanges: engine.recentOvernightRanges(archive, {}, day), expiry: '', upcomingExpiry: [], calendarKnown: !!base, closed: base?.holidayType === 'closed', calendarSitOut: base?.score === -2 });
  return result.alerts.filter(a => content.shouldPushConditionAlert(a,result))
    .map(a => ({ ...a, updatedAt: a.observedAt || record.recordedAt, delivery: a.id.includes(':overnight-1800-0200-') ? 'always' : 'window-if-picked' }));
}
function newsEvents(now) {
  const day = nyDay(now), minute = nyMinute(now), base = (read('data.json').days || []).find(d => d.date === day);
  if (!base || base.holidayType === 'closed') return [];
  const grouped = new Map();
  for (const item of base.news || []) if (toMinute(item.time) - minute === 2) grouped.set(item.time, [...(grouped.get(item.time) || []), item]);
  return [...grouped].map(([time, list]) => ({ id: `${day}:news:${time}`, day, ...content.newsReminder(time,list), updatedAt: new Date(now).toISOString(), delivery: 'always' }));
}
function previewEvents(now){
  const minute=nyMinute(now);
  if(minute<1260||minute>=1270)return [];
  const target=content.addDays(nyDay(now),1),days=read('data.json').days||[],base=days.find(d=>d.date===target);
  if(!base)return [];
  const following=days.find(d=>d.date>target&&d.holidayType!=='closed'&&![0,6].includes(new Date(d.date+'T12:00:00Z').getUTCDay()));
  const item=content.preview(base,following);
  return item?[{...item,updatedAt:new Date(now).toISOString()}]:[];
}
function morningEvents(now){
  const minute=nyMinute(now),day=nyDay(now);
  if(minute<480||minute>=490)return [];
  const base=(read('data.json').days||[]).find(d=>d.date===day);
  if(!base||base.holidayType==='closed')return [];
  const archive=read('market-conditions.json'),record=archive.days?.[day];
  const result=engine.evaluate(record,{day,now,recentRanges:engine.recentOvernightRanges(archive,{},day),calendarKnown:true,closed:false,calendarSitOut:base.score===-2});
  const alert=content.morningSummary(day,result,record);
  return alert?[{...alert,updatedAt:alert.observedAt||new Date(now).toISOString()}]:[];
}
function windowEvents(now){
  const today=nyDay(now),currentMinute=Math.floor(now/60000),days=read('data.json').days||[];
  const events=[];
  for(const base of days.filter(d=>[today,content.addDays(today,1)].includes(d.date)&&d.holidayType!=='closed')){
    for(const [group,segments] of [['segs',base.segs||[]],['asia',base.asia||[]]]){
      for(const seg of segments){
        const key=seg[0]+'-'+seg[1],start=content.windowStartEpoch(base.date,group,key);
        if(!Number.isFinite(start))continue;
        const phase=currentMinute===Math.floor((start-5*60000)/60000)?'five':currentMinute===Math.floor(start/60000)?'start':null;
        if(!phase)continue;
        const name=content.windowName(seg,group);
        const plan=seg[2]==='r'?'Sit out under your saved calendar plan.':seg[2]==='y'?'Light size or skip; wait for a clean setup.':'Follow your saved green window; wait for a clean setup.';
        events.push({id:`${base.date}:selected-window:${group}:${key}:${phase}`,day:base.date,
          title:phase==='five'?`${name} begins in five minutes`:`${name} has begun`,
          message:`${content.timeLabel(seg[0])}–${content.timeLabel(seg[1])} NY. ${plan}`,
          severity:seg[2]==='r'?'danger':seg[2]==='y'?'caution':'info',
          updatedAt:new Date(phase==='five'?start-5*60000:start).toISOString(),
          delivery:'selected-window',windowKey:key,windowGroup:group,windowPhase:phase});
      }
    }
  }
  return events;
}
function scheduledEvents(now){return [...newsEvents(now),...previewEvents(now),...morningEvents(now),...windowEvents(now)];}
function eventsForMode(args,now){return args.includes('--check')?[]:args.includes('--scheduled')||args.includes('--news')?scheduledEvents(now):updateEvents(now);}
async function dispatch(events) {
  if (!events.length && !process.argv.includes('--check')) return console.log('native push: nothing due');
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
if(require.main===module)dispatch(eventsForMode(process.argv,Date.now())).catch(error=>{console.error('native push:',error.message);process.exitCode=1;});
module.exports={updateEvents,newsEvents,previewEvents,morningEvents,windowEvents,scheduledEvents,eventsForMode};
