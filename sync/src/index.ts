import { bootstrap } from './bootstrap';
export { bootstrap, createSyncApplication } from './bootstrap';

if (require.main === module) {
  void bootstrap().catch(() => {
    console.error('Sync could not start. Inspect the protected service logs.');
    process.exitCode = 1;
  });
}
