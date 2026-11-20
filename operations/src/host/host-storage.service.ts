import fs from 'node:fs';
import path from 'node:path';
import {HostInstallService,privateFile,requireValue} from './install';
export interface HostStorageCommand {operation:'harvest'|'restore';image:string;checkout:string;persistenceEnv:string;configurationBackup?:string;checkOnly?:boolean}
/** Host launch boundary: the accepted image owns leases and storage mutations. */
export class HostStorageService {
 constructor(readonly host:HostInstallService){}
 execute(command:HostStorageCommand):string {
  requireValue(this.host.rootUser(),'host-storage-requires-root');
  requireValue(command.operation==='harvest'||command.operation==='restore','invalid-host-storage-operation');
  requireValue(command.image&&!command.image.startsWith('-')&&!/[\0\r\n]/.test(command.image),'accepted-controller-image-required');
  requireValue(path.isAbsolute(command.checkout)&&fs.statSync(command.checkout).isDirectory(),'explicit-host-checkout-required');
  privateFile(command.persistenceEnv);
  const {selected}=this.host.storage(command.persistenceEnv,command.checkout);
  if(!command.checkOnly)this.host.run('bash',[path.join(command.checkout,'bootstrapper/persistence.sh')],{...this.host.environment,...selected});
  const id=this.host.run('docker',['--host=unix:///var/run/docker.sock','image','inspect','--format','{{.Id}}',command.image]).trim();
  requireValue(/^sha256:[a-f0-9]{64}$/.test(id),'accepted-controller-image-id-required');
  const backup=command.configurationBackup??'';
  if(backup){const stat=fs.lstatSync(backup);requireValue(command.operation==='restore'&&path.isAbsolute(backup)&&stat.isFile()&&!stat.isSymbolicLink(),'invalid-configuration-backup');}
  return this.host.run('docker',['--host=unix:///var/run/docker.sock','run','--rm','--network','none','--entrypoint','node',
   '--mount','type=bind,src=/,dst=/host,readonly','--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
   '--env',`PERSISTENCE_ENV_FILE=${command.persistenceEnv}`,'--env',`SYSTEM_SEED_CONTROLLER_IMAGE=${id}`,
   '--env',`SYSTEM_SEED_CONFIGURATION_BACKUP=${backup}`,id,'/system/system/seed-operation.js','host',command.operation,...(command.checkOnly?['--check-only']:[])]);
 }
}
