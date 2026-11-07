const assert=require('node:assert/strict');
const engine=require('../conditions-engine.js');
const now=Date.parse('2026-11-04T10:00:00-05:00'),day='2026-11-04';
const base={mcVix:17,mcVol:'Stable',mcVixChange:0,mcOvernight:100,mcOvernightRange:300,mcOvernightType:'Balanced',mcRange:100,mcPriorRange:300,marketGapPoints:0,marketType:'Range',mcDirection:'Up',mcAAPL:1,mcMSFT:1,mcNVDA:1,mcAMZN:1,mcGOOGL:1,mcMETA:1,mcTSLA:1,mcYieldLevel:4.5,mcDxy:100,mcYields:'Flat',mcDollar:'Flat',mcYieldChangeBp:0,mcDxyChange:0,mcMacro:'Mixed',mcMacroYieldChangeBp:0,mcMacroDxyChange:0};
function fixture(values={},date=day){const v={...base,...values};return {recordedAt:date+'T09:40:00-05:00',values:v,sources:[{title:'Synthetic fixture',url:'https://example.com/quotes',asOf:date+'T09:35:00-05:00',fields:Object.keys(v).filter(k=>!['mcMacro','mcOvernight','mcOvernightRange','mcOvernightType','mcOvernightSoFar','mcOvernightOpen','mcOvernightHigh','mcOvernightLow','mcOvernightClose','mcOvernightHighMin','mcOvernightLowMin'].includes(k))},{title:'Final overnight',url:'https://example.com/overnight',asOf:date+'T01:59:00-05:00',fields:['mcOvernight','mcOvernightRange','mcOvernightType','mcOvernightOpen','mcOvernightHigh','mcOvernightLow','mcOvernightClose','mcOvernightHighMin','mcOvernightLowMin'].filter(k=>k in v)},{title:'Early overnight',url:'https://example.com/overnight-early',asOf:date+'T01:30:00-05:00',fields:['mcOvernightSoFar']},{title:'Rates',url:'https://example.com/rates',asOf:date+'T09:35:00-05:00',fields:['mcMacro','mcMacroYieldChangeBp']},{title:'Dollar',url:'https://example.com/dollar',asOf:date+'T09:35:00-05:00',fields:['mcMacro','mcMacroDxyChange']}]};}
function assess(values={},options={}){return engine.evaluate(fixture(values),{day,now,calendarKnown:true,...options});}
assert.equal(assess().level,'Reviewed');
for(const value of [500,550]){const a=assess({mcOvernightRange:value});assert.equal(a.level,'Sit out');assert.equal(a.restricted,true);assert(a.alerts.some(i=>i.severity==='danger'&&i.measurement===String(value)));assert(a.groups.find(g=>g.id==='overnight').reading.includes(String(Math.abs(value))));}
for(const value of [500,550]){const a=assess({mcOvernightRange:value},{pmEligible:true});assert.equal(a.level,'AM sit out');assert.equal(a.pmWatch,true);assert(a.plan.includes('1:30–4:00 PM NY'));assert(a.alerts.some(i=>i.severity==='danger'&&i.title.startsWith('AM sit out')));}
{const R=(...v)=>v.map((range,i)=>({day:'2026-10-'+String(20+i),range}));
// No 500+ night in the previous 5: the usual sit-out.
let a=assess({mcOvernightRange:600},{recentRanges:R(300,250,220,310,280)});assert.equal(a.level,'Sit out');assert.equal(a.large,true);
// 1-2 of the last 5 at 500+: light size, never sit out.
for(const r of [R(520,250,220,310,280),R(896,500,220,310,280)]){a=assess({mcOvernightRange:600},{recentRanges:r,pmEligible:true});assert.equal(a.large,false);assert.equal(a.restricted,false);assert.equal(a.level,'Selective');assert.equal(a.groups.find(g=>g.id==='overnight').state,'Light size');const al=a.alerts.find(x=>x.id.endsWith(':overnight-1800-0200-light-final'));assert(al&&al.severity==='info'&&al.title.startsWith('Light size'));}
// 3+ of the last 5: 500 is normal.
a=assess({mcOvernightRange:600},{recentRanges:R(896,500,620,310,280)});assert.equal(a.large,false);assert.equal(a.level,'Selective');assert.equal(a.groups.find(g=>g.id==='overnight').state,'Normal lately');assert(a.alerts.some(x=>x.id.endsWith(':overnight-1800-0200-normal-final')&&x.severity==='info'));
// Back to 200-300 nights: the sit-out returns.
a=assess({mcOvernightRange:600},{recentRanges:R(250,300,220,310,280,900)});assert.equal(a.level,'Sit out');
// Only the previous 5 trading nights count, and the archive beats the backfill.
const rr=engine.recentOvernightRanges({days:{'2026-11-05':{values:{mcOvernightRange:500.75}},'2026-11-06':{values:{mcOvernightRange:792.75}}}},{'2026-11-05':453,'2026-11-04':896.25,'2026-11-03':222.75,'2026-11-02':219.25,'2026-10-30':358.5,'2026-10-29':311.75},'2026-11-06');
assert.deepEqual(rr.map(x=>x.range),[500.75,896.25,222.75,219.25,358.5]);}
for(const value of [0,499.75,450,201]){const a=assess({mcOvernight:0,mcOvernightRange:value});assert.equal(a.large,false);assert.equal(a.level,'Reviewed');assert(a.alerts.some(alert=>alert.id.endsWith(':overnight-1800-0200-final')&&alert.severity==='info'&&alert.measurement===String(value)));}
const oldWindow=fixture();oldWindow.sources[1].asOf=day+'T09:29:00-05:00';assert.equal(engine.evaluate(oldWindow,{day,now,calendarKnown:true}).overnight,null,'Old 9:29 measurements cannot be presented as 2 AM readings');
assert.equal(assess({mcOvernight:200}).reasons.length,0);
assert.equal(assess({mcOvernight:-193,mcOvernightRange:896}).large,true,'A 500+ range counts even when price came back');for(const value of [500,-500]){assert.equal(assess({mcOvernight:value,mcOvernightRange:undefined}).large,true,'Without a range, the net move is a lower bound');}
const provisional=fixture({mcOvernight:undefined,mcOvernightSoFar:-500});const p=engine.evaluate(provisional,{day,now,calendarKnown:true});assert(p.preliminary&&p.large&&p.restricted);assert(p.alerts.find(a=>a.severity==='danger').message.includes('Sit out for now'));
assert.equal(engine.evaluate(provisional,{day,now,calendarKnown:true,pmEligible:true}).pmWatch,false,'No PM watch until final overnight reading');
assert.equal(engine.evaluate(provisional,{day,now:Date.parse('2026-11-04T12:00:00-05:00')}).level,'Sit out','Premarket restriction persists until the final reading arrives');
assert.equal(assess({mcOvernight:100,mcOvernightSoFar:-500}).level,'Reviewed','Final measurement supersedes provisional restriction');
assert.equal(assess({mcVix:25,mcVol:'Expanding'}).level,'Selective');assert.equal(assess({mcVix:19,mcVol:'Expanding'}).level,'Selective');
assert(assess({mcVix:19,mcVol:'Contracting'}).groups.find(g=>g.id==='volatility').conclusion.includes('Normal size is fine'));
{const v=assess({mcVix:21.4,mcVol:'Stable'}),g=v.groups.find(g=>g.id==='volatility'),a=v.alerts.find(a=>a.id.endsWith(':vix-very-volatile'));
assert.equal(g.state,'Very volatile');assert(g.reading.includes('very volatile'));assert(a&&a.severity==='info');assert.equal(assess({mcVix:25.82,mcVol:'Expanding',mcVixChange:55.45}).alerts.find(a=>a.id.endsWith(':vix-very-volatile')).title,'Size down · VIX 25.82 · very volatile · +55% vs. yesterday');
{const e=assess({mcVix:19.4,mcVol:'Expanding',mcVixChange:8}).alerts.find(a=>a.id.endsWith(':vix-expanding'));assert.equal(e.title,'VIX 19.40 · rising');assert(!e.message.includes('Size down'));}
assert(assess({mcVix:25.82,mcVol:'Expanding',mcVixChange:55.45,mcOvernightClose:28280.5}).alerts.find(a=>a.id.endsWith(':vix-very-volatile')).message.includes('about ±570 points'));
{const t=o=>assess(o).alerts.find(a=>a.id.includes(':tech-daily:'));
assert.equal(t({}).title,'Big tech: all in · 7/7 up with NQ');assert.equal(t({}).severity,'info');
assert.equal(t({mcNVDA:5.1,mcMSFT:0.4,mcAAPL:-0.5,mcAMZN:-0.3,mcGOOGL:-0.2,mcMETA:0.3,mcTSLA:-1}).title,'Big tech: one leading · NVDA +5.1%');
assert.equal(t({mcAAPL:-0.5,mcAMZN:-0.3,mcGOOGL:-0.2}).title,'Big tech: split · 4/7 up with NQ');}
{const m=o=>assess(o).management;
const down={mcDirection:'Down',mcAAPL:-1,mcMSFT:-1,mcNVDA:-1,mcAMZN:-1,mcGOOGL:-1,mcMETA:-1,mcTSLA:-1};
assert.deepEqual([m({}).long,m({}).short],['Normal partials, small runner','Partials early, no runner']);
const hw=m({...down,mcMacro:'Headwinds'});assert.deepEqual([hw.long,hw.short],['Partials early, no runner','Leave a runner, light partials']);
const st=m({...down,mcMacro:'Headwinds',mcRange:600});assert.equal(st.short,'Normal partials, small runner');assert(st.why.some(w=>w.includes('2.0×')));
assert.equal(m({mcRange:undefined}).preOpen,true);
assert(assess({...down,mcMacro:'Headwinds'}).alerts.some(a=>a.id.endsWith(':mgmt:Partials early, no runner|Leave a runner, light partials')&&a.title==='Longs: partials early, no runner · Shorts: leave a runner, light partials'));}
assert(!assess({mcVix:20,mcVol:'Stable'}).alerts.some(a=>a.id.endsWith(':vix-very-volatile')));}
const divergent=assess({mcAAPL:-1,mcMSFT:-1,mcNVDA:-1,mcAMZN:-1});assert.equal(divergent.breadth.label,'Divergent');
const unsync=fixture();unsync.sources[0].fields=unsync.sources[0].fields.filter(k=>k!=='mcAAPL');unsync.sources.push({title:'Different minute',url:'https://example.com/aapl',asOf:'2026-11-04T09:34:00-05:00',fields:['mcAAPL']});assert.equal(engine.evaluate(unsync,{day,now}).breadth.label,'Not recorded');
const stale=assess({}, {now:Date.parse('2026-11-04T12:00:00-05:00')});assert.equal(stale.vix,null);assert.equal(stale.overnight,100,'Final overnight survives dynamic freshness cutoff');assert.equal(stale.level,'Incomplete');
const zeroRange=assess({mcPriorRange:0});assert(zeroRange.groups.find(g=>g.id==='range').conclusion.includes('comparable prior session range is unavailable'));
const future=fixture();future.sources.forEach(s=>s.asOf='2026-11-04T11:00:00-05:00');assert.equal(engine.evaluate(future,{day,now}).vix,null);
const bad=fixture();bad.sources.forEach(s=>s.url='javascript:alert(1)');assert.equal(engine.evaluate(bad,{day,now}).vix,null);
const oldGamma=assess({mcGamma:'Short gamma',mcPositioning:'Crowded shorts'});assert.deepEqual(oldGamma.groups.map(({sources,...g})=>g),assess().groups.map(({sources,...g})=>g),'Retired positioning inputs cannot change conclusions');assert.equal(oldGamma.level,assess().level);assert.equal(oldGamma.n.mcGamma,undefined);
const election=engine.evaluate(fixture({mcOvernightRange:500},'2026-11-03'),{day:'2026-11-03',now:Date.parse('2026-11-03T10:00:00-05:00'),calendarKnown:true});assert.equal(election.level,'Sit out');assert(election.plan.includes('do not trade after 9:30'));assert(election.alerts.some(a=>a.id.endsWith(':election')));
assert.equal(engine.evaluate(fixture({mcOvernightRange:500},'2026-11-03'),{day:'2026-11-03',now:Date.parse('2026-11-03T10:00:00-05:00'),calendarKnown:true,pmEligible:true}).pmWatch,false,'Election Day keeps its stronger restriction');
assert.equal(assess({}, {expiry:'OPEX'}).level,'Reduced');assert.equal(assess({}, {closed:true}).level,'Sit out');
assert.equal(assess({mcOvernightRange:500},{closed:true,pmEligible:true}).pmWatch,false,'Closed market has no PM watch');
const current=assess({mcOvernightRange:500}).alerts,seen=Object.fromEntries(current.map(a=>[a.id,true]));assert.equal(engine.unread(current,seen).length,0);assert(engine.unread(assess({mcOvernightRange:550}).alerts,seen).length>0);
assert.equal(assess({mcRange:600,mcPriorRange:300}).groups.find(g=>g.id==='range').state,'Expanded');
const noData=engine.evaluate(undefined,{day,now,calendarKnown:false});assert.equal(noData.level,'Incomplete');
console.log('PASS: thresholds/signs, provisional/final, gap vs range, VIX regimes, synchronized breadth, stale/future/missing/unsafe data, retired inputs, Election Day, expiry, closures, and unread escalation.');
{const a=assess({mcOvernight:-193,mcOvernightRange:896.25,mcOvernightHigh:28512,mcOvernightLow:27615.75,mcOvernightClose:28216.75,mcOvernightHighMin:35,mcOvernightLowMin:247});const r=a.groups.find(g=>g.id==='overnight').reading;assert(r.includes('Leg 1: down 896.25 points from the 6:35 PM high (28,512) to the 10:07 PM low (27,615.75)'),r);assert(r.includes('Leg 2: up 601 points to the 1:59 AM close (28,216.75)'),r);assert(a.alerts.some(x=>x.message.includes('Leg 2')));}
