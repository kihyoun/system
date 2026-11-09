#!/usr/bin/env node
'use strict';
// Explicit postdeployment acceptance on the locally selected native controller.
// Private inputs/reports are operator-owned files outside the reviewed checkout.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const acceptance=require('./guided-preview');
const root=path.resolve(__dirname,'../..');
function requireValue(value,code){if(!value)throw Error(code);}
function outsideCheckout(filename){const relative=path.relative(root,filename);return relative.startsWith('..'+path.sep)||path.isAbsolute(relative);}
function readInput(filename) {
  filename=path.resolve(filename);
  requireValue(outsideCheckout(filename)&&fs.realpathSync(filename)===filename,'guided-preview-private-input-outside-checkout-required');
  const stat=fs.lstatSync(filename);
  requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=30000&&(stat.mode&0o077)===0,'guided-preview-private-regular-input-required');
  let input;try{input=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{throw Error('guided-preview-input-json-required');}
  const keys=['version','syncUrl','gitlabUrl','controllerImageId','settings','reportPath','timeBudgetMilliseconds'];
  requireValue(input?.version===1&&Object.keys(input).every(key=>keys.includes(key))&&/^sha256:[a-f0-9]{64}$/.test(input.controllerImageId),'guided-preview-input-contract-invalid');
  for(const key of ['syncUrl','gitlabUrl']) {
    let url;try{url=new URL(input[key]);}catch{throw Error('guided-preview-https-platform-urls-required');}
    requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','guided-preview-https-platform-urls-required');
    input[key]=url.origin;
  }
  requireValue(typeof input.reportPath==='string'&&path.isAbsolute(input.reportPath)&&outsideCheckout(input.reportPath)&&
    path.resolve(input.reportPath)!==filename&&fs.realpathSync(path.dirname(input.reportPath))===path.dirname(input.reportPath),'guided-preview-private-report-outside-checkout-required');
  if(fs.existsSync(input.reportPath)) {
    const report=fs.lstatSync(input.reportPath);requireValue(report.isFile()&&!report.isSymbolicLink()&&(report.mode&0o077)===0,'guided-preview-private-report-required');
  }
  const budget=input.timeBudgetMilliseconds??3600000;
  requireValue(Number.isSafeInteger(budget)&&budget>=60000&&budget<=7200000,'guided-preview-bounded-budget-required');
  input.timeBudgetMilliseconds=budget;
  acceptance.settings({id:'a'.repeat(24),spec:{operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:input.settings}});
  return input;
}
const requestScript=`let raw='';process.stdin.on('data',part=>raw+=part);process.stdin.on('end',()=>{try{const input=JSON.parse(raw),url=new URL(input.url);if(url.protocol!=='https:'||!Number.isSafeInteger(input.timeoutMilliseconds)||input.timeoutMilliseconds<1||input.timeoutMilliseconds>300000)throw Error();const transport=require('node:https');const req=transport.request(url,{...input.options,signal:AbortSignal.timeout(input.timeoutMilliseconds)},res=>{let body='';res.on('data',part=>{body+=part;if(body.length>8000000)req.destroy();});res.on('error',()=>process.exitCode=1);res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body})));});req.on('error',()=>process.exitCode=1);req.end(input.options.body); }catch{process.exitCode=1;}});`;
class Operator {
  constructor(input,{command=spawnSync,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    this.input=input;this.command=command;this.now=now;this.sleep=sleep;this.id=crypto.randomBytes(12).toString('hex');
    this.spec={operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:input.settings};
    this.url=input.syncUrl;this.gitlabUrl=input.gitlabUrl;this.evidence={};this.stages=[];this.deadline=now()+input.timeBudgetMilliseconds;
  }
  async inner(args,{input,timeout=120000}={}) {
    const remaining=(this.cleanupDeadline||this.deadline)-this.now();requireValue(remaining>0,'guided-preview-overall-timeout');
    const result=this.command('docker',['--host=unix:///var/run/docker.sock',...args],{input,encoding:'utf8',timeout:Math.min(timeout,remaining),maxBuffer:16000000,stdio:['pipe','pipe','pipe']});
    requireValue(!result.error&&result.status===0,'guided-preview-native-command-failed');return result.stdout||'';
  }
  async request(url,options={}) {
    // Host is derived from each exact TLS URL. Never relay another host's
    // private authentication header to a redirect or alternative endpoint.
    const {Host:_host,...headers}=options.headers||{};
    const preflight=url===this.url+'/projects/wizard/preview-setup/preflight'&&options.method==='POST';
    const remaining=(this.cleanupDeadline||this.deadline)-this.now();
    const timeoutMilliseconds=Math.min(preflight?300000:20000,remaining-1000);
    requireValue(timeoutMilliseconds>0,'guided-preview-overall-timeout');
    const result=await this.inner(['exec','-i','system_bootstrapper_1','node','-e',requestScript],
      {input:JSON.stringify({url,options:{...options,headers},timeoutMilliseconds}),timeout:timeoutMilliseconds+10000});
    try{return JSON.parse(result);}catch{throw Error('guided-preview-http-result-invalid');}
  }
  async api(route,token,method='GET',payload) {
    const result=await this.request(this.gitlabUrl+'/api/v4'+route,{method,headers:{'PRIVATE-TOKEN':token,'Content-Type':'application/json'},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    requireValue(result.status>=200&&result.status<300,'guided-preview-gitlab-api-request-failed');
    if(!result.body)return null;try{return JSON.parse(result.body);}catch{return result.body;}
  }
  async rails(script) {
    const result=await this.inner(['exec','-i','system_gitlab_1','gitlab-rails','runner','-'],{input:script,timeout:180000});
    try{return JSON.parse(result.trim().split('\n').at(-1));}catch{throw Error('guided-preview-native-rails-result-invalid');}
  }
  async wait(action,milliseconds) {
    const end=Math.min(this.now()+milliseconds,this.deadline);
    while(this.now()<end){if(await action())return;await this.sleep(2000);}
    throw Error('guided-preview-native-check-timeout');
  }
  report() {
    const report={version:1,operation:this.id,mode:this.mode,controllerImageId:this.input.controllerImageId,stages:this.stages,evidence:this.evidence,
      scope:this.mode==='apply'?'Real native source push/MR pipelines and Review lifecycle. No Production promotion or automatic restore.':'Preflight only; no source import, build, adoption or Review deployment.',
      completed:this.completed===true,acceptancePassed:this.mode==='apply'&&this.completed===true};
    const next=this.input.reportPath+'.'+this.id+'.tmp';
    fs.writeFileSync(next,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});fs.renameSync(next,this.input.reportPath);
  }
  async stage(name,action) {
    const cleanup=['guided-preview-temporary-credential-revoked','guided-preview-production-retained'].includes(name);
    const previousCleanup=this.cleanupDeadline;if(cleanup)this.cleanupDeadline=this.now()+180000;
    const record={name,state:'running',startedAt:new Date().toISOString()};this.stages.push(record);this.report();
    try{const value=await action();record.state='passed';return value;}
    catch{record.state='failed';throw Error(name+'-failed');}
    finally{record.completedAt=new Date().toISOString();this.report();this.cleanupDeadline=previousCleanup;}
  }
  async prepare() {
    await this.stage('guided-preview-exact-accepted-controller',async()=>{
      const rows=JSON.parse(await this.inner(['inspect','system_bootstrapper_1']));
      requireValue(rows.length===1&&rows[0].Image===this.input.controllerImageId&&rows[0].State.Running===true,'guided-preview-controller-image-mismatch');
      const script="set -a; source /state/sync-auth.env; if [[ -f /state/.docker.env ]]; then source /state/.docker.env; fi; exec node -e 'process.stdout.write(JSON.stringify({user:process.env.SYNC_USER,password:process.env.SYNC_PASS,gitlab:process.env.GITLAB_EXTERNAL_URL,sync:process.env.SYNC_HOST,syncMode:process.env.SYNC_DOMAIN_MODE,syncEnabled:process.env.SYNC_ENABLE}))'";
      let selected;try{selected=JSON.parse(await this.inner(['exec','system_bootstrapper_1','bash','-ec',script]));}catch{throw Error('guided-preview-native-authentication-unavailable');}
      requireValue(selected.gitlab?.replace(/\/$/,'')===this.gitlabUrl&&selected.sync===new URL(this.url).host&&Number(selected.syncMode)>1&&selected.syncEnabled==='true'&&typeof selected.user==='string'&&typeof selected.password==='string'&&selected.user&&selected.password,'guided-preview-platform-selection-mismatch');
      this.secrets={user:selected.user,password:selected.password};
    });
  }
  async plan() {
    const before=await acceptance.production(this,true);
    const login=await this.request(this.url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:this.secrets.user,password:this.secrets.password})});
    requireValue(login.status===200,'guided-preview-sync-login-failed');const token=JSON.parse(login.body).accessToken;
    const response=await this.request(this.url+'/projects/wizard/preview-setup/preflight',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({settings:this.input.settings})});
    requireValue(response.status===200,'guided-preview-native-preflight-failed');
    const result=JSON.parse(response.body);requireValue(result.runnerReady===true&&result.productionChanged===false,'guided-preview-preflight-proof-failed');
    this.evidence.plan={productionMainSha256:before.mainSha256,productionImageId:before.runningImage,retainedPublicImage:before.publicImage,
      namespaceId:result.namespaceId,runnerReady:result.runnerReady,manualDeployment:true};
  }
}
async function main(args=process.argv.slice(2)) {
  requireValue(args.length===2&&['--check-only','--apply'].includes(args[0]),'Usage: guided-preview-live.js --check-only|--apply PRIVATE_INPUT_JSON');
  const operator=new Operator(readInput(args[1]));operator.mode=args[0].slice(2);operator.report();
  await operator.prepare();
  if(args[0]==='--check-only')await operator.stage('guided-preview-read-only-native-plan',()=>operator.plan());
  else await acceptance.run(operator);
  operator.completed=true;operator.report();return operator;
}
module.exports={Operator,readInput,requestScript,main};
if(require.main===module)main().then(()=>process.stdout.write('Native preview acceptance finished; inspect the private report.\n')).catch(()=>{process.stderr.write('Native preview acceptance failed; inspect the private report and exact owned source/Review state.\n');process.exitCode=1;});
