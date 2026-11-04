const assert=require('node:assert/strict');
const engine=require('../conditions-engine.js');
const now=Date.parse('2026-11-04T10:00:00-05:00'),day='2026-11-04';
const base={mcVix:17,mcVol:'Stable',mcVixChange:0,mcOvernight:100,mcOvernightRange:300,mcOvernightType:'Balanced',mcRange:100,mcPriorRange:300,marketGapPoints:0,marketType:'Range',mcDirection:'Up',mcAAPL:1,mcMSFT:1,mcNVDA:1,mcAMZN:1,mcGOOGL:1,mcMETA:1,mcTSLA:1,mcYieldLevel:4.5,mcDxy:100,mcYields:'Flat',mcDollar:'Flat',mcYieldChangeBp:0,mcDxyChange:0,mcMacro:'Mixed',mcMacroYieldChangeBp:0,mcMacroDxyChange:0};
function fixture(values={},date=day){const v={...base,...values};return {recordedAt:date+'T09:40:00-05:00',values:v,sources:[{title:'Synthetic fixture',url:'https://example.com/quotes',asOf:date+'T09:35:00-05:00',fields:Object.keys(v).filter(k=>!['mcMacro','mcOvernight'].includes(k))},{title:'Final overnight',url:'https://example.com/overnight',asOf:date+'T09:29:00-05:00',fields:['mcOvernight']},{title:'Rates',url:'https://example.com/rates',asOf:date+'T09:35:00-05:00',fields:['mcMacro','mcMacroYieldChangeBp']},{title:'Dollar',url:'https://example.com/dollar',asOf:date+'T09:35:00-05:00',fields:['mcMacro','mcMacroDxyChange']}]};}
function assess(values={},options={}){return engine.evaluate(fixture(values),{day,now,calendarKnown:true,...options});}
assert.equal(assess().level,'Reviewed');
for(const value of [500,-500,550,-550]){const a=assess({mcOvernight:value});assert.equal(a.level,'Sit out');assert.equal(a.restricted,true);assert(a.alerts.some(i=>i.severity==='danger'&&i.measurement===String(value)));assert(a.groups.find(g=>g.id==='overnight').reading.includes(String(Math.abs(value))));}
for(const value of [500,-500]){const a=assess({mcOvernight:value},{pmEligible:true});assert.equal(a.level,'AM sit out');assert.equal(a.pmWatch,true);assert(a.plan.includes('1:30–4:00 PM NY'));assert(a.alerts.some(i=>i.severity==='danger'&&i.title.startsWith('AM sit out')));}
for(const value of [0,499.75,-499.75,450,-450,201,-201]){const a=assess({mcOvernight:value});assert.equal(a.large,false);assert.equal(a.level,'Reviewed');assert(a.alerts.some(alert=>alert.id.endsWith(':overnight-final')&&alert.severity==='info'&&alert.measurement===String(value)));}
assert.equal(assess({mcOvernight:200}).reasons.length,0);
assert.equal(assess({mcOvernight:0,mcOvernightRange:600}).large,false,'Range must not substitute for signed net');
const provisional=fixture({mcOvernight:undefined,mcOvernightSoFar:-500});const p=engine.evaluate(provisional,{day,now,calendarKnown:true});assert(p.preliminary&&p.large&&p.restricted);assert(p.alerts.find(a=>a.severity==='danger').message.includes('Sit out for now'));
assert.equal(engine.evaluate(provisional,{day,now,calendarKnown:true,pmEligible:true}).pmWatch,false,'No PM watch until final overnight reading');
assert.equal(engine.evaluate(provisional,{day,now:Date.parse('2026-11-04T12:00:00-05:00')}).level,'Sit out','Premarket restriction persists until the final reading arrives');
assert.equal(assess({mcOvernight:100,mcOvernightSoFar:-500}).level,'Reviewed','Final measurement supersedes provisional restriction');
assert.equal(assess({mcVix:25,mcVol:'Expanding'}).level,'Reduced');
assert(assess({mcVix:25,mcVol:'Contracting'}).groups.find(g=>g.id==='volatility').conclusion.includes('remains elevated'));
const divergent=assess({mcAAPL:-1,mcMSFT:-1,mcNVDA:-1,mcAMZN:-1});assert.equal(divergent.breadth.label,'Divergent');
const unsync=fixture();unsync.sources[0].fields=unsync.sources[0].fields.filter(k=>k!=='mcAAPL');unsync.sources.push({title:'Different minute',url:'https://example.com/aapl',asOf:'2026-11-04T09:34:00-05:00',fields:['mcAAPL']});assert.equal(engine.evaluate(unsync,{day,now}).breadth.label,'Not recorded');
const stale=assess({}, {now:Date.parse('2026-11-04T12:00:00-05:00')});assert.equal(stale.vix,null);assert.equal(stale.overnight,100,'Final overnight survives dynamic freshness cutoff');assert.equal(stale.level,'Incomplete');
const zeroRange=assess({mcPriorRange:0});assert(zeroRange.groups.find(g=>g.id==='range').conclusion.includes('comparable prior session range is unavailable'));
const future=fixture();future.sources.forEach(s=>s.asOf='2026-11-04T11:00:00-05:00');assert.equal(engine.evaluate(future,{day,now}).vix,null);
const bad=fixture();bad.sources.forEach(s=>s.url='javascript:alert(1)');assert.equal(engine.evaluate(bad,{day,now}).vix,null);
const oldGamma=assess({mcGamma:'Short gamma',mcPositioning:'Crowded shorts'});assert.deepEqual(oldGamma.groups.map(({sources,...g})=>g),assess().groups.map(({sources,...g})=>g),'Retired positioning inputs cannot change conclusions');assert.equal(oldGamma.level,assess().level);assert.equal(oldGamma.n.mcGamma,undefined);
const election=engine.evaluate(fixture({mcOvernight:500},'2026-11-03'),{day:'2026-11-03',now:Date.parse('2026-11-03T10:00:00-05:00'),calendarKnown:true});assert.equal(election.level,'Sit out');assert(election.plan.includes('do not trade after 9:30'));assert(election.alerts.some(a=>a.id.endsWith(':election')));
assert.equal(engine.evaluate(fixture({mcOvernight:500},'2026-11-03'),{day:'2026-11-03',now:Date.parse('2026-11-03T10:00:00-05:00'),calendarKnown:true,pmEligible:true}).pmWatch,false,'Election Day keeps its stronger restriction');
assert.equal(assess({}, {expiry:'OPEX'}).level,'Reduced');assert.equal(assess({}, {closed:true}).level,'Sit out');
assert.equal(assess({mcOvernight:500},{closed:true,pmEligible:true}).pmWatch,false,'Closed market has no PM watch');
const current=assess({mcOvernight:500}).alerts,seen=Object.fromEntries(current.map(a=>[a.id,true]));assert.equal(engine.unread(current,seen).length,0);assert(engine.unread(assess({mcOvernight:550}).alerts,seen).length>0);
assert.equal(assess({mcRange:600,mcPriorRange:300}).groups.find(g=>g.id==='range').state,'Caution');
const noData=engine.evaluate(undefined,{day,now,calendarKnown:false});assert.equal(noData.level,'Incomplete');
console.log('PASS: thresholds/signs, provisional/final, gap vs range, VIX regimes, synchronized breadth, stale/future/missing/unsafe data, retired inputs, Election Day, expiry, closures, and unread escalation.');
