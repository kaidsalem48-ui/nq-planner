'use strict';
const assert=require('node:assert/strict');
const store=require('../api/_push-store.js');
const savePlan=require('../api/push-plan.js');

const endpoint='https://push.example.test/selected-device';
const originalUpdate=store.update,originalNow=Date.now;
Date.now=()=>Date.UTC(2026,10,17,18);
let device={subscription:{endpoint},plans:{}};
store.update=async (name,change)=>{
  assert.equal(name,endpoint);
  device=change(device);
  return {value:device};
};
async function request(plans){
  const response={statusCode:null,body:null,setHeader(){return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await savePlan({method:'POST',headers:{origin:'https://nq-planner.vercel.app'},body:{endpoint,plans}},response);
  return response;
}
(async()=>{
  const accepted=await request({'2026-11-18':['20:00-24:00','26:00-29:00']});
  assert.equal(accepted.statusCode,200);
  assert.deepEqual(device.plans['2026-11-18'],['20:00-24:00','26:00-29:00']);
  const rejected=await request({'2026-11-18':['19:00-24:00']});
  assert.equal(rejected.statusCode,400);
  assert.deepEqual(device.plans['2026-11-18'],['20:00-24:00','26:00-29:00']);
  const disabled=await request({'2026-11-18':[]});
  assert.equal(disabled.statusCode,200);
  assert.deepEqual(device.plans['2026-11-18'],[]);
  console.log('selected overnight window plan tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{store.update=originalUpdate;Date.now=originalNow;});
