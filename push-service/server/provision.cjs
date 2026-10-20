'use strict';
const fs=require('node:fs'),path=require('node:path'),webpush=require('web-push');
const P=require('../push-protocol.js');
(async()=>{
 const root=process.env.TASNI_PUSH_DATA||path.join(process.env.LOCALAPPDATA||process.cwd(),'TASNI','PushService');
 fs.mkdirSync(root,{recursive:true,mode:0o700});const filename=path.join(root,'config.json');
 let config;
 if(fs.existsSync(filename))config=JSON.parse(fs.readFileSync(filename,'utf8'));
 else{
  const device=process.env.TASNI_DEVICE_ID||'D4E9F4B23600';
  if(!process.env.TASNI_DEVICE_PASSWORD||!process.env.TASNI_MQTT_PASSWORD)throw Error('Supply device and MQTT credentials through environment variables');
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  config={serviceId:P.id(),encryption:{privateJwk:await crypto.subtle.exportKey('jwk',pair.privateKey),publicJwk:await crypto.subtle.exportKey('jwk',pair.publicKey)},
   vapid:webpush.generateVAPIDKeys(),mqtt:{host:'d7917721.ala.asia-southeast1.emqxsl.com',username:'tasni_water',password:process.env.TASNI_MQTT_PASSWORD},
   devices:{[device]:{pinKey:await P.pinKey(process.env.TASNI_DEVICE_PASSWORD,device)}}};
  fs.writeFileSync(filename,JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
 }
 const publicConfig={serviceId:config.serviceId,publicJwk:config.encryption.publicJwk,vapidPublicKey:config.vapid.publicKey,version:'2.3.0'};
 fs.writeFileSync(path.join(process.cwd(),'push-config.js'),'globalThis.TASNI_PUSH_CONFIG = '+JSON.stringify(publicConfig)+';\n');
 console.log(JSON.stringify({provisioned:true,devices:Object.keys(config.devices),publicConfig}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
