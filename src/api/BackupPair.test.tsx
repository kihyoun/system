import Main from './Main';
import {importedRecovery, recoveryMetadata, validSeedAssociation} from './Recovery';
import Helper from './Helper';
const association = {format:'system-backup-pair-v1',status:'matched-completed-seed',verified:true,operation:'a'.repeat(32),generation:'generation',
  manifest:'snapshots/generation/manifest.json',manifestSha256:'b'.repeat(64),completedAt:'2026-01-01T00:00:00Z',capturedAt:'2026-01-01T00:00:00Z',
  configurationFiles:[{filename:'.docker.env',sha256:'c'.repeat(64)}]};
test('old exports require manual matching and imported metadata never reasserts a Seed pair',()=>{
  expect(recoveryMetadata(Helper.textLogo).seed.verified).toBe(false);
  const main = new Main();
  main.backupSeedAssociation=association;
  const backup=main.asJson;
  expect(backup.recovery.seed.verified).toBe(true);
  main.importJson(new File([''],'backup.json'),JSON.stringify(backup));
  expect(main.asJson.recovery.seed.verified).toBe(false);
  expect(main.asJson.recovery.importedBackup.status).toBe('imported-unverified');
  expect(importedRecovery(backup.recovery).seed).toBeUndefined();
  main.backupSeedAssociation=association;
  main.importEnvData(Helper.textLogo);
  expect(main.asJson.recovery.seed.verified).toBe(false);
});
test('association rejects unsafe manifest paths and non-generation claims',()=>{
  expect(validSeedAssociation(association)).toBe(true);
  expect(validSeedAssociation({...association,manifest:'../manifest.json'})).toBe(false);
  expect(validSeedAssociation({...association,configurationFiles:[{filename:'../outside',sha256:'c'.repeat(64)}]})).toBe(false);
  expect(validSeedAssociation({...association,status:'inferred'})).toBe(false);
  expect(validSeedAssociation({...association,generation:'..',manifest:'snapshots/../manifest.json'})).toBe(false);
});
