/* NQ Planner: transparent condition rules. No predictive probability score. */
(function(root){
  'use strict';
  const TECH=['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA'];
  const RULES=Object.freeze({vix:18,overnightLarge:500,maxAgeMinutes:90});
  const numeric=(n,k)=>typeof n[k]==='number'&&Number.isFinite(n[k])?n[k]:null;
  const nyDate=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
  const nyMinute=t=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return (+p.hour%24)*60+(+p.minute);};
  const signed=v=>(v>0?'+':'')+Number(v.toFixed(2));
  const election=day=>{const d=new Date(day+'T12:00:00Z');return d.getUTCFullYear()%2===0&&d.getUTCMonth()===10&&d.getUTCDay()===2&&d.getUTCDate()>=2&&d.getUTCDate()<=8;};
  function evaluate(record,options){
    const {day,expiry='',calendarKnown=true,closed=false,pmEligible=false}=options;
    const now=options.now??Date.now(),today=nyDate(now),minute=nyMinute(now),live=day===today&&minute>=480&&minute<990;
    const raw=record?.values||{},recordedAt=Date.parse(record?.recordedAt),validSources=(record?.sources||[]).filter(s=>{
      const t=Date.parse(s.asOf);return String(s.url||'').startsWith('https://')&&Array.isArray(s.fields)&&Number.isFinite(t)&&Number.isFinite(recordedAt)&&t<=recordedAt&&recordedAt<=now+60000&&t<=now+60000&&nyDate(t)===day;
    });
    const overnightFinalKeys=new Set(['mcOvernight','mcOvernightRange','mcOvernightType','mcOvernightOpen','mcOvernightHigh','mcOvernightLow','mcOvernightClose','mcOvernightHighMin','mcOvernightLowMin']);
    const sourceCovers=(source,key)=>source.fields.includes(key)&&(!overnightFinalKeys.has(key)||nyMinute(Date.parse(source.asOf))===119)&&(key!=='mcOvernightSoFar'||nyMinute(Date.parse(source.asOf))<119);
    const issues=new Map(),n={};
    function evidence(key,frozen=false){
      const rows=validSources.filter(s=>sourceCovers(s,key)),time=rows.length?Math.min(...rows.map(s=>Date.parse(s.asOf))):null;
      if(raw[key]===undefined||raw[key]===''||!rows.length){issues.set(key,overnightFinalKeys.has(key)&&raw[key]!==undefined?'No 18:00–02:00 NY source':'Missing verified data');return null;}
      if(!frozen&&live&&now-time>RULES.maxAgeMinutes*60000){issues.set(key,'Older than 90 minutes');return null;}
      n[key]=raw[key];return {rows,time};
    }
    function number(key,frozen=false){if(!evidence(key,frozen))return null;const v=numeric(raw,key);if(v===null){delete n[key];issues.set(key,'Invalid numeric data');}return v;}
    function text(key,allowed,frozen=false){if(!evidence(key,frozen))return null;if(!allowed.includes(raw[key])){delete n[key];issues.set(key,'Invalid category');return null;}return raw[key];}
    function timeFor(keys){const rows=validSources.filter(s=>keys.some(k=>sourceCovers(s,k)));return rows.length?Math.min(...rows.map(s=>Date.parse(s.asOf))):null;}
    const groups=[],alerts=[],reasons=[],watch=[];
    function group(id,title,state,reading,meaning,conclusion,keys){const sources=id==='sources'?validSources:validSources.filter(s=>keys.some(k=>sourceCovers(s,k)));groups.push({id,title,state,reading,meaning,conclusion,keys,sources,asOf:id==='sources'&&sources.length?Math.min(...sources.map(s=>Date.parse(s.asOf))):timeFor(keys),missing:keys.filter(k=>issues.has(k))});}
    function alert(key,title,message,severity='caution',measurement=''){alerts.push({id:day+':'+key,day,title,message,severity,measurement});}
    const vix=number('mcVix'),vol=text('mcVol',['Expanding','Contracting','Stable']);
    const vixChange=number('mcVixChange');
    const volState=vix===null?'Unknown':vix>RULES.vix?'Caution':'Observed';
    const vixReading=vix===null?'No current verified VIX observation.':`VIX ${vix.toFixed(2)} · ${vix>18?'above':vix<18?'below':'at'} your 18 threshold${vol?' · '+vol.toLowerCase()+' versus prior close':''}${vixChange!==null?' ('+signed(vixChange)+'%)':''}.`;
    group('volatility','Volatility',volState,vixReading,'Cboe’s VIX measures the swings S&P 500 options imply over the next 30 days. A higher reading points to wider expected swings in either direction.',vix===null?'Wait for a current observation. Missing VIX is not a low-risk reading.':vix>18?`Above your 18 threshold. Allow for faster or wider swings.${vol==='Expanding'?' Reduce aggression under your rising VIX rule.':' Stay selective while the level remains elevated.'}`:'Your VIX caution rule is clear at this reading. Check the other conditions before trading.',['mcVix','mcVol','mcVixChange']);
    if(vix!==null&&vix>18&&vol==='Expanding'){reasons.push('VIX is above 18 and expanding versus prior close.');alert('vix-expanding','Elevated and expanding VIX',vixReading+' Reduce aggression under your saved rule.');}
    else if(vix!==null&&vix>18)watch.push('VIX is above your 18 threshold.');
    const final=number('mcOvernight',true);
    const provisionalNet=numeric(raw,'mcOvernightSoFar');
    // Keep a sourced early-window sit-out in force while waiting for the 02:00 boundary.
    const provisionalStop=provisionalNet!==null&&Math.abs(provisionalNet)>=RULES.overnightLarge;
    const soFar=final===null?number('mcOvernightSoFar',provisionalStop):null;
    const overnight=final??soFar;
    const preliminary=final===null&&soFar!==null;
    const overnightRange=number('mcOvernightRange',true),overnightType=text('mcOvernightType',['Trend up','Trend down','Balanced','Reversal'],true);
    // The 500-point rule uses the full high–low range; without a final range, |net| is a lower bound.
    const useRange=!preliminary&&overnightRange!==null;
    const ruleMove=useRange?overnightRange:overnight===null?null:Math.abs(overnight);
    const large=ruleMove!==null&&ruleMove>=RULES.overnightLarge;
    const pmWatch=large&&!preliminary&&!closed&&!election(day)&&pmEligible;
    const moveLabel=useRange?`Range ${overnightRange} · net ${signed(overnight??0)}`:signed(overnight??0);
    // Both swings of the night: first extreme to second extreme, then second extreme to the 1:59 close.
    const legKeys=['mcOvernightHigh','mcOvernightLow','mcOvernightClose','mcOvernightHighMin','mcOvernightLowMin'];
    const lv=useRange?legKeys.map(k=>number(k,true)):[];
    let legsText='';
    if(lv.length&&lv.every(v=>v!==null)){
      const [hi,lo,close,hiMin,loMin]=lv;
      const at=m=>{const t=(1080+m)%1440,h=Math.floor(t/60),mm=String(t%60).padStart(2,'0');return `${h%12||12}:${mm} ${h<12?'AM':'PM'}`;};
      const pts=v=>Number(v.toFixed(2)).toLocaleString('en-US',{maximumFractionDigits:2});
      const highFirst=hiMin<=loMin,second=highFirst?lo:hi,back=close-second;
      legsText=` Leg 1: ${highFirst?'down':'up'} ${pts(hi-lo)} points from the ${at(highFirst?hiMin:loMin)} ${highFirst?'high':'low'} (${pts(highFirst?hi:lo)}) to the ${at(highFirst?loMin:hiMin)} ${highFirst?'low':'high'} (${pts(second)}). Leg 2: ${back>=0?'up':'down'} ${pts(Math.abs(back))} points to the 1:59 AM close (${pts(close)}).`;
    }
    const moveReading=overnight===null&&!useRange?'Waiting for a verified overnight move.':(useRange?`Overnight high–low range: ${overnightRange} NQ points (6 PM–2 AM NY).${legsText} `:'')+(overnight===null?'':`${preliminary?'Overnight so far':'Final overnight net'}: ${signed(overnight)} NQ points from the prior 6 PM NY open to ${preliminary?'the observation time':'the 1:59 AM NY close (2:00 AM boundary)'}.`);
    const overnightPlan=preliminary?'Sit out for now. Recheck when the final 2:00 AM NY window is published.':pmWatch?'Sit out the New York AM session. Watch 1:30–4:00 PM NY only if the morning was choppy and a cleaner setup confirms. PM quality is not guaranteed.':'Sit out this trading day under your 500-point overnight rule and existing calendar restrictions.';
    const overnightConclusion=large?overnightPlan:overnight===null?'Wait for a verified reading.':preliminary?'The reading so far is below 500 points. Recheck after 2:00 AM NY.':'The final move is below 500 points. Use the other conditions and calendar rules to plan the session.';
    group('overnight','Overnight move',large?(pmWatch?'AM sit out':'Sit out'):overnight===null?'Unknown':'Observed',
      moveReading+(useRange?'':' Full high–low range unavailable; the net move is used as a lower bound.'),
      `An overnight high–low range of 500 points or more blocks the New York AM session, even if price came back to where it started. An otherwise eligible 1:30–4:00 PM NY window becomes a conditional watch after the final reading. Other red calendar restrictions still apply.${overnightType?' Recorded behavior: '+overnightType.toLowerCase()+'.':''}`,
      overnightConclusion,[final!==null?'mcOvernight':'mcOvernightSoFar','mcOvernightRange','mcOvernightType']);
    if(large){
      reasons.push(`${preliminary?'Overnight so far':useRange?'Overnight range':'Overnight net move'} ${useRange?overnightRange:signed(overnight)} points meets your 500-point AM sit-out rule.`);
      const stage=preliminary?'provisional':'final';
      alert('overnight-1800-0200-large-'+stage+'-'+Math.floor(ruleMove/50),(pmWatch?'AM sit out':'Sit out')+' · Overnight '+moveLabel+' NQ pts',moveReading+' '+overnightPlan,'danger',String(useRange?overnightRange:overnight));
    }
    if(ruleMove!==null&&!large){
      const stage=preliminary?'provisional':'final';
      const label=preliminary?'Overnight so far':'Overnight final';
      alert('overnight-1800-0200-'+stage,label+' · '+moveLabel+' NQ pts',moveReading,'info',String(useRange?overnightRange:overnight));
    }
    const range=number('mcRange'),prior=number('mcPriorRange',true),gap=number('marketGapPoints',true),behavior=text('marketType',['Trend up','Trend down','Range','Reversal','Choppy']);
    const ratio=range!==null&&prior>0?range/prior:null;
    const beforeOpen=day===today&&minute<570,gapText=gap===null?(beforeOpen?'N/A until the 9:30 AM open':'not yet verified'):gap===0?'N/A (opened at the prior close)':signed(gap)+' points'+(gap>0?' (gap up)':' (gap down)');
    group('range','Opening gap & session range',ratio!==null&&ratio>=1?'Caution':range===null?(beforeOpen?'Before open':'Unknown'):'Observed',`RTH gap: ${gapText}. RTH range so far: ${range===null?'not yet verified':range+' points'}. Prior RTH range: ${prior===null?'unavailable':prior+' points'}.${ratio!==null?' Current range is '+Math.round(ratio*100)+'% of the previous session.':''}`,'RTH means 09:30 to the cash close. The opening gap, overnight net move and session high–low range use different baselines. A prior-range comparison is context, not a target or a ceiling.',range===null?'Before the open, these measures may not exist. After the open, incomplete or old bars stay unknown.':ratio===null?'A comparable prior session range is unavailable.':ratio>=1?'The session has already covered at least as many points as the prior session. Reassess before chasing an extension.':`The range is smaller than the prior session${behavior?'. Observed behavior: '+behavior.toLowerCase():''}. Watch whether price fills the gap or extends it.`,['marketGapPoints','mcRange','mcPriorRange','marketType']);
    if(ratio!==null&&ratio>=1){watch.push('Current RTH range has reached the previous RTH range.');alert('range-expanded','Session range expanded',`Current RTH range ${range} points is ${Math.round(ratio*100)}% of the prior ${prior}-point range. Reassess extensions; this is not a range ceiling.`);}
    const moves=TECH.map(k=>number('mc'+k)),direction=text('mcDirection',['Up','Down','Flat']);
    const techKeys=['mcDirection',...TECH.map(k=>'mc'+k)],techSources=techKeys.map(k=>validSources.filter(s=>s.fields.includes(k)).map(s=>Date.parse(s.asOf)).sort((a,b)=>b-a)[0]);
    const synchronized=techSources.every(Number.isFinite)&&Math.max(...techSources)-Math.min(...techSources)===0;
    const techReady=moves.every(v=>v!==null)&&direction!==null&&synchronized;
    const aligned=techReady&&direction!=='Flat'?moves.filter(v=>direction==='Up'?v>0:v<0).length:null,opposed=techReady&&direction!=='Flat'?moves.filter(v=>direction==='Up'?v<0:v>0).length:null;
    const breadth={aligned,opposed,label:!techReady?'Not recorded':direction==='Flat'?'NQ flat':aligned>=5?'Broad participation':opposed>=4?'Divergent':'Narrow / mixed',detail:!techReady?'Awaiting all seven stock moves and NQ direction at the exact same minute.':direction==='Flat'?'NQ is flat versus its prior RTH close; no directional alignment tally.':`${aligned}/7 align with NQ ${direction.toLowerCase()}; ${opposed}/7 oppose. Equal-count comparison, not index-weighted contribution.`};
    group('tech','Big-tech participation',!techReady?'Unknown':['Divergent','Narrow / mixed'].includes(breadth.label)?'Caution':'Observed',breadth.detail+(techReady?' '+TECH.map((k,i)=>k+' '+signed(moves[i])+'%').join(' · '):''),'All seven names and NQ must share one observation minute and a prior RTH-close baseline. Five or more aligned names count as broad; four or more opposing count as divergent.',!techReady?'No breadth conclusion until data is complete and synchronized.':direction==='Flat'?'NQ is flat; watch for a direction to develop.':breadth.label==='Broad participation'?'More of the tracked tech stocks are moving with NQ. That gives the move broader support within this group.':'Fewer tracked stocks support the NQ move. Wait for clearer confirmation before chasing it.',techKeys);
    if(techReady&&['Divergent','Narrow / mixed'].includes(breadth.label)){reasons.push('Big-tech participation is narrow or divergent.');alert('tech-'+breadth.label,'Tech participation weakened',breadth.detail+' Extra selectivity is needed.');}
    const yieldLevel=number('mcYieldLevel'),dxy=number('mcDxy'),yields=text('mcYields',['Rising','Falling','Flat']),dollar=text('mcDollar',['Rising','Falling','Flat']);
    const yieldChange=number('mcYieldChangeBp'),dxyChange=number('mcDxyChange');
    let macro=text('mcMacro',['Supportive','Mixed','Headwinds']);
    const macroYieldChange=number('mcMacroYieldChangeBp'),macroDollarChange=number('mcMacroDxyChange');
    const macroSources=validSources.filter(s=>s.fields.includes('mcMacro'));
    if(macro!==null&&(new Set(macroSources.map(s=>s.url)).size<2||new Set(macroSources.map(s=>s.asOf)).size!==1)){macro=null;delete n.mcMacro;issues.set('mcMacro','Synchronized evidence required');}
    group('macro','Rates & dollar',macro==='Headwinds'?'Caution':macro===null?'Unknown':'Observed',`US 10Y yield ${yieldLevel===null?'unavailable':yieldLevel.toFixed(3)+'%'}${yields?' · '+yields.toLowerCase():''}${yieldChange!==null?' ('+signed(yieldChange)+' bp)':''}. DXY ${dxy===null?'unavailable':dxy.toFixed(3)}${dollar?' · '+dollar.toLowerCase():''}${dxyChange!==null?' ('+signed(dxyChange)+' points)':''}.${macroYieldChange!==null&&macroDollarChange!==null?' Combined observation: yield '+signed(macroYieldChange)+' bp; dollar '+signed(macroDollarChange)+' points.':''}`,'Headwinds means pressure that can make a tech rally harder. Higher yields can weigh on growth stock valuations. A stronger dollar can reduce the reported dollar value of overseas earnings. The planner compares both at the same minute.',macro===null?'No combined conclusion until a verified synchronized comparison is available.':macro==='Headwinds'?'Yields and the dollar rose together. That can add pressure on tech, so your plan calls for lower aggression and clearer confirmation from price.':macro==='Supportive'?'Yields and the dollar fell together. That can ease pressure on tech. Look for price and participation to confirm.':'Rates and the dollar are giving mixed signals. Let price and tech participation guide your read.',['mcMacroYieldChangeBp','mcMacroDxyChange','mcYieldLevel','mcYields','mcYieldChangeBp','mcDxy','mcDollar','mcDxyChange','mcMacro']);
    if(macro==='Headwinds'){reasons.push('Rising yields and a stronger dollar can add pressure on tech.');alert('macro-headwinds','Rates and dollar pressure','Both rose at the same observation time. That can make it harder for tech to rally.');}
    const rebalance=text('mcRebalance',['Confirmed','Possible','None confirmed'],true),upcoming=(options.upcomingExpiry||[]).map(x=>' '+x).join('');
    group('expiry','Expiry & scheduled flows',expiry||rebalance==='Confirmed'?'Caution':calendarKnown?'Observed':'Unknown',`${expiry?expiry+' today.':'No monthly or quarterly expiry today.'}${upcoming}${rebalance?' Index rebalance: '+rebalance+'.':''}`,'Monthly and quarterly expiries follow the exchange calendar with holiday adjustments. A quarterly window alone does not establish a confirmed index rebalance or dealer hedging flow.',expiry?'Your expiry plan applies: 1:1 targets, no partials, and lower aggression.':!calendarKnown?'Calendar coverage is missing; verify the session before planning.':'No expiry restriction today. Special index changes require a direct announcement.',['mcRebalance']);
    if(expiry){reasons.push(expiry+': your lower-aggression, 1:1/no-partials plan applies.');alert('expiry',expiry+' today','Your expiry plan: target 1:1, no partials, and reduce aggression.');}
    if(rebalance==='Confirmed'){reasons.push('A sourced index rebalance is confirmed.');alert('rebalance','Index rebalance confirmed','Monitor event timing and the closing auction; expiry alone did not establish this.');}
    for(const g of groups){if(g.state==='Observed'&&((g.id==='overnight'&&(overnightRange===null||overnightType===null))||(g.id==='volatility'&&vol===null)||(g.id==='range'&&(prior===null||gap===null))))g.state='Partial';}
    const stale=[...issues].filter(([,v])=>v==='Older than 90 minutes').map(([k])=>k),missingGroups=groups.filter(g=>['Unknown','Partial'].includes(g.state)).map(g=>g.title);
    group('sources','Data quality & sources',!record||stale.length||missingGroups.length?'Incomplete':'Observed',record?`${validSources.length} timestamped source records. ${stale.length} stale inputs excluded.`:'No verified snapshot recorded for this date.','Each input needs its own observation time. A later collection time does not make an earlier quote current. During 08:00–16:30 NY, dynamic inputs older than 90 minutes are excluded. Final overnight, opening gap and prior-session baselines are fixed measurements.',missingGroups.length?`Incomplete groups: ${missingGroups.join(', ')}. Missing data never means neutral or low risk.`:'The available measurements pass the source/time checks. These are periodic observations, not a real-time feed.',[]);
    if(stale.length)alert('stale','Market data needs an update',`${stale.length} dynamic inputs are older than 90 minutes and excluded from current conclusions.`);
    if(!record&&day===today)alert('missing','Conditions not recorded yet','No verified snapshot for this trading date. The next scheduled collection will update it.');
    const isElection=election(day);
    if(isElection){reasons.unshift('Your Election Day rule: do not trade after 09:30 New York; you expect unreliable price action.');alert('election','Election Day: no trading after 9:30','Your saved rule: do not trade after 9:30 AM New York. You expect poor, unpredictable price action. Existing pre-open restrictions also remain.', 'danger');}
    // Stale inputs stay out of the call, but the slot still shows the last reading with its age.
    let last=null;
    if(stale.length&&!options._fallback&&Number.isFinite(recordedAt)){
      last=evaluate(record,{...options,now:recordedAt,_fallback:true});
      const lastTime=Math.max(...validSources.map(s=>Date.parse(s.asOf))),age=Math.round((now-lastTime)/60000);
      const clock=t=>new Date(t).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
      for(const g of groups){
        const fb=last.groups.find(x=>x.id===g.id);
        if(g.id==='sources'||!fb||!['Unknown','Partial'].includes(g.state)||['Unknown'].includes(fb.state))continue;
        g.state='Last reading';g.lastAt=fb.asOf;
        g.reading=`As of ${clock(fb.asOf??lastTime)} NY (${Math.round((now-(fb.asOf??lastTime))/60000)} min ago): ${fb.reading}`;
        g.conclusion=`Older than 90 minutes, so it is shown for context but not used in the current call. ${fb.conclusion}`;
      }
      const src=groups.find(g=>g.id==='sources');
      src.state='Last reading';
      src.reading=`${validSources.length} timestamped source records. Last observation ${clock(lastTime)} NY, ${age} min ago, so ${stale.length} live inputs are past the 90-minute limit. The next scheduled recording refreshes them.`;
      src.conclusion=`Sections showing their last reading: ${groups.filter(g=>g.state==='Last reading'&&g.id!=='sources').map(g=>g.title).join(', ')}. They stay out of the current call until fresh data arrives.`;
    }
    const restricted=isElection||closed||large,level=restricted?(pmWatch?'AM sit out':'Sit out'):reasons.length?'Reduced':missingGroups.length||!calendarKnown?'Incomplete':watch.length?'Selective':'Reviewed';
    const plan=closed?'Market closed in the planner. Do not trade the regular session.':isElection?'Election Day: do not trade after 9:30 AM New York under your saved rule. The pre-open restrictions remain.':large?overnightPlan:expiry?'Your expiry plan: target 1:1, no partials; reduce aggression.':reasons.length?'Reduce aggression and wait for clean confirmation. '+reasons[0]:missingGroups.length||!calendarKnown?'Context is incomplete. Wait for verified observations before increasing aggression.':'Available context reviewed. Follow the scheduled restrictions and require confirmation from the setup; this is not an automatic green light.';
    if(typeof raw.mcComment==='string')evidence('mcComment',true);
    return {day,n,expiry,vix,overnight,breadth,reasons,watch,missing:missingGroups,groups,alerts,level,plan,restricted,large,preliminary,pmWatch,stale,last};
  }
  function unread(alerts,seen){return alerts.filter(a=>!seen[a.id]);}
  const api={evaluate,unread,RULES,election,nyDate,nyMinute};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NQConditions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
