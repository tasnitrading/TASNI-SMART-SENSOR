const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,validSubscription}=require('../server/engine.cjs'),P=require('../push-protocol.js');
const device='D4E9F4B23600',other='AABBCCDDEEFF';
const fakeSubscription={endpoint:'https://fcm.googleapis.com/fcm/send/fake-test-endpoint',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
async function setup(){
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey),publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 let now=Date.now();const pin=await P.pinKey('test-device-password',device);
 const engine=new Engine(':memory:',{[device]:{pinKey:pin},[other]:{pinKey:await P.pinKey('other-device-password',other)}},()=>now);
 const rpc=async(payload,key=undefined,id=device)=>{const req=await P.request(publicJwk,id,payload,key),opened=await P.receive(privateJwk,req.packet);return {req,opened,response:await engine.command(req.packet,opened)};};
 const registered=await rpc({op:'register',subscription:fakeSubscription,preferences:{},appUrl:'https://tasnitrading.github.io/tasni/'},pin);
 const auth={id:registered.response.id,manageToken:registered.response.manageToken};
 const sample=(level,options={})=>engine.sample('tasni-water/'+device+'/state',{device,level,volume:level*10,total:1000,c:1,sampleAgeMs:500,epoch:Math.floor(now/1000),boot:1,uptime:Math.floor(now/1000),isFull:0,...options},false);
 return {engine,rpc,auth,pin,publicJwk,privateJwk,registered,sample,now:()=>now,advance:ms=>{now+=ms;}};
}
test('encrypted registration and authenticated reply round trip; secrets stay out of MQTT plaintext',async()=>{
 const s=await setup();try{
  const encoded=JSON.stringify(s.registered.req.packet);assert(!encoded.includes('test-device-password'));assert(!encoded.includes('fake-test-endpoint'));
  const reply=await s.registered.opened.reply(s.registered.response);assert.deepEqual(await s.registered.req.openResponse(reply),s.registered.response);
  const modified={...s.registered.req.packet,device:other};await assert.rejects(P.receive(s.privateJwk,modified));
  const wrong={...reply,box:reply.box.slice(0,-2)+'AA'};await assert.rejects(s.registered.req.openResponse(wrong));
 }finally{s.engine.close();}
});
test('wrong device password, cross-device tokens, replay and expired requests are rejected',async()=>{
 const s=await setup();try{
  const wrong=await P.pinKey('wrong-password',device);
  await assert.rejects(s.rpc({op:'register',subscription:fakeSubscription},wrong),/Wrong device password/);
  await assert.rejects(s.rpc({op:'status',...s.auth},undefined,other),/authorization/);
  await assert.rejects(s.engine.command(s.registered.req.packet,s.registered.opened),/Duplicate/);
  const req=await P.request(s.publicJwk,device,{op:'ping'});await assert.rejects(P.receive(s.privateJwk,req.packet,Date.now()+121000),/Expired/);
 }finally{s.engine.close();}
});
test('subscription endpoints cannot target local networks or unrelated HTTPS hosts',()=>{
 for(const endpoint of ['http://fcm.googleapis.com/test','https://127.0.0.1/test','https://example.com/test','https://fcm.googleapis.com.evil.invalid/test','https://user:password@fcm.googleapis.com/test','https://fcm.googleapis.com:8443/test'])assert.throws(()=>validSubscription({...fakeSubscription,endpoint}));
 assert.equal(validSubscription(fakeSubscription).endpoint,fakeSubscription.endpoint);
});
test('retained, stale, invalid and duplicate sensor packets cannot create false critical alerts',async()=>{
 const s=await setup();try{
  s.engine.sample('tasni-water/'+device+'/state',{device,level:5,c:1,epoch:Math.floor(s.now()/1000),sampleAgeMs:0,uptime:1,boot:1},true);
  assert.equal(s.engine.db.prepare('SELECT count(*) n FROM alerts').get().n,0);
  assert.equal(s.sample(5,{c:0}),false);assert.equal(s.sample(5,{epoch:Math.floor(s.now()/1000)-100}),false);
  assert.equal(s.sample(5),true);assert.equal(s.sample(5),false);
  assert.equal(s.engine.db.prepare("SELECT count(*) n FROM alerts WHERE kind='critical'").get().n,0);
  s.advance(10000);s.sample(5);
  assert.equal(s.engine.db.prepare("SELECT count(*) n FROM alerts WHERE kind='critical'").get().n,1);
 }finally{s.engine.close();}
});
test('critical delivery persists and user acknowledgement stops its reminders',async()=>{
 const s=await setup(),sent=[];try{
  s.sample(6);s.advance(10000);s.sample(6);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  const critical=sent.find(x=>x.kind==='critical');assert(critical?.critical);assert.equal(critical.level,6);
  await s.rpc({op:'ack',...s.auth,alertId:critical.alertId});
  s.advance(300000);s.sample(6);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  assert.equal(sent.filter(x=>x.kind==='critical').length,1);
 }finally{s.engine.close();}
});
test('a real refill resolves the critical condition before another reminder can send',async()=>{
 const s=await setup(),sent=[];try{
  s.sample(7);s.advance(10000);s.sample(7);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  s.advance(300000);s.sample(50);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  assert.equal(sent.filter(x=>x.kind==='critical').length,1);
 }finally{s.engine.close();}
});
test('test notifications are explicitly labeled and delayed ten seconds',async()=>{
 const s=await setup(),sent=[];try{
  const r=await s.rpc({op:'test',...s.auth});assert.equal(r.response.scheduledInSeconds,10);
  await s.engine.dispatch(async(sub,payload)=>sent.push(payload));assert.equal(sent.length,0);
  s.advance(10000);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  assert.equal(sent.length,1);assert.match(sent[0].body,/TEST:.*not a real/);assert.equal(sent[0].kind,'test');
 }finally{s.engine.close();}
});
test('expired push subscriptions are removed and transient failures retain the delivery',async()=>{
 const s=await setup();try{
  await s.rpc({op:'test',...s.auth});s.advance(10000);
  await s.engine.dispatch(async()=>{throw {statusCode:503};});
  assert.equal(s.engine.db.prepare('SELECT count(*) n FROM phones').get().n,1);
  s.advance(20000);await s.engine.dispatch(async()=>{throw {statusCode:410};});
  assert.equal(s.engine.db.prepare('SELECT count(*) n FROM phones').get().n,0);
 }finally{s.engine.close();}
});
test('disabled alert preferences do not queue alerts for that phone',async()=>{
 const s=await setup();try{
  await s.rpc({op:'preferences',...s.auth,preferences:{critical:false,low:false}});
  s.sample(5);s.advance(10000);s.sample(5);
  assert.equal(s.engine.db.prepare('SELECT count(*) n FROM deliveries').get().n,0);
 }finally{s.engine.close();}
});
test('missing, negative and non-finite sensor ages cannot create alarms',async()=>{
 const s=await setup();try{
  for(const age of [undefined,-1,'unknown',Infinity])assert.equal(s.sample(4,{sampleAgeMs:age}),false);
  assert.equal(s.engine.db.prepare('SELECT count(*) n FROM alerts').get().n,0);
 }finally{s.engine.close();}
});
test('critical notifications stop after the initial alert plus three reminders',async()=>{
 const s=await setup(),sent=[];try{
  s.sample(5);s.advance(10000);s.sample(5);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  for(let i=0;i<5;i++){s.advance(300000);s.sample(5);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));}
  assert.deepEqual(sent.filter(x=>x.kind==='critical').map(x=>x.sequence),[0,1,2,3]);
 }finally{s.engine.close();}
});
test('disabling an alert also cancels its already queued reminder',async()=>{
 const s=await setup(),sent=[];try{
  s.sample(5);s.advance(10000);s.sample(5);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  await s.rpc({op:'preferences',...s.auth,preferences:{critical:false}});
  s.advance(300000);s.sample(5);await s.engine.dispatch(async(sub,payload)=>sent.push(payload));
  assert.equal(sent.filter(x=>x.kind==='critical').length,1);
 }finally{s.engine.close();}
});
test('enrollment and a pending test survive closing and reopening the SQLite database',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const s=await setup(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tasni-push-test-')),filename=path.join(dir,'state.sqlite');let persisted;
 try{
  persisted=new Engine(filename,s.engine.devices,s.now);
  const registered=await persisted.command(s.registered.req.packet,s.registered.opened);
  const request=await P.request(s.publicJwk,device,{op:'test',id:registered.id,manageToken:registered.manageToken});
  await persisted.command(request.packet,await P.receive(s.privateJwk,request.packet));
  persisted.close();persisted=new Engine(filename,s.engine.devices,s.now);
  assert.equal(persisted.phone(registered.id,device,registered.manageToken).device,device);
  s.advance(10000);const sent=[];await persisted.dispatch(async(sub,payload)=>sent.push(payload));
  assert.equal(sent.length,1);assert.equal(sent[0].kind,'test');
 }finally{persisted?.close();s.engine.close();fs.rmSync(dir,{recursive:true,force:true});}
});
