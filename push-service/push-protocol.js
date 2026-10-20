(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TasniPushProtocol=api;})(globalThis,function(){
  'use strict';
  const enc=new TextEncoder(),dec=new TextDecoder(),subtle=globalThis.crypto.subtle;
  const bytes=s=>enc.encode(s);
  function b64(data){return btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function unb64(s){if(typeof s!=='string'||!s||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('Invalid encoding');return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));}
  function validateHeader(p){if(p?.v!==1||!/^[0-9A-F]{12}$/.test(p.device)||!/^[a-f0-9]{32}$/.test(p.id))throw Error('Invalid push message');}
  function id(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');}
  async function pinKey(password,device){
    const base=await subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);
    return b64(await subtle.deriveBits({name:'PBKDF2',salt:bytes('TASNI-PUSH-PIN-v1|'+device),iterations:100000,hash:'SHA-256'},base,256));
  }
  async function proof(key,message){const k=await subtle.importKey('raw',unb64(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await subtle.sign('HMAC',k,bytes(message)));}
  async function verifyProof(key,message,signature){const k=await subtle.importKey('raw',unb64(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);return subtle.verify('HMAC',k,unb64(signature),bytes(message));}
  async function shared(privateKey,publicJwk,device,requestId){
    if(publicJwk?.kty!=='EC'||publicJwk.crv!=='P-256'||publicJwk.d)throw Error('Invalid service key');
    const peer=await subtle.importKey('jwk',publicJwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const material=await subtle.deriveBits({name:'ECDH',public:peer},privateKey,256);
    const hkdf=await subtle.importKey('raw',material,'HKDF',false,['deriveKey']);
    return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(requestId),info:bytes('TASNI-PUSH-v1|'+device)},hkdf,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function seal(key,header,data){const iv=crypto.getRandomValues(new Uint8Array(12));const box=await subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(header.device+'|'+header.id+'|1')},key,bytes(JSON.stringify(data)));return {v:1,device:header.device,id:header.id,iv:b64(iv),box:b64(box)};}
  async function open(key,p){validateHeader(p);const iv=unb64(p.iv);if(iv.length!==12||p.box.length>16000)throw Error('Invalid push message');return JSON.parse(dec.decode(await subtle.decrypt({name:'AES-GCM',iv,additionalData:bytes(p.device+'|'+p.id+'|1')},key,unb64(p.box))));}
  async function request(publicJwk,device,payload,registrationKey){
    const header={v:1,device,id:id()},pair=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const key=await shared(pair.privateKey,publicJwk,device,header.id),data=JSON.stringify(payload),sentAt=Date.now();
    const signature=registrationKey?await proof(registrationKey,device+'|'+header.id+'|'+sentAt+'|'+data):null;
    const packet=await seal(key,header,{sentAt,data,proof:signature});packet.key=await subtle.exportKey('jwk',pair.publicKey);
    return {packet,openResponse:response=>open(key,response)};
  }
  async function receive(privateJwk,packet,now=Date.now()){
    validateHeader(packet);const pk=await subtle.importKey('jwk',privateJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    const key=await shared(pk,packet.key,packet.device,packet.id),body=await open(key,packet);
    if(!Number.isFinite(body.sentAt)||Math.abs(now-body.sentAt)>120000||typeof body.data!=='string')throw Error('Expired push request');
    return {body,payload:JSON.parse(body.data),reply:data=>seal(key,packet,data)};
  }
  return {b64,unb64,id,pinKey,proof,verifyProof,request,receive};
});
