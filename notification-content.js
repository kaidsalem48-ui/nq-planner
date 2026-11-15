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
  const label=day=>day?.label==='Great'?'Great':day?.label==='Good'?'Good':day?.label==='Light'?'Light':day?.label==='Sit out'?'Sit out':'OK';
  const redNews=day=>(day?.news||[]).filter(item=>item.impact==='red'||/sentiment|consumer confidence/i.test(item.name)).sort((a,b)=>toMinute(a.time)-toMinute(b.time));
  function preview(day,following){
    if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day.date))return null;
    const date=day.date,news=redNews(day),main=news.find(item=>/FOMC Rate Decision|\bCPI\b|Non-Farm Payrolls/i.test(item.name))||news[0];
    const next=redNews(following).find(item=>/\bCPI\b|Non-Farm Payrolls|FOMC Rate Decision/i.test(item.name));
    const grade=label(day),overnight=' Overnight range is checked when verified data arrives.';
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
      title=`Light tomorrow · ${day.holiday||'half day'}`;
      message=`Early-close session${close?` at ${timeLabel(close[0])} NY`:''}. Size light if trading; wait for clean price action.`;severity='caution';
    }else if(day.holidayType==='bank'){
      title=`Light tomorrow · ${day.holiday||'bank holiday'}`;
      message='Futures may be open, but the holiday can thin trading. Size light and keep your red windows.';severity='caution';
    }else if(next&&/Day before CPI/i.test(day.why||'')){
      title='Light tomorrow · day before CPI';
      message=`CPI follows at ${timeLabel(next.time)} NY. Small scalps only on your eval account; size down and wait for a clean setup.${overnight}`;severity='caution';
    }else if(next&&/Day before (?:NFP|payrolls)/i.test(day.why||'')){
      title='Light tomorrow · before payrolls';
      message=`Payrolls follow at ${timeLabel(next.time)} NY. Keep size light and stay selective.${overnight}`;severity='caution';
    }else if(/Day before FOMC/i.test(day.why||'')){
      title='Tomorrow: OK · before FOMC';
      message=`The Fed decision follows the next day. Stay selective and take profits sooner.${overnight}`;severity='caution';
    }else if(day.opex||/Your OPEX rule/i.test(day.why||'')){
      title='Light tomorrow · OPEX';message=`Lower probability under your saved rule: target 1:1, no partials.${overnight}`;severity='caution';
    }else if(main){
      const name=main.name.replace(/\s*\(est\.\)/i,' (est.)');
      title=`${grade} tomorrow · ${name} ${timeLabel(main.time)} NY`;
      const context=/\bCPI\b|\bPPI\b/i.test(name)?'Inflation data':/Non-Farm Payrolls|ADP|JOLTS/i.test(name)?'Jobs data':name;
      const second=news.find(item=>item!==main&&toMinute(item.time)>toMinute(main.time));
      message=`${context} is the main catalyst. Stay out in the saved pre-release red window; assess the post-data setup.${second?` Also ${second.name} at ${timeLabel(second.time)} NY.`:''}${/\(est\.\)/i.test(name)?' This time is estimated.':''}${overnight}`;
    }else if(grade==='Sit out'){
      title='Sit out tomorrow';message='The planner has no eligible trading window. Keep the saved calendar restrictions.';
    }else{
      const green=(day.segs||[]).find(seg=>seg[2]==='g'&&toMinute(seg[0])>=480&&toMinute(seg[0])<720);
      title=`${grade} tomorrow · lighter calendar`;
      message=`No red-folder release is scheduled.${green?` Main saved window: ${timeLabel(green[0])}–${timeLabel(green[1])} NY.`:''} Trade only if price action is clean.${overnight}`;
    }
    return {id:`${date}:tomorrow-preview:v1`,day:date,title,message,severity,updatedAt:new Date(nyWallEpoch(addDays(date,-1),21*60)).toISOString(),delivery:'always'};
  }
  function morningSummary(day,assessment,record){
    const range=assessment?.n?.mcOvernightRange,net=assessment?.n?.mcOvernight;
    const signed=value=>(value>0?'+':'')+Number(value.toFixed(2));
    let title,message,severity='info';
    if(typeof range==='number'){
      title=`Overnight range ${range} · ${typeof net==='number'?`net ${signed(net)}`:'net unavailable'} NQ pts`;
      if(assessment.large){message='The verified 6 PM–2 AM NY range meets your 500-point AM sit-out rule. Follow the saved calendar restrictions.';severity='danger';}
      else if(assessment.overnightTrend?.desens==='light'){message='The 500-point range is common recently under your saved rule; size light. Confirm the chart before trading.';severity='caution';}
      else if(assessment.overnightTrend?.desens==='normal'){message='Recent nights have also reached 500+; your desensitization rule leaves normal size. Calendar restrictions still apply.';}
      else message='Below your 500-point AM sit-out threshold. Follow the calendar and confirm a clean setup.';
    }else if(typeof net==='number'){
      title=`Overnight net ${signed(net)} NQ pts · range missing`;
      message=assessment.large?'The net alone crosses 500 points, so the NY AM sit-out rule applies. Full range is still unavailable.':'The full 6 PM–2 AM high–low range is not verified. Net move alone cannot clear your 500-point rule.';severity=assessment.large?'danger':'caution';
    }else{
      title='Overnight move · awaiting verified data';
      message='The full 6 PM–2 AM NY range is not verified by 8 AM. Do not treat missing data as a small move; check Updates for the later reading.';severity='caution';
    }
    const source=record?.sources?.find(s=>Array.isArray(s.fields)&&s.fields.includes('mcOvernightRange')&&nyDay(s.asOf)===day&&nyMinute(s.asOf)===119);
    return {id:`${day}:overnight-8am:v1`,day,title,message,severity,updatedAt:new Date(nyWallEpoch(day,480)).toISOString(),observedAt:source?.asOf||null,delivery:'always'};
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
      overnight:['Overnight move','Test only. A verified 6 PM–2 AM NY range would show the points, net move and your AM rule.'],
      vix:['VIX update','Test only. A verified VIX alert would show its level and sizing implication. VIX alone does not lower the day grade.'],
      holiday:['Holiday tomorrow · stay out','Test only. A holiday preview would name the closure and tell you to stay out.'],
      cpi:['Good tomorrow · CPI 8:30 AM NY','Test only. A CPI preview would name the release and your plan to wait for post-data price action.'],
      fomc:['FOMC tomorrow · stay out','Test only. Your saved FOMC rule blocks the day around the rate decision and Chair.'],
      half:['Light tomorrow · half day','Test only. A day-after-Thanksgiving preview would flag the early close and lighter size.']
    };
    const value=examples[type];return value?{title:'Test · '+value[0],message:value[1]}:null;
  }
  const api={preview,morningSummary,testChoices,testSample,nyDay,nyMinute,nyWallEpoch,addDays,timeLabel,toMinute};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NQNotifications=api;
})(typeof globalThis!=='undefined'?globalThis:this);
