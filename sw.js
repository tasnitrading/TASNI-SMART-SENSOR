const CACHE='tasni-v2';
const ASSETS=['./index.html','./manifest.json','./icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  if(e.request.url.includes('/sensor-reading')||e.request.url.includes('/save-')) return;
  e.respondWith(caches.match(e.request).then(cached=>{
    const net=fetch(e.request).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(ch=>ch.put(e.request,c));}return res;}).catch(()=>cached);
    return cached||net;
  }));
});
self.addEventListener('push',e=>{
  const d=e.data?e.data.json():{title:'TASNI Alert',body:'Water level update'};
  e.waitUntil(self.registration.showNotification(d.title||'TASNI Alert',{body:d.body||'',icon:'./icon.svg',badge:'./icon.svg',tag:'tasni-alert',requireInteraction:!!d.critical,data:{url:'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(list=>{for(const c of list){if('focus' in c)return c.focus();}if(clients.openWindow)return clients.openWindow('./');} ));
});
