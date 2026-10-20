const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
function worker(){
 const events={},values=new Map(),notifications=[],opened=[],focus=[];
 const context={URL,Date,Uint8Array,Promise,console,indexedDB:{},self:{registration:{scope:'https://tasnitrading.github.io/tasni/',showNotification:async(title,options)=>notifications.push({title,options})},addEventListener:(name,fn)=>events[name]=fn},
  clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.createContext(context);vm.runInContext(fs.readFileSync([path.join(__dirname,'../../sw.js'),path.join(__dirname,'../../tasni/sw.js')].find(p=>fs.existsSync(p)),'utf8'),context);
 context.getSwState=async key=>values.get(key)??null;context.storeSwState=async(key,value)=>values.set(key,value);
 async function fire(name,event){let done;events[name]({...event,waitUntil:p=>{done=p;}});await done;}
 return {context,notifications,opened,fire};
}
test('critical push requests sound, vibration, persistence and an acknowledgement action',async()=>{
 const w=worker(),d={title:'TASNI CRITICAL',body:'Test body',alertId:'a'.repeat(32),critical:true,device:'D4E9F4B23600',sound:true,sequence:0,expiresAt:Date.now()+10000};
 await w.fire('push',{data:{json:()=>d}});
 const n=w.notifications[0];assert(n.options.requireInteraction);assert.equal(n.options.silent,false);assert(n.options.vibrate.length>3);assert.equal(n.options.actions[0].action,'ack');
 await w.fire('push',{data:{json:()=>d}});assert.equal(w.notifications.length,1);
 await w.fire('push',{data:{json:()=>({...d,sequence:1,reminder:true})}});assert.equal(w.notifications.length,2);
});
test('sound-disabled notifications omit vibration and expired data cannot trigger a current alarm',async()=>{
 const w=worker();await w.fire('push',{data:{json:()=>({title:'TASNI',alertId:'b'.repeat(32),sound:false,sequence:0})}});
 assert.equal(w.notifications[0].options.silent,true);assert.equal(w.notifications[0].options.vibrate,undefined);
 await w.fire('push',{data:{json:()=>({title:'Old alert',alertId:'c'.repeat(32),expiresAt:Date.now()-1})}});assert.equal(w.notifications.length,1);
});
test('acknowledging a closed-app notification opens the correct app with the alert id',async()=>{
 const w=worker();let closed=false;
 await w.fire('notificationclick',{action:'ack',notification:{close:()=>{closed=true;},data:{alertId:'a'.repeat(32)}}});
 assert(closed);const url=new URL(w.opened[0]);assert.equal(url.origin,'https://tasnitrading.github.io');assert.equal(url.pathname,'/tasni/');assert.equal(url.searchParams.get('ack'),'1');
});
