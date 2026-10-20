'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=process.env.TASNI_PUSH_DATA||path.join(process.env.LOCALAPPDATA||process.cwd(),'TASNI','PushService');
fs.mkdirSync(root,{recursive:true});const log=path.join(root,'service.log');
let child,stopping=false;
function start(){
 if(stopping)return;
 try{if(fs.existsSync(log)&&fs.statSync(log).size>4*1024*1024)fs.renameSync(log,log+'.previous');}catch{}
 const fd=fs.openSync(log,'a');
 child=spawn(process.execPath,[path.join(__dirname,'service.cjs')],{cwd:path.join(__dirname,'..'),windowsHide:true,stdio:['ignore',fd,fd]});
 fs.closeSync(fd);child.on('error',()=>{});child.on('exit',()=>{if(!stopping)setTimeout(start,5000);});
}
process.on('SIGTERM',()=>{stopping=true;child?.kill();setTimeout(()=>process.exit(0),1000);});start();
