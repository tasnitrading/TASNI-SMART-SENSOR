const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function extract(signature){const a=html.indexOf(signature);assert(a>=0,signature);const b=html.indexOf('\n}',a);assert(b>=0);return html.slice(a,b+2);}
const names=['function deviceAuthHeaders(){','function deviceBase(ip){','function deviceFetch(ip,path,options={}){',
 'function _setDataStatus(text){','function _acceptDeviceTopic(topic,d){','function _showCachedReading(d){',
 'function ingestMQTT(d){','function ingest(d,fromMQTT=false){','function _setTankAnim(dir){','function renderDash(){',
 'async function saveWifi(){','async function fetchSensor(ip){'];
const source=names.map(extract).join('\n');
const test=`
const nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,innerHTML:'',textContent:'',style:{},className:'',classList:{add(){},remove(){},contains(){return false;}}});return nodes.get(id);}
const document={getElementById:node};
let cfg={topic:'tasni-water/D4E9F4B23600/state',devKey:'device-test-password',ssid:'old-router'};
const S={m:null,vol:0,total:1000,s:'Offline',dist:0,t:'',usage:0,up:0,rssi:0,boot:0,isFull:0,name:'Tank',history:Array(24).fill(null),connected:false,lastUpdate:null};
let _staleTimer,_cachedReading=null,_lastMqttSample='',_fetchBusy=false,_wifiSaving=false,_lastLiveAt=0;
let _displayReady=false,_bootGuardActive=true,_bootGuardTimer=0,_animTimer,_lastMotionDir=0,_pendingIngest=null;
let demoMode=false,_lastHistorySave=Date.now(),_lastAlertBandDown=null,_lastAlertBandUp=null;
const STALE_MS=30000;
let alertCalls=0,resetCalls=0,achievements=0,pollCalls=0,fetchCalls=0;
const analyticsSession={confirmedSamples:0,totalUsedL:0,events:[],periodTotals:{},readings:[],fullTankEvents:[],nightReadings:[],nightReadingsPct:[],dayReadings:[],suddenDrops:[],nightLeakLiters:0};
const setTimeout=(fn)=>{queueMicrotask(fn);return 0;},clearTimeout=()=>{};
const saveCfg=u=>Object.assign(cfg,u),g=id=>node(id).value.trim(),set=(id,value)=>{node(id).innerHTML=value;};
const showToast=()=>{},unlockAch=()=>{achievements++;},startPoll=()=>{pollCalls++;},setChip=()=>{},updatePill=()=>{};
const _resetStaleTimer=()=>{resetCalls++;},_updateTankHealth=()=>{},_renderDashInsights=()=>{},_saveHourly=()=>{},recordUsageEvent=()=>{},ck=()=>false;
const checkAlerts=()=>{alertCalls++;},playConnectSound=()=>{},_autoPromptNotif=()=>{};
const fmtUp=x=>String(x),fmtHrs=x=>String(x);
let fetch=()=>{throw Error('unexpected network request');};
${source}
(async()=>{
const check=(ok,label)=>{assert(ok,label);console.log('PASS '+label);};
check(deviceAuthHeaders().Authorization==='Basic '+Buffer.from('admin:device-test-password').toString('base64'),'device requests use the actual firmware Basic Auth protocol');
check(deviceBase('http://192.168.29.84/')==='http://192.168.29.84','IP normalization accepts the device address');
assert.throws(()=>deviceBase('example.com/path'));
check(!_acceptDeviceTopic('tasni-water/OTHER/state',{device:'OTHER'}),'an exact configured topic rejects a different device');
cfg.topic='tasni-water/+/state';check(_acceptDeviceTopic('tasni-water/A/state',{device:'A'})&&!_acceptDeviceTopic('tasni-water/B/state',{device:'B'}),'wildcard discovery binds one device and prevents mixed readings');
_showCachedReading({level:56,volume:560,fw:'6.2.0-TEST.1',ts:'old timestamp'});
check(node('statusBadge').textContent==='LAST KNOWN'&&node('levelNum').innerHTML.startsWith('56')&&!S.connected&&analyticsSession.confirmedSamples===0&&alertCalls===0,'retained values display as last known without live status, alerts or analytics');
const live={device:'A',boot:22,uptime:80,level:58,volume:580,total:1000,dist:56.5,status:'Good',c:1,epoch:Math.floor(Date.now()/1000),sampleAgeMs:500,fw:'6.2.4-TEST.1'};
ingestMQTT(live);
check(S.m===58&&S.connected&&_displayReady&&!_cachedReading&&analyticsSession.confirmedSamples===1,'the first valid live sample displays immediately without a blank ten-second delay');
ingestMQTT(live);check(analyticsSession.confirmedSamples===1,'duplicate primary and backup messages are counted once');
ingestMQTT({...live,uptime:81,level:92,volume:920});
check(S.m===92&&S.vol===920,'a real change above twenty percent cannot freeze the app indefinitely');
ingestMQTT({...live,uptime:82,level:999});check(S.m===92,'out of range data cannot overwrite the current reading');
ingestMQTT({...live,uptime:83,level:9,c:0});check(S.m===92,'a sensor fault cannot appear as an empty tank');
const n=analyticsSession.confirmedSamples;ingestMQTT({...live,uptime:84,epoch:Math.floor(Date.now()/1000)-600,level:10});
check(analyticsSession.confirmedSamples===n&&S.m===92,'old timestamped data cannot become a new live reading');
node('c-ip').value='192.168.29.84';node('c-devkey').value='device-test-password';node('c-ssid').value='new-router';node('c-pass').value=' secret-pass ';
let sent;
fetch=async(url,opts)=>{fetchCalls++;sent=opts;return {status:200,ok:true,json:async()=>({ok:true,id:1,status:'committed',ip:'192.168.29.84'})};};
await saveWifi();
check(sent.body.get('password')===' secret-pass '&&cfg.ssid==='new-router'&&node('c-pass').value===''&&!('wifiPass' in cfg),'confirmed Wi-Fi saves preserve whitespace and do not store the Wi-Fi secret on the phone');
check(sent.headers.Authorization.startsWith('Basic ')&&!node('wifiSaveButton').disabled,'Wi-Fi request is authenticated and releases the submit button');
cfg.ssid='old-router';node('c-ssid').value='wrong-router';node('c-pass').value='wrong-pass';
fetch=async()=>({status:202,ok:true,json:async()=>({ok:true,id:2,status:'rolled_back'})});
await saveWifi();check(cfg.ssid==='old-router'&&node('wifiUpdateStatus').textContent.includes('failed'),'rolled-back credentials are never reported as saved');
fetch=async()=>({status:401,ok:false});await saveWifi();
check(cfg.ssid==='old-router'&&node('wifiUpdateStatus').textContent.includes('Wrong device password'),'wrong device authentication gives an actionable error without applying candidate settings');
fetch=async()=>{throw Error('Network blocked');};await saveWifi();
check(node('wifiUpdateStatus').textContent.includes('Local Network Access')&&cfg.ssid==='old-router','a blocked or unreachable device does not falsely report saved Wi-Fi');
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
vm.runInNewContext(test,{assert,Buffer,TextEncoder,URLSearchParams,AbortSignal,btoa,console,queueMicrotask,process});
