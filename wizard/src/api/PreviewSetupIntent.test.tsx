import JSZip from 'jszip';
import Main from './Main';
import {newPreviewSetupIntent, previewSetupIntent} from './PreviewSetupIntent';
const desired = () => ({...newPreviewSetupIntent(), namespace: 'example', wizard: {mode: 'import' as const, project: 'wizard-fork', origin: 'https://example.test/wizard.git'}});
test('desired settings round-trip through JSON and ZIP as inert data without instance identities', async () => {
  const main = new Main(); main.previewSetup = desired();
  const request = vi.spyOn(main.sync, 'projectRequest');
  const json = main.asJson;
  expect(json.previewSetup).toEqual(desired());
  const imported = new Main();
  const importedRequest = vi.spyOn(imported.sync, 'projectRequest');
  imported.importJson(new File([], 'bootstrapper.json'), JSON.stringify(json));
  expect(imported.previewSetup).toEqual(desired());
  expect(request).not.toHaveBeenCalled(); expect(importedRequest).not.toHaveBeenCalled();
  const zip = await JSZip.loadAsync(await (await imported.generateZip()).arrayBuffer());
  expect(JSON.parse(await zip.file('bootstrapper.json')!.async('string')).previewSetup).toEqual(desired());
});
test('legacy backups remain usable and untrusted credentials or live receipts cannot enter portable intent', () => {
  const main = new Main();
  const legacy: any = main.asJson; delete legacy.previewSetup;
  main.previewSetup = desired(); main.importJson(new File([], 'old.json'), JSON.stringify(legacy));
  expect(main.previewSetup).toBeNull();
  for (const patch of [{token: 'secret'}, {projectId: 42}, {pipeline: {id: 100}}, {version: 99}]) expect(previewSetupIntent({...desired(), ...patch})).toBeNull();
  expect(previewSetupIntent({...desired(), wizard: {...desired().wizard, origin: 'https://user:secret@example.test/fork.git'}})).toBeNull();
});
