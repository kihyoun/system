const cp=require('child_process');
const root='C:/Users/kihyo/Documents/Codex/2026-10-16/kja/work/component-test-ci';
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const changes=git('diff','--cached','--name-status','--no-renames').trim().split('\n').map(line=>line.split('\t'));
const elements=changes.map(([status,file])=>status==='D'?{path:file,mode:'100644',type:'blob',sha:null}:{path:file,mode:git('ls-files','-s','--',file).split(' ')[0],type:'blob',content:git('show',':'+file)});
process.stdout.write(JSON.stringify({baseTree:git('rev-parse','HEAD^{tree}').trim(),parent:git('rev-parse','HEAD').trim(),elements}));
