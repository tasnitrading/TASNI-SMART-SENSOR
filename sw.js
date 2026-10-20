// ═══════════════════════════════════════════════════════════
//  TASNI Water Monitor — Service Worker v2.3.0
//  Offline app shell and push notification delivery
// ═══════════════════════════════════════════════════════════

const CACHE = 'tasni-v2.3.0';
const ASSETS = ['./index.html', './manifest.json', './icon.svg', './push-config.js', './push-protocol.js', './push-client.js'];

// ── Background sync state (shared via IndexedDB) ──
const DB_NAME = 'tasni_sw_db';
const DB_STORE = 'state';

// ═══════════════════════════════
//  INSTALL & ACTIVATE
// ═══════════════════════════════
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════
//  FETCH — network-first navigation; authenticated device APIs bypass cache
// ═══════════════════════════════
self.addEventListener('fetch', e => {
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // Device APIs and authenticated requests must never be cached.
  if(url.origin!==self.location.origin||e.request.headers.has('Authorization'))return;
  if(e.request.mode==='navigate'||url.pathname.endsWith('/index.html')){
    e.respondWith(fetch(e.request,{cache:'no-cache'}).then(async res=>{
      if(res.ok){const cache=await caches.open(CACHE);await cache.put(e.request,res.clone());}
      return res;
    }).catch(()=>caches.match(e.request).then(cached=>cached||Response.error())));
  }else{
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));
  }
});

// ═══════════════════════════════
//  PUSH — rich notifications
// ═══════════════════════════════
self.addEventListener('push', e => {
  e.waitUntil((async()=>{
    let d;try{d=e.data?.json();}catch{d=null;}
    if(!d||typeof d.title!=='string')return;
    if(d.expiresAt&&Date.now()>d.expiresAt)return;
    const key='push-seen:'+String(d.alertId||'unknown');
    const sequence=Number(d.sequence)||0,previous=await getSwState(key);
    if(previous&&previous.sequence>=sequence)return;
    const silent=d.sound===false;
    const opts={body:String(d.body||'').slice(0,700),icon:'./icon.svg',badge:'./icon.svg',
      tag:String(d.tag||'tasni-alert'),requireInteraction:d.critical===true,renotify:true,silent,
      timestamp:Number(d.createdAt)||Date.now(),data:{url:d.url||'./',alertId:d.alertId,device:d.device,level:d.level,type:d.type},
      actions:d.critical?[{action:'ack',title:'Acknowledge'},{action:'view',title:'Open tank'}]:[{action:'view',title:'Open tank'}]};
    if(!silent)opts.vibrate=d.critical?[300,100,300,100,600,100,300]:[150,60,150];
    await self.registration.showNotification(String(d.title).slice(0,128),opts);
    await storeSwState(key,{sequence,at:Date.now()});
    await storeSwState('lastPush',{alertId:d.alertId,kind:d.kind,title:d.title,body:d.body,sequence,at:Date.now()});
  })());
});

// ═══════════════════════════════
//  NOTIFICATION CLICK
// ═══════════════════════════════
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async()=>{
    const d=e.notification.data||{},id=/^[a-f0-9]{32}$/.test(d.alertId||'')?d.alertId:null;
    let url=new URL('./',self.registration.scope);
    if(id){url.searchParams.set('alert',id);if(e.action==='ack')url.searchParams.set('ack','1');}
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if(client.url.startsWith(self.registration.scope)){
        client.postMessage({type:e.action==='ack'?'ACK_ALERT':'SHOW_ALERT',alertId:id});
        return client.focus();
      }
    }
    return clients.openWindow(url.href);
  })());
});

// ═══════════════════════════════
//  MESSAGE — receive commands from main app
// ═══════════════════════════════
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'STORE_CONFIG') {
    storeSwState('config', e.data.config);
  }
  if (e.data && e.data.type === 'STORE_LEVEL') {
    storeSwState('lastLevel', e.data.level);
    storeSwState('lastTs', Date.now());
  }
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════
//  IndexedDB helpers
// ═══════════════════════════════
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
async function storeSwState(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
async function getSwState(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}
