import {act} from 'react';
import {vi} from 'vitest';
import {renderInto,unmountFrom} from '../../../testRoot';
import BackupWorkflowDialog from './BackupWorkflowDialog';
const button=(label:string)=>Array.from(document.body.querySelectorAll('button')).find(element=>element.textContent===label)!;
const click=async(label:string)=>act(async()=>{button(label).dispatchEvent(new MouseEvent('click',{bubbles:true}));});
let root:HTMLDivElement;
beforeEach(()=>{sessionStorage.clear();root=document.createElement('div');document.body.appendChild(root);});
afterEach(()=>{act(()=>unmountFrom(root));root.remove();});
test('one explicit action reports partial completion without a ZIP success claim',async()=>{
  const diagnosticRequest=vi.fn().mockResolvedValue({id:'a'.repeat(32),state:'partial',seed:{manifest:'snapshots/new/manifest.json'},configuration:{status:'unavailable'}});
  await act(async()=>renderInto(<BackupWorkflowDialog sync={{diagnosticRequest}} onClose={()=>undefined}/>,root));
  expect(diagnosticRequest).not.toHaveBeenCalled();
  await click('Back up Seed and configuration');
  expect(diagnosticRequest).toHaveBeenCalledWith('/command/backup',{});
  expect(document.body.textContent).toContain('Partially completed');
  expect(document.body.textContent).toContain('snapshots/new');
  expect(document.body.textContent).not.toContain('Download configuration ZIP');
  expect(document.body.textContent).not.toContain('downloaded configuration are saved');
});
test('failed browser download retains retry action and cannot confirm completed pair',async()=>{
  const diagnosticRequest=vi.fn().mockResolvedValue({id:'a'.repeat(32),state:'ready',seed:{manifest:'snapshots/new/manifest.json'},configuration:{status:'ready',sha256:'b'.repeat(64)}});
  const downloadBackup=vi.fn().mockRejectedValue(Error('network'));
  await act(async()=>renderInto(<BackupWorkflowDialog sync={{diagnosticRequest,downloadBackup}} onClose={()=>undefined}/>,root));
  await click('Back up Seed and configuration');await click('Download configuration ZIP');
  expect(document.body.textContent).toContain('Download failed');
  expect(button('Download configuration ZIP')).toBeDefined();
  expect(document.body.textContent).not.toContain('ZIP stored safely');
});
