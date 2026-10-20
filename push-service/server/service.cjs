'use strict';
const fs=require('node:fs'),path=require('node:path');
const mqtt=require('mqtt'),webpush=require('web-push');
const {Engine}=require('./engine.cjs'),P=require('../push-protocol.js');
const configPath=process.env.TASNI_PUSH_CONFIG||path.join(process.env.LOCALAPPDATA||process.cwd(),'TASNI','PushService','config.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const engine=new Engine(path.join(path.dirname(configPath),'state.sqlite'),config.devices);
webpush.setVapidDetails('mailto:tasnitrading@gmail.com',config.vapid.publicKey,config.vapid.privateKey);
const statusTopic='tasni-water/push/service/'+config.serviceId;
const log=(event,extra={})=>console.log(JSON.stringify({at:new Date().toISOString(),event,...extra}));
const client=mqtt.connect('mqtts://'+config.mqtt.host+':8883',{username:config.mqtt.username,password:config.mqtt.password,
 clientId:'tasni-push-'+config.serviceId,clean:true,reconnectPeriod:5000,connectTimeout:12000,keepalive:30,
 rejectUnauthorized:true,will:{topic:statusTopic,payload:JSON.stringify({online:false,version:'2.3.0'}),qos:1,retain:true}});
let chain=Promise.resolve(),queued=0,dispatching=false;
const rates=new Map();
function publishStatus(){if(client.connected)client.publish(statusTopic,JSON.stringify({online:true,version:'2.3.0',time:Date.now()}),{qos:1,retain:true});}
client.on('connect',()=>{
 client.subscribe(['tasni-water/+/state','tasni-water/+/push/request'],{qos:1},(error,grants)=>{
  if(error||grants?.some(g=>g.qos===128)){log('SUBSCRIPTION_DENIED');return;}
  publishStatus();log('MQTT_ONLINE');
 });
});
client.on('error',()=>log('MQTT_CONNECTION_ERROR'));
client.on('offline',()=>log('MQTT_OFFLINE'));
client.on('message',(topic,bytes,packet)=>{
 if(bytes.length>16000)return;
 let data;try{data=JSON.parse(bytes.toString());}catch{return;}
 if(topic.endsWith('/state')){try{engine.sample(topic,data,!!packet.retain);}catch{log('SAMPLE_REJECTED');}return;}
 const match=/^tasni-water\/([0-9A-F]{12})\/push\/request$/.exec(topic);
 if(!match||packet.retain||data.device!==match[1]||!config.devices[data.device]||queued>=20)return;
 const now=Date.now(),rate=rates.get(data.device)||{at:now,count:0};
 if(now-rate.at>60000){rate.at=now;rate.count=0;}if(++rate.count>120)return;rates.set(data.device,rate);
 queued++;
 chain=chain.then(async()=>{
  let opened;try{opened=await P.receive(config.encryption.privateJwk,data);}catch{return;}
  let response;try{response=await engine.command(data,opened);}catch(error){response={ok:false,error:error.message};}
  try{const reply=await opened.reply(response);client.publish('tasni-water/'+data.device+'/push/response/'+data.id,JSON.stringify(reply),{qos:1,retain:false});}catch{log('RESPONSE_FAILED');}
 }).catch(()=>log('COMMAND_FAILED')).finally(()=>queued--);
});
const dispatchTimer=setInterval(async()=>{
 if(dispatching)return;dispatching=true;
 try{await engine.dispatch(async(subscription,payload)=>{
  await webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:120,urgency:payload.critical?'high':'normal',timeout:10000,
   topic:payload.device+'-'+payload.kind,contentEncoding:'aes128gcm'});
  log('PUSH_ACCEPTED',{device:payload.device,kind:payload.kind});
 });}catch{log('DISPATCH_FAILED');}finally{dispatching=false;}
},1000);
const statusTimer=setInterval(publishStatus,30000);
process.on('SIGTERM',()=>{clearInterval(dispatchTimer);clearInterval(statusTimer);client.end(false,()=>{engine.close();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();});
log('SERVICE_STARTED',{version:'2.3.0',devices:Object.keys(config.devices)});
