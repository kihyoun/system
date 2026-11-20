import fs from 'node:fs';
import path from 'node:path';
import {HostInstallService,reference,sourceIdentity,checkedImage,acceptedMetadata,fresh,writePrivate,privateFile,type InstallOptions} from './install';

/** Fixed compatibility RPC for remaining Python consumers; never evaluates code. */
export function compatibility(input: {operation: string; arguments: unknown[]}) {
  const args=input.arguments;
  switch(input.operation) {
    case 'reference':return reference(args[0]);
    case 'sourceIdentity':return sourceIdentity(String(args[0]),String(args[1]),String(args[2]));
    case 'checkedImage':return checkedImage(String(args[0]),args[1] as Parameters<typeof checkedImage>[1],args[2],args[3]===true);
    case 'acceptedMetadata':return acceptedMetadata(args[0]?String(args[0]):undefined,args[1] as Parameters<typeof acceptedMetadata>[1],String(args[2]),String(args[3]));
    case 'fresh':return fresh(String(args[0]),String(args[1]));
    case 'privateFile':return privateFile(String(args[0]));
    case 'writePrivate':return writePrivate(String(args[0]),Buffer.from(String(args[1]),'base64'));
    case 'source':return new HostInstallService().source(String(args[0]));
    case 'storage':return new HostInstallService().storage(String(args[0]),String(args[1]));
    case 'noExistingServices':return new HostInstallService().noExistingServices();
    case 'install':return new HostInstallService().install(args[0] as InstallOptions,String(args[1]));
    default:throw Error('unknown-host-operation');
  }
}
export function installArguments(argv: string[]): InstallOptions {
  const result: InstallOptions={controller:'',wizard:'',persistenceEnv:'/etc/system-bootstrapper/persistence.env'};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(key==='--install-host'){result.installHost=true;continue;}
    const mapped={'--controller':'controller','--wizard':'wizard','--persistence-env':'persistenceEnv','--release-metadata':'releaseMetadata'}[key];
    if(!mapped||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('invalid-install-arguments');
    result[mapped as 'controller'|'wizard'|'persistenceEnv'|'releaseMetadata']=argv[++i];
  }
  reference(result.controller);reference(result.wizard);return result;
}
if(require.main===module) {
  try {
    if(process.argv[2]==='--compatibility') {
      const result=compatibility(JSON.parse(fs.readFileSync(0,'utf8')));
      process.stdout.write(JSON.stringify({value:result??null})+'\n');
    }else if(process.argv.includes('--help')) {
      process.stdout.write('install-release --controller IMAGE@sha256:DIGEST --wizard IMAGE@sha256:DIGEST [--persistence-env FILE] [--release-metadata FILE] [--install-host]\n');
    }else {
      new HostInstallService().install(installArguments(process.argv.slice(2)),path.resolve(__dirname,'../../..'));
      process.stdout.write('Public release startup requested. Complete first setup in the Wizard; service readiness is separate.\n');
    }
  }catch(error) {
    const code=error instanceof Error&&/^[a-z][a-z0-9:-]+$/.test(error.message)?error.message:'invalid-private-input-or-filesystem';
    if(process.argv[2]==='--compatibility')process.stdout.write(JSON.stringify({error:code})+'\n');
    else process.stderr.write('Public release installation: '+code+'\n');
    process.exitCode=1;
  }
}
