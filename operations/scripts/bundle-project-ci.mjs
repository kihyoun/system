import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const noticeText=value=>value.replace(/\r\n/g,'\n').replace(/[\t ]+$/gm,'').trim();
const require=createRequire(path.join(root,'wizard/package.json'));
const entry=require.resolve('rolldown');
const metadata=JSON.parse(fs.readFileSync(path.resolve(path.dirname(entry),'../package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'wizard/package-lock.json'),'utf8'));
if(metadata.version!==lock.packages['node_modules/rolldown'].version)throw Error('Pinned Wizard bundler required');
const {rolldown}=await import(pathToFileURL(entry).href);
const optional=['@nestjs/microservices','@nestjs/microservices/microservices-module.js','@nestjs/websockets/socket-module.js','@nestjs/platform-express','class-validator','class-transformer'];
const bundle=await rolldown({cwd:root,input:'operations/dist/project-ci/portable-entry.js',platform:'node',resolve:{symlinks:false},external:optional,onwarn(warning){throw Error(warning.message);}});
try{
 const {output}=await bundle.generate({format:'cjs',codeSplitting:false,comments:{legal:true},minify:false});
 if(output.length!==1||output[0].type!=='chunk')throw Error('Expected one portable runtime');
 const licenses=new Map();
 for(const id of Object.keys(output[0].modules)){
   if(!id.includes('/node_modules/'))continue;
   let directory=path.dirname(id);
   while(!fs.existsSync(path.join(directory,'package.json'))){const parent=path.dirname(directory);if(parent===directory)throw Error('Missing bundled dependency metadata');directory=parent;}
   const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
   const license=['LICENSE','LICENSE.md','LICENSE.txt','license','license.md'].find(name=>fs.existsSync(path.join(directory,name)));
   if(!license)throw Error('Missing bundled dependency license: '+pkg.name);
   licenses.set(pkg.name+'@'+pkg.version,noticeText(fs.readFileSync(path.join(directory,license),'utf8')));
 }
 const notices='Bundled project CI runtime licenses\n\nSystem Bootstrapper\n'+noticeText(fs.readFileSync(path.join(root,'LICENSE'),'utf8'))+'\n\n'+[...licenses].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,license])=>name+'\n'+license).join('\n\n')+'\n';
 const content='// Generated from compiled shared operations; run operations/scripts/bundle-project-ci.mjs.\n'+output[0].code.replace(/^[\t ]+$/gm,'');
 const file=path.join(root,'wizard/.gitlab/runtime/project-ci.cjs');
 const noticeFile=path.join(path.dirname(file),'LICENSES.txt');
 const recipeRuntime=path.join(root,'project-bootstrap/wizard-build/typed-v6/runtime');
 const sourceRecipeRuntime=path.join(root,'wizard/.system-bootstrapper/build-v2/runtime');
 const producerFile=path.join(root,'wizard/.gitlab/producer-v2.json');
 const producer=JSON.stringify({version:2,runtime:'.gitlab/runtime/project-ci.cjs',runtimeSha256:crypto.createHash('sha256').update(content).digest('hex'),buildProfile:'node24-vite8-typed-v6'},null,2)+'\n';
 const outputs=[[file,content],[noticeFile,notices],[producerFile,producer],...[recipeRuntime,sourceRecipeRuntime].flatMap(directory=>[[path.join(directory,'project-ci.cjs'),content],[path.join(directory,'LICENSES.txt'),notices]])];
 if(process.argv.includes('--check')){if(outputs.some(([name,value])=>fs.readFileSync(name,'utf8')!==value))throw Error('Portable project CI runtime differs from compiled operations');console.log('Portable project CI runtime matches compiled operations.');}
 else{for(const [name,value] of outputs){fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,value);}console.log('Bundled shared project CI runtime.');}
}finally{await bundle.close();}
