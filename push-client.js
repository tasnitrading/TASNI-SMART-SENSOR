(function(){
 'use strict';
 const P=globalThis.TasniPushProtocol,C=globalThis.TASNI_PUSH_CONFIG;
 const scope=new URL('./',location.href).pathname,storageKey='tasni_push_v1:'+scope;
 let session;try{session=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{session=null;}
 let working=false,lastServiceSeen=0,serviceOnline=false,prefTimer,ackId=new URL(location.href).searchParams.get('alert');
 const pending=new Map(),attached=new WeakSet();
 const el=id=>document.getElementById(id);
 const text=(id,value)=>{if(el(id))el(id).textContent=value;};
 const device=()=>{const exact=/^tasni-water\/([0-9A-F]{12})\/state$/.exec(cfg.topic||'');return exact?.[1]||(/^[0-9A-F]{12}$/.test(cfg.selectedDevice||'')?cfg.selectedDevice:null);};
 const currentClient=()=>[mqttPrimary,mqttBackup].find(client=>client?.connected);
 const settings=()=>({critical:ck('t-crit'),low:ck('t-low'),drop:ck('t-drop'),fill:ck('t-fill'),full:ck('t-full'),nightLeak:ck('t-nightleak'),offline:true,sound:ck('t-sound'),nightLeakThreshold:cfg.nightLeakThreshold||20});
 function setSession(value){session=value;if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey);}
 function status(message){text('pushStatus',message);if(el('pushAckButton'))el('pushAckButton').hidden=!/^[a-f0-9]{32}$/.test(ackId||'');}
 function isEnrolled(){return !!(session&&session.device===device()&&globalThis.Notification?.permission==='granted');}
 function shouldDeferSystemNotification(message){return /CRITICAL:|LOW:|SUDDEN DROP:|REFILLED:|FULL TANK:|NIGHT LEAK|DEVICE OFFLINE/.test(message||'')&&isEnrolled()&&serviceOnline&&Date.now()-lastServiceSeen<90000;}
 function renderStatus(){
  if(!('Notification' in globalThis)||!('PushManager' in globalThis))return status('This browser does not support background push. Use current Chrome on Android.');
  if(Notification.permission==='denied')return status('Notifications are blocked. Allow notifications for this app in Android / browser settings.');
  if(session&&session.device!==device())return status('Background alerts belong to a different device. Enable again for the selected tank.');
  if(isEnrolled())status(Date.now()-lastServiceSeen<90000&&serviceOnline?'ENROLLED · alert service online. Critical alerts request sound and vibration.':'ENROLLED · checking the alert service. The service PC must remain powered on and online.');
  else status('Not enabled for closed-app alerts. Enter the device dashboard password and tap Enable.');
 }
 async function rpc(payload,registrationKey){
  const id=device(),client=currentClient();
  if(!id)throw Error('Select the exact device MQTT topic first.');
  if(!client)throw Error('Connect MQTT before enabling background alerts.');
  const request=await P.request(C.publicJwk,id,payload,registrationKey),replyTopic='tasni-water/'+id+'/push/response/'+request.packet.id;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(request.packet.id);client.unsubscribe(replyTopic);reject(Error('The alert service did not reply. Check that the service PC is online.'));},15000);
   pending.set(request.packet.id,{device:id,request,resolve:data=>{clearTimeout(timer);client.unsubscribe(replyTopic);data.ok?resolve(data):reject(Error(data.error||'Push setup rejected'));},reject});
   client.subscribe(replyTopic,{qos:1},(error,grants)=>{
    if(error||!grants?.length||grants.some(g=>g.qos===128)){clearTimeout(timer);pending.delete(request.packet.id);reject(Error('MQTT push-response subscription was denied.'));return;}
    client.publish('tasni-water/'+id+'/push/request',JSON.stringify(request.packet),{qos:1,retain:false},error=>{if(error){clearTimeout(timer);pending.delete(request.packet.id);client.unsubscribe(replyTopic);reject(Error('Could not send the push registration.'));}});
   });
  });
 }
 function attach(client){
  if(!client||attached.has(client))return;attached.add(client);
  function connected(){client.subscribe('tasni-water/push/service/'+C.serviceId,{qos:1});if(isEnrolled())setTimeout(sync,1000);}
  client.on('connect',connected);if(client.connected)connected();
  client.on('message',async(topic,bytes)=>{
   if(topic==='tasni-water/push/service/'+C.serviceId){try{const d=JSON.parse(bytes.toString());serviceOnline=d.online===true&&Number.isFinite(d.time)&&Math.abs(Date.now()-d.time)<90000;lastServiceSeen=serviceOnline?Date.now():0;renderStatus();}catch{}return;}
   const match=/\/push\/response\/([a-f0-9]{32})$/.exec(topic);if(!match)return;
   const item=pending.get(match[1]);if(!item)return;
   try{const packet=JSON.parse(bytes.toString());if(packet.device!==item.device)return;const response=await item.request.openResponse(packet);pending.delete(match[1]);item.resolve(response);}catch{/* Unauthenticated packets cannot change enrollment state. */}
  });
 }
 async function worker(){return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('App update is still loading. Reopen the app and try again.')),10000))]);}
 async function enable(){
  if(working)return;
  if(!('Notification' in globalThis)||!('PushManager' in globalThis))return status('Background push is not supported by this browser.');
  if(!device())return status('Enter the exact device MQTT topic before enabling alerts.');
  const password=el('pushDevicePassword')?.value||el('c-devkey')?.value||cfg.devKey||'';
  if(!password)return status('Enter the device dashboard password above. It authorizes this phone for this tank.');
  working=true;let created;
  try{
   const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Allow notifications in Android / browser settings, then try again.');
   status('Registering this phone securely…');
   const reg=await worker(),vapid=P.unb64(C.vapidPublicKey);let sub=await reg.pushManager.getSubscription();
   if(sub&&sub.options.applicationServerKey&&P.b64(sub.options.applicationServerKey)!==C.vapidPublicKey){await sub.unsubscribe();sub=null;}
   if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapid});created=sub;}
   const key=await P.pinKey(password,device());
   const registered=await rpc({op:'register',subscription:sub.toJSON(),preferences:settings(),appUrl:new URL('./',location.href).href},key);
   setSession({id:registered.id,manageToken:registered.manageToken,device:device(),endpoint:sub.endpoint,verifiedAt:Date.now()});
   if(el('pushDevicePassword'))el('pushDevicePassword').value='';
   unlockAch(2);serviceOnline=true;lastServiceSeen=Date.now();renderStatus();
   showToast('Background alerts enrolled. Tap TEST, then close the app.','ok',5000);
  }catch(error){if(created&&!isEnrolled())try{await created.unsubscribe();}catch{}status(error.message);showToast('Background alert setup is not complete. See the status message.','warn',5000);}
  finally{working=false;}
 }
 async function sync(){
  if(!isEnrolled()||working)return;
  try{
   const reg=await worker(),subscription=await reg.pushManager.getSubscription();
   if(!subscription||subscription.endpoint!==session.endpoint){setSession(null);renderStatus();return;}
   await rpc({op:'status',id:session.id,manageToken:session.manageToken});session.verifiedAt=Date.now();setSession(session);serviceOnline=true;lastServiceSeen=Date.now();
   if(new URL(location.href).searchParams.get('ack')==='1'&&/^[a-f0-9]{32}$/.test(ackId||''))await ackCurrent();
  }catch(error){serviceOnline=false;status(error.message);return;}
  renderStatus();
 }
 async function test(){
  if(!isEnrolled())return status('Enable background alerts first.');
  try{await rpc({op:'test',id:session.id,manageToken:session.manageToken});status('TEST scheduled in 10 seconds. Close the app now and check the phone notification. This is a test, not a real tank emergency.');}
  catch(error){status(error.message);}
 }
 async function disable(){
  if(working)return;working=true;
  try{if(session)try{await rpc({op:'unsubscribe',id:session.id,manageToken:session.manageToken});}catch{}
   const reg=await worker(),sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();setSession(null);renderStatus();
  }catch(error){status(error.message);}finally{working=false;}
 }
 async function ackCurrent(){
  if(!isEnrolled()||!/^[a-f0-9]{32}$/.test(ackId||''))return;
  try{await rpc({op:'ack',id:session.id,manageToken:session.manageToken,alertId:ackId});ackId=null;
   const url=new URL(location.href);url.searchParams.delete('alert');url.searchParams.delete('ack');history.replaceState(null,'',url);
   status('Alert acknowledged. Its remaining reminders are stopped.');
  }catch(error){status('Acknowledgement pending: '+error.message);}
 }
 function syncPreferences(){clearTimeout(prefTimer);prefTimer=setTimeout(async()=>{if(!isEnrolled())return;try{await rpc({op:'preferences',id:session.id,manageToken:session.manageToken,preferences:settings()});}catch(error){status('Alert preference sync pending: '+error.message);}},700);}
 globalThis.TasniBackground={enable,test,disable,attach,syncPreferences,isEnrolled,shouldDeferSystemNotification,ackCurrent,refresh:sync};
 navigator.serviceWorker?.addEventListener('message',event=>{
  if(!['ACK_ALERT','SHOW_ALERT'].includes(event.data?.type))return;
  if(!/^[a-f0-9]{32}$/.test(event.data.alertId||''))return;
  ackId=event.data.alertId;renderStatus();if(event.data.type==='ACK_ALERT')ackCurrent();
 });
 window.addEventListener('load',renderStatus);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 setInterval(()=>{if(!document.hidden)sync();},60000);
})();
