/* Shared, calendar-based notification copy. No inferred market readings. */
(function(root){
  'use strict';
  const nyDay=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
  const nyMinute=time=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);};
  const addDays=(day,n)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
  function nyWallEpoch(day,minute){
    const [year,month,date]=day.split('-').map(Number);
    let time=Date.UTC(year,month-1,date,Math.floor(minute/60),minute%60)+5*3600000;
    for(let i=0;i<4;i++){
      const found=nyDay(time),delta=(found===day?0:found<day?1440:-1440)+minute-nyMinute(time);
      if(!delta)break;time+=delta*60000;
    }
    return time;
  }
  const toMinute=value=>{const [hour,minute]=String(value).split(':').map(Number);return hour*60+(minute||0);};
  const timeLabel=value=>{const minute=toMinute(value),hour=Math.floor(minute/60)%24;return `${hour%12||12}:${String(minute%60).padStart(2,'0')} ${hour<12?'AM':'PM'}`;};
  function windowStartEpoch(day,group,key){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(key)||!['segs','asia'].includes(group))return NaN;
    const minute=toMinute(key.split('-')[0]);
    if(!Number.isInteger(minute)||minute<0||minute>=48*60)return NaN;
    // Asia entries belong to the following trading day: 20:00 is the prior
    // evening, while 24:00 and 26:00 are midnight and 2 AM on that day.
    const startDay=group==='asia'&&minute<24*60?addDays(day,-1):day;
    const wallMinute=group==='asia'&&minute>=24*60?minute-24*60:minute;
    if(wallMinute>=24*60)return NaN;
    const epoch=nyWallEpoch(startDay,wallMinute);
    return nyDay(epoch)===startDay&&nyMinute(epoch)===wallMinute?epoch:NaN;
  }
  function windowName(seg,group){
    const name=String(seg?.[3]||'');
    if(group==='asia'){
      if(/Asia kill zone/i.test(name))return 'Asia session';
      if(/London kill zone/i.test(name))return 'London session';
      if(/Late Asia/i.test(name))return 'Late Asia window';
      if(/Globex/i.test(name))return 'Globex window';
    }
    if(/NY AM/i.test(name))return 'NY AM window';
    if(/^PM\b/i.test(name))return 'PM window';
    if(/Lunch/i.test(name))return 'Lunch window';
    return `${timeLabel(seg[0])} window`;
  }
  const label=day=>day?.label==='Great'?'Great':day?.label==='Good'?'Good':day?.label==='Light'?'Light':day?.label==='Sit out'?'Sit out':'OK';
  const redNews=day=>(day?.news||[]).filter(item=>item.impact==='red'||/sentiment|consumer confidence/i.test(item.name)).sort((a,b)=>toMinute(a.time)-toMinute(b.time));
  const isRedNews=item=>item.impact==='red'||/sentiment|consumer confidence/i.test(item.name);
  function newsReminder(time,list){
    const red=list.some(isRedNews);
    return {
      title:red?'Red-folder news in 2 min':'Medium news in 2 min',
      message:`${timeLabel(time)} NY · ${list.map(item=>item.name).join(', ')}. ${red?'Red folder; keep the saved pre-release restriction.':'Medium impact, not red folder; follow your saved window.'}`,
      severity:red?'danger':'info'
    };
  }
  function shouldPushConditionAlert(alert,assessment){
    if([':stale',':missing',':connection'].some(suffix=>alert.id.endsWith(suffix)))return false;
    if(!alert.id.includes(':overnight-1800-0200-'))return true;
    const n=assessment?.n||{};
    if(typeof n.mcOvernightRange==='number')return true;
    const bound=Math.max(typeof n.mcOvernightRangeMin==='number'?n.mcOvernightRangeMin:0,
      typeof n.mcOvernight==='number'?Math.abs(n.mcOvernight):0,
      typeof n.mcOvernightSoFar==='number'?Math.abs(n.mcOvernightSoFar):0);
    if(alert.id.includes('-provisional'))return bound>=500;
    return typeof n.mcOvernightRangeMin==='number'||(typeof n.mcOvernight==='number'&&Math.abs(n.mcOvernight)>0);
  }
  function preview(day,following){
    if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day.date))return null;
    const date=day.date,news=redNews(day),main=news.find(item=>/FOMC Rate Decision|\bCPI\b|Non-Farm Payrolls/i.test(item.name))||news[0];
    const next=redNews(following).find(item=>/\bCPI\b|Non-Farm Payrolls|FOMC Rate Decision/i.test(item.name));
    const grade=label(day);
    let title,message,severity=grade==='Sit out'?'danger':grade==='Light'?'caution':'info';
    if(day.holidayType==='closed'){
      title=`Markets closed tomorrow · ${day.holiday||'holiday'}`;
      message='Stay out. The planner calendar has no trading window tomorrow.';severity='danger';
    }else if(news.some(item=>/FOMC Rate Decision/i.test(item.name))){
      const decision=news.find(item=>/FOMC Rate Decision/i.test(item.name)),chair=news.find(item=>/Fed Chair Press Conference/i.test(item.name));
      title='FOMC tomorrow · stay out';
      message=`Decision ${timeLabel(decision.time)} NY${chair?`; Chair ${timeLabel(chair.time)} NY`:''}. Your saved plan blocks this day.`;severity='danger';
    }else if(day.electionDay||(day.notes||[]).some(note=>/Election Day/i.test(note))||/^Your Election Day rule:/i.test(day.why||'')){
      title='Election Day tomorrow · sit out';message='Your rule: no trading after 9:30 AM NY. Pre-open restrictions remain.';severity='danger';
    }else if(day.holidayType==='half'){
      const close=(day.segs||[]).find(seg=>/closed early/i.test(seg[3]||''));
      const release=(day.news||[]).slice().sort((a,b)=>toMinute(a.time)-toMinute(b.time))[0];
      const releaseText=release?`${release.name} at ${timeLabel(release.time)} NY (${release.impact==='red'?'red folder':'medium impact'}). `:'';
      title=`Light day tomorrow · ${day.holiday||'half day'}`;
      message=`${releaseText}Half-day schedule. Size light if trading.${close?` Your saved sit-out starts at ${timeLabel(close[0])} NY.`:''}`;severity='caution';
    }else if(day.holidayType==='bank'){
      title=`Light day tomorrow · ${day.holiday||'bank holiday'}`;
      message='Futures may be open, but the holiday can thin trading. Size light and keep your red windows.';severity='caution';
    }else if(next&&/Day before CPI/i.test(day.why||'')){
      title='Light day tomorrow · day before CPI';
      message=`CPI follows at ${timeLabel(next.time)} NY. Small scalps only on your eval account; size down and wait for a clean setup.`;severity='caution';
    }else if(next&&/Day before (?:NFP|payrolls)/i.test(day.why||'')){
      title='Light day tomorrow · before payrolls';
      message=`Payrolls follow at ${timeLabel(next.time)} NY. Keep size light and stay selective.`;severity='caution';
    }else if(/Day before FOMC/i.test(day.why||'')){
      title='OK day tomorrow · before FOMC';
      message=`The Fed decision follows the next day. Stay selective and take profits sooner.`;severity='caution';
    }else if(day.opex||/Your OPEX rule/i.test(day.why||'')){
      title='Light day tomorrow · OPEX';message=`Lower probability under your saved rule: target 1:1, no partials.`;severity='caution';
    }else if(main){
      const name=main.name.replace(/\s*\(est\.\)/i,' (est.)');
      title=`${grade} day tomorrow · ${name} ${timeLabel(main.time)} NY`;
      const context=/\bCPI\b|\bPPI\b/i.test(name)?'Inflation data':/Non-Farm Payrolls|ADP|JOLTS/i.test(name)?'Jobs data':name;
      const second=news.find(item=>item!==main&&toMinute(item.time)>toMinute(main.time));
      message=`${context} is the main catalyst. Stay out in the saved pre-release red window; assess the post-data setup.${second?` Also ${second.name} at ${timeLabel(second.time)} NY.`:''}${/\(est\.\)/i.test(name)?' This time is estimated.':''}`;
    }else if(grade==='Sit out'){
      title='Sit out tomorrow';message='The planner has no eligible trading window. Keep the saved calendar restrictions.';
    }else{
      const green=(day.segs||[]).find(seg=>seg[2]==='g'&&toMinute(seg[0])>=570&&toMinute(seg[0])<720)
        ||(day.segs||[]).find(seg=>seg[2]==='g'&&toMinute(seg[0])>=480&&toMinute(seg[0])<720);
      const minor=(day.news||[]).filter(item=>item.impact!=='red').sort((a,b)=>toMinute(a.time)-toMinute(b.time))[0];
      title=minor?`${grade} day tomorrow · ${minor.name} ${timeLabel(minor.time)} NY`:`${grade} day tomorrow · lighter calendar`;
      if(green){
        const start=timeLabel(green[0]),end=timeLabel(green[1]);
        const window=start.slice(-2)===end.slice(-2)?`${start.slice(0,-3)}–${end}`:`${start}–${end}`;
        message=`No red folder tmrw. Prime time: ${window} NY.`;
      }else message='No red folder tmrw. No green window; size light or skip.';
    }
    return {id:`${date}:tomorrow-preview:v1`,day:date,title,message,severity,updatedAt:new Date(nyWallEpoch(addDays(date,-1),21*60)).toISOString(),delivery:'always'};
  }
  function morningSummary(day,assessment,record){
    const range=assessment?.n?.mcOvernightRange,minRange=assessment?.n?.mcOvernightRangeMin,net=assessment?.n?.mcOvernight;
    // Missing provider bars are an in-app data-quality state, not a device alert.
    if(typeof range!=='number'&&typeof minRange!=='number'&&!(typeof net==='number'&&Math.abs(net)>0))return null;
    const signed=value=>(value>0?'+':'')+Number(value.toFixed(2));
    const points=value=>Number(value.toFixed(2)).toLocaleString('en-US',{maximumFractionDigits:2});
    const headline=value=>`Overnight move: ${points(value)} points`;
    const riskAction=assessment.restricted?'The calendar sit-out rule still applies.':'Risky day. Size light; calendar red windows still apply.';
    let title,message,severity='info';
    if(typeof range==='number'){
      title=headline(range);
      const reading=`6 PM–2 AM NY high–low range${typeof net==='number'?`; net ${signed(net)} points`:''}.`;
      if(assessment.large){message=`${reading} ${riskAction}`;severity='caution';}
      else message=`${reading} Below 500 points. Follow the calendar plan.`;
    }else if(typeof minRange==='number'){
      title=headline(Math.max(minRange,typeof net==='number'?Math.abs(net):0));
      const reading=`At least ${points(Math.max(minRange,typeof net==='number'?Math.abs(net):0))} points observed from 6 PM–2 AM NY; full range unavailable.`;
      if(assessment.large){message=`${reading} ${riskAction}`;severity='caution';}
      else {message=`${reading} The full range could still exceed 500; follow the calendar plan.`;severity='caution';}
    }else if(typeof net==='number'){
      title=headline(Math.abs(net));
      message=assessment.large?`6 PM–2 AM NY net ${signed(net)} points; full range incomplete. ${riskAction}`:`6 PM–2 AM NY net ${signed(net)} points; full range incomplete. The 500-point threshold is unknown; follow the calendar plan.`;
      severity='caution';
    }
    const sourceKey=typeof range==='number'?'mcOvernightRange':typeof minRange==='number'&&!(typeof net==='number'&&Math.abs(net)>minRange)?'mcOvernightRangeMin':'mcOvernight';
    const source=record?.sources?.find(s=>Array.isArray(s.fields)&&s.fields.includes(sourceKey)&&nyDay(s.asOf)===day);
    const engineAlert=assessment?.alerts?.find(item=>item.id?.includes(':overnight-1800-0200-'));
    return {id:engineAlert?.id||`${day}:overnight-8am:v1`,day,title,message,severity,updatedAt:new Date(nyWallEpoch(day,480)).toISOString(),observedAt:source?.asOf||null,delivery:'always'};
  }
  const testChoices=Object.freeze([
    {type:'overnight',label:'Overnight move'},
    {type:'vix',label:'VIX'},
    {type:'holiday',label:'Holiday stay-out'},
    {type:'cpi',label:'CPI tomorrow'},
    {type:'fomc',label:'FOMC stay-out'},
    {type:'half',label:'Half day'}
  ]);
  function testSample(type){
    const examples={
      overnight:['Overnight move','Test only. A verified 6 PM–2 AM NY range would show the points and Risky grade when it reaches 500. Calendar red windows still apply.'],
      vix:['VIX update','Test only. A verified VIX alert would show its level and sizing implication. VIX alone does not lower the day grade.'],
      holiday:['Holiday tomorrow · stay out','Test only. A holiday preview would name the closure and tell you to stay out.'],
      cpi:['Good day tomorrow · CPI 8:30 AM NY','Test only. A CPI preview would name the release and your plan to wait for post-data price action.'],
      fomc:['FOMC tomorrow · stay out','Test only. Your saved FOMC rule blocks the day around the rate decision and Chair.'],
      half:['Light day tomorrow · half day','Test only. A day-after-Thanksgiving preview would flag the early close and lighter size.']
    };
    const value=examples[type];return value?{title:'Test · '+value[0],message:value[1]}:null;
  }
  const api={preview,morningSummary,newsReminder,shouldPushConditionAlert,testChoices,testSample,nyDay,nyMinute,nyWallEpoch,addDays,timeLabel,toMinute,windowStartEpoch,windowName};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NQNotifications=api;
})(typeof globalThis!=='undefined'?globalThis:this);
