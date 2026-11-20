import {Module,type DynamicModule} from '@nestjs/common';
import {nativeProcess,type ProcessRunner} from '../runtime/process';
import {HostInstallService} from './install';
import {HostStorageService} from './host-storage.service';
import {HostSourceService} from './source';
import {RecoveryImageService} from './recovery-images';
import {RecoveryManifestService} from './recovery-manifest';
import {RuntimeInspectionService} from './runtime-inspection';
export const HOST_PROCESS_RUNNER=Symbol('HOST_PROCESS_RUNNER');
export const HOST_ENVIRONMENT=Symbol('HOST_ENVIRONMENT');
export interface HostModuleOptions {
 runner?:ProcessRunner;
 environment?:NodeJS.ProcessEnv;
 initializationGuard?:()=>()=>void;
 rootUser?:()=>boolean;
 deadline?:number;
}
/** Shared offline-capable services for HTTP and standalone CLI contexts. */
export class HostModule {
 static register(options:HostModuleOptions={}):DynamicModule {
  const consumers=[HostStorageService,HostSourceService,RecoveryImageService,RecoveryManifestService,RuntimeInspectionService];
  return {module:HostModule,providers:[
   {provide:HOST_PROCESS_RUNNER,useValue:options.runner??nativeProcess},
   {provide:HOST_ENVIRONMENT,useValue:options.environment??process.env},
   {provide:HostInstallService,inject:[HOST_PROCESS_RUNNER,HOST_ENVIRONMENT],useFactory:(runner:ProcessRunner,environment:NodeJS.ProcessEnv)=>new HostInstallService(runner,environment,options.initializationGuard,options.rootUser,options.deadline)},
   ...consumers.map(service=>({provide:service,inject:[HostInstallService],useFactory:(host:HostInstallService)=>new service(host)})),
  ],exports:[HostInstallService,...consumers,HOST_PROCESS_RUNNER]};
 }
}
Module({})(HostModule);
