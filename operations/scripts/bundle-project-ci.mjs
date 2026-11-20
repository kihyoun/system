import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
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
   licenses.set(pkg.name+'@'+pkg.version,fs.readFileSync(path.join(directory,license),'utf8').trim());
 }
 const notices='Bundled project CI runtime licenses\n\nSystem Bootstrapper\n'+fs.readFileSync(path.join(root,'LICENSE'),'utf8').trim()+'\n\n'+[...licenses].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,license])=>name+'\n'+license).join('\n\n')+'\n';
 const content='// Generated from compiled shared operations; run operations/scripts/bundle-project-ci.mjs.\n'+output[0].code;
 const file=path.join(root,'wizard/.gitlab/runtime/project-ci.cjs');
 const noticeFile=path.join(path.dirname(file),'LICENSES.txt');
 if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==content||fs.readFileSync(noticeFile,'utf8')!==notices)throw Error('Portable project CI runtime differs from compiled operations');console.log('Portable project CI runtime matches compiled operations.');}
 else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);fs.writeFileSync(noticeFile,notices);console.log('Bundled shared project CI runtime.');}
}finally{await bundle.close();}
