import path from 'node:path';
import {HostInstallService,requireValue} from './install';
import {canonicalDigest,type RecoveryManifest} from './recovery-manifest';
import {record} from '../release/source-identity';
interface Inspection {Id:string;RepoDigests?:string[]}
const docker=['--host=unix:///var/run/docker.sock'];
export class RecoveryImageService {
 constructor(readonly host=new HostInstallService()){}
 inspect(reference:string):Inspection {
  const rows:unknown=JSON.parse(this.host.run('docker',[...docker,'image','inspect',reference]));
  requireValue(Array.isArray(rows)&&rows.length===1,'unexpected-image-inspection');record(rows[0]);return rows[0] as Inspection;
 }
 restore(directory:string,manifest:RecoveryManifest):void {
  for(const archive of manifest.archives) {
   // Docker natively streams compressed save archives; no second uncompressed
   // archive is materialized and no shell pipeline can outlive the bounded call.
   this.host.run('docker',[...docker,'load','--input',path.join(directory,archive.file)],undefined,900000);
   requireValue(this.inspect(archive.imageId).Id===archive.imageId,'loaded-image-id-mismatch');
  }
  for(const image of manifest.localImages) {
   this.host.run('docker',[...docker,'tag',image.imageId!,image.tag]);
   requireValue(this.inspect(image.tag).Id===image.imageId,'local-image-alias-mismatch');
  }
  for(const image of manifest.publicImages) {
   let loaded:Inspection;
   try{loaded=this.inspect(image.reference!);}catch{this.host.run('docker',[...docker,'pull',image.reference!]);loaded=this.inspect(image.reference!);}
   requireValue(loaded.RepoDigests?.includes(canonicalDigest(image.reference!)),'public-image-digest-mismatch');
   if(image.imageId)requireValue(loaded.Id===image.imageId,'public-image-id-mismatch');
   this.host.run('docker',[...docker,'tag',image.reference!,image.tag]);
  }
 }
}
