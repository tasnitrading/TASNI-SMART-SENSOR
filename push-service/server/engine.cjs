'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const P=require('../push-protocol.js');
const token=()=>randomBytes(32).toString('base64url');
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
function secureEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
function validSubscription(s){
  const u=new URL(s?.endpoint);const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||u.href.length>4096)throw Error('Unsupported push endpoint');
  if(P.unb64(s.keys?.p256dh).length!==65||P.unb64(s.keys?.auth).length!==16)throw Error('Invalid subscription keys');
  return {endpoint:u.href,expirationTime:s.expirationTime||null,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
function preferences(value={}){
  const result={};for(const key of ['critical','low','drop','fill','full','nightLeak','offline','sound'])result[key]=value[key]!==false;
  result.nightLeakThreshold=Math.max(5,Math.min(500,Number(value.nightLeakThreshold)||20));return result;
}
class Engine{
  constructor(filename,devices,clock=Date.now){
    this.devices=devices;this.clock=clock;this.graceUntil=clock()+120000;this.lastDispatch=clock();this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS phones(id TEXT PRIMARY KEY,device TEXT NOT NULL,endpoint_hash TEXT UNIQUE,subscription TEXT NOT NULL,token_hash TEXT NOT NULL,prefs TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS readings(device TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,device TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,resolved INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS deliveries(id INTEGER PRIMARY KEY,alert_id TEXT NOT NULL,phone_id TEXT NOT NULL,attempts INTEGER DEFAULT 0,next_at INTEGER NOT NULL,acked INTEGER DEFAULT 0,delivered INTEGER DEFAULT 0,FOREIGN KEY(phone_id) REFERENCES phones(id) ON DELETE CASCADE);`);
  }
  now(){return this.clock();}
  close(){this.db.close();}
  state(device){const r=this.db.prepare('SELECT value FROM readings WHERE device=?').get(device);return r?JSON.parse(r.value):null;}
  saveState(device,state){this.db.prepare('INSERT INTO readings(device,value) VALUES(?,?) ON CONFLICT(device) DO UPDATE SET value=excluded.value').run(device,JSON.stringify(state));}
  phone(id,device,manageToken){const r=this.db.prepare('SELECT * FROM phones WHERE id=? AND device=?').get(id,device);if(!r||!secureEqual(r.token_hash,digest(manageToken||'')))throw Error('Phone authorization failed');return r;}
  async command(packet,opened){
    const device=packet.device,setting=this.devices[device];if(!setting)throw Error('Device is not provisioned');
    const {payload:q,body}=opened;
    // Do not permit retained commands or replay across reconnects/restarts.
    if(this.db.prepare('SELECT id FROM requests WHERE id=?').get(packet.id))throw Error('Duplicate push request');
    if(q.op==='register'){
      const proofText=device+'|'+packet.id+'|'+body.sentAt+'|'+body.data;
      if(typeof body.proof!=='string'||!await P.verifyProof(setting.pinKey,proofText,body.proof))throw Error('Wrong device password');
      const subscription=validSubscription(q.subscription),hash=digest(subscription.endpoint);
      let existing=this.db.prepare('SELECT id,device FROM phones WHERE endpoint_hash=?').get(hash);
      if(existing&&existing.device!==device){this.db.prepare('DELETE FROM phones WHERE id=?').run(existing.id);existing=null;}
      const appUrl=String(q.appUrl||'https://tasnitrading.github.io/tasni/');
      if(!['https://tasnitrading.github.io/tasni/','https://tasnitrading.github.io/TASNI-SMART-SENSOR/'].includes(appUrl))throw Error('Invalid app origin');
      subscription._appUrl=appUrl;
      // A single endpoint may change devices only with the new device password.
      const count=this.db.prepare('SELECT count(*) AS n FROM phones WHERE device=?').get(device).n;
      if(!existing&&count>=16)throw Error('Phone limit reached');
      const id=existing?.id||P.id(),manageToken=token();
      this.db.prepare(`INSERT INTO phones(id,device,endpoint_hash,subscription,token_hash,prefs,updated) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(endpoint_hash) DO UPDATE SET device=excluded.device,subscription=excluded.subscription,token_hash=excluded.token_hash,prefs=excluded.prefs,updated=excluded.updated`).run(id,device,hash,JSON.stringify(subscription),digest(manageToken),JSON.stringify(preferences(q.preferences)),this.now());
      this.rememberRequest(packet.id);return {ok:true,id,manageToken,registered:true};
    }
    if(q.op==='ping'){this.rememberRequest(packet.id);return {ok:true,service:'online',time:this.now(),version:'2.3.0'};}
    const phone=this.phone(q.id,device,q.manageToken);
    this.rememberRequest(packet.id);
    if(q.op==='status')return {ok:true,registered:true,lastDeviceSample:this.state(device)?.lastLive||null,version:'2.3.0'};
    if(q.op==='preferences'){this.db.prepare('UPDATE phones SET prefs=?,updated=? WHERE id=?').run(JSON.stringify(preferences(q.preferences)),this.now(),phone.id);return {ok:true};}
    if(q.op==='unsubscribe'){this.db.prepare('DELETE FROM phones WHERE id=?').run(phone.id);return {ok:true};}
    if(q.op==='ack'){
      this.db.prepare('UPDATE deliveries SET acked=1 WHERE phone_id=? AND alert_id=?').run(phone.id,String(q.alertId||''));return {ok:true,acknowledged:true};
    }
    if(q.op==='test'){
      const last=this.db.prepare("SELECT created FROM alerts WHERE kind='test' AND device=? ORDER BY created DESC LIMIT 1").get(device);
      if(last&&this.now()-last.created<30000)throw Error('Wait 30 seconds between tests');
      this.alert(device,'test','TASNI® alert test','TEST: Background alerts are working. This is not a real water-level emergency.',true,undefined,phone.id,this.now()+10000);
      return {ok:true,scheduledInSeconds:10};
    }
    throw Error('Unknown push operation');
  }
  rememberRequest(id){this.db.prepare('INSERT INTO requests(id,created) VALUES(?,?)').run(id,this.now());this.db.prepare('DELETE FROM requests WHERE created<?').run(this.now()-86400000);}
  alert(device,kind,title,body,critical=false,level,onlyPhone,due=this.now()){
    const id=P.id(),payload={alertId:id,device,kind,type:critical?'ac':'aw',title,body,critical,level,createdAt:this.now(),url:'./',tag:'tasni-'+device+'-'+kind};
    this.db.prepare('INSERT INTO alerts(id,device,kind,payload,created) VALUES(?,?,?,?,?)').run(id,device,kind,JSON.stringify(payload),this.now());
    const phones=this.db.prepare('SELECT id,prefs FROM phones WHERE device=?').all(device);
    for(const phone of phones){const prefs=JSON.parse(phone.prefs);if(onlyPhone?phone.id!==onlyPhone:prefs[kind]===false)continue;
      this.db.prepare('INSERT INTO deliveries(alert_id,phone_id,next_at) VALUES(?,?,?)').run(id,phone.id,due);
    }
    return id;
  }
  resolve(device,kind){this.db.prepare('UPDATE alerts SET resolved=1 WHERE device=? AND kind=?').run(device,kind);}
  sample(topic,data,retained=false){
    const match=/^tasni-water\/([0-9A-F]{12})\/state$/.exec(topic);if(!match||!this.devices[match[1]])return false;
    const device=match[1],now=this.now(),level=Number(data.level??data.m),epoch=Number(data.epoch)*1000,age=Number(data.sampleAgeMs);
    if(data.device!==device||!Number.isFinite(level)||level<0||level>100||Number(data.c)!==1||!Number.isFinite(age)||age<0||age>12000||!Number.isFinite(epoch)||now-epoch>45000||epoch-now>120000)return false;
    const key=[data.boot,data.uptime,level,epoch].join(':'),old=this.state(device);
    if(retained){if(!old)this.saveState(device,{level,lastLive:epoch,key,validCount:0,criticalCount:0,low:false,full:false,filled:false,name:String(data.name||'Water tank').slice(0,64)});return false;}
    if(old?.key===key)return false;
    this.resolve(device,'offline');
    const gap=!old||now-old.lastLive>120000;
    const state={...(old||{}),level,key,lastLive:now,validCount:gap?1:(old.validCount||0)+1,name:String(data.name||'Water tank').slice(0,64),offline:false};
    const label='TASNI® '+state.name,stable=old&&Math.abs(old.level-level)<=3;
    state.criticalCount=level<10?(gap?1:(old.criticalCount||0)+1):0;
    if(level>=12){state.critical=false;this.resolve(device,'critical');}
    if(state.criticalCount>=2&&!state.critical){state.critical=true;this.alert(device,'critical',label+' — CRITICAL',`Tank at ${level}% (${Math.round(Number(data.volume)||0)} L). Refill immediately.`,true,level);}
    if(level>=33)state.low=false;
    if(level<30&&stable&&state.validCount>=2&&!state.low){state.low=true;this.alert(device,'low',label+' — LOW',`Water level is ${level}%. Please schedule a refill.`,false,level);}
    if(level<87)state.filled=false;
    if(level>=90&&stable&&state.validCount>=2&&!state.filled){state.filled=true;this.alert(device,'fill',label+' — REFILLED',`Tank refilled to ${level}%.`,false,level);}
    if(Number(data.isFull)!==1)state.full=false;
    if(Number(data.isFull)===1&&Number(old?.isFull)===1&&state.validCount>=2&&!state.full){state.full=true;this.alert(device,'full',label+' — FULL',`Tank is full (${level}%). Check the pump.`,false,level);}
    state.isFull=Number(data.isFull);
    if(!gap&&old&&old.level-level>=10){state.pendingDrop={from:old.level,to:level,at:now};}
    else if(state.pendingDrop&&stable&&now-state.pendingDrop.at<60000){
      const amount=state.pendingDrop.from-level;
      if(amount>=10&&(!state.lastDrop||now-state.lastDrop>300000)){state.lastDrop=now;this.alert(device,'drop',label+' — RAPID DROP',`Level fell ${amount}% to ${level}%. Check for a leak or heavy water use.`,true,level);}
      delete state.pendingDrop;
    }
    // Night totals use the device's Indian operating time and reset at 06:00.
    const local=new Date(now+19800000),hour=local.getUTCHours(),night=hour>=22||hour<6;
    const nightKey=new Date(now+19800000-21600000).toISOString().slice(0,10);
    if(state.nightKey!==nightKey){state.nightKey=nightKey;state.nightLitres=0;state.nightNotified=0;}
    if(night&&!gap&&old&&old.level>level&&old.level-level<10)state.nightLitres=(state.nightLitres||0)+(old.level-level)/100*(Number(data.total)||1000);
    if(night&&(state.nightLitres||0)>=5&&Math.floor(state.nightLitres/5)>(state.nightNotified||0)){
      state.nightNotified=Math.floor(state.nightLitres/5);this.alert(device,'nightLeak',label+' — NIGHT WATER LOSS',`About ${Math.round(state.nightLitres)} L used overnight. Check taps and pipes.`,false,level);
    }
    this.saveState(device,state);return true;
  }
  async dispatch(send){
    const now=this.now();
    if(now-this.lastDispatch>30000)this.graceUntil=now+120000;
    this.lastDispatch=now;
    for(const device of Object.keys(this.devices)){
      const state=this.state(device);if(now>=this.graceUntil&&state&&state.validCount>=2&&now-state.lastLive>120000&&!state.offline){state.offline=true;this.saveState(device,state);this.alert(device,'offline','TASNI® — device data unavailable','No fresh tank reading for two minutes. Check device Wi-Fi and power.');}
    }
    const rows=this.db.prepare(`SELECT d.*,a.payload,a.kind,a.created,a.device,p.subscription,p.prefs FROM deliveries d JOIN alerts a ON a.id=d.alert_id JOIN phones p ON p.id=d.phone_id
      WHERE d.acked=0 AND a.resolved=0 AND d.next_at<=? AND d.attempts<6 ORDER BY d.next_at LIMIT 20`).all(now);
    for(const row of rows){
      const payload=JSON.parse(row.payload),prefs=JSON.parse(row.prefs);
      if(row.kind!=='test'&&prefs[row.kind]===false){this.db.prepare('UPDATE deliveries SET acked=1 WHERE id=?').run(row.id);continue;}
      if(row.kind==='nightLeak'&&Number((/About (\d+)/.exec(payload.body)||[])[1])<prefs.nightLeakThreshold){this.db.prepare('UPDATE deliveries SET acked=1 WHERE id=?').run(row.id);continue;}
      // Do not replay historical alarms after a PC sleep or server outage.
      if(now-row.created>120000&&row.delivered===0&&row.kind!=='critical'){this.db.prepare('UPDATE deliveries SET acked=1 WHERE id=?').run(row.id);continue;}
      if(row.kind==='critical'&&now-(this.state(row.device)?.lastLive||0)>120000){this.db.prepare('UPDATE deliveries SET next_at=? WHERE id=?').run(now+60000,row.id);continue;}
      if(row.delivered>0){payload.body='REMINDER: '+payload.body;payload.reminder=true;}
      payload.sound=prefs.sound;payload.sequence=row.delivered;payload.expiresAt=now+120000;payload.url=JSON.parse(row.subscription)._appUrl;
      try{
        await send(JSON.parse(row.subscription),payload);
        const repeat=payload.critical&&row.kind!=='test'&&row.delivered<3;
        this.db.prepare('UPDATE deliveries SET attempts=attempts+1,delivered=delivered+1,next_at=?,acked=? WHERE id=?').run(now+300000,repeat?0:1,row.id);
      }catch(error){
        if(error.statusCode===404||error.statusCode===410)this.db.prepare('DELETE FROM phones WHERE id=?').run(row.phone_id);
        else this.db.prepare('UPDATE deliveries SET attempts=attempts+1,next_at=? WHERE id=?').run(now+Math.min(300000,15000*2**row.attempts),row.id);
      }
    }
  }
}
module.exports={Engine,validSubscription,preferences,digest};
