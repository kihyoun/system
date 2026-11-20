import React from 'react';
import {act} from 'react';
import {vi} from 'vitest';
import {renderInto, unmountFrom} from '../../testRoot';
import SystemDiagnosticsDialog from './SystemDiagnosticsDialog';
const targets = {registry: 'https://registry.example.test:5443', helper: 'https://registry.gitlab.com', helperImage: 'registry.gitlab.com/helper@sha256:fixture', runners: ['runner_docker_1'], context: 'Sync controller network'};
let root: HTMLDivElement;
beforeEach(() => {root = document.createElement('div'); document.body.appendChild(root);});
afterEach(() => {act(() => unmountFrom(root)); root.remove();});
function button(label: string) {return Array.from(document.querySelectorAll('button')).find(element => element.textContent === label) as HTMLButtonElement;}
async function click(label: string) {await act(async () => {button(label).dispatchEvent(new MouseEvent('click', {bubbles: true}));});}
test('opening loads configured metadata only; connection and pull require separate clicks', async () => {
    const loadTargets = vi.fn().mockResolvedValue(targets);
    const checkConnection = vi.fn().mockResolvedValue({target: targets.registry, context: targets.context, steps: [{name: 'DNS', status: 'failed', durationMs: 12, code: 'ENOTFOUND', detail: 'No DNS address'}, {name: 'TCP', status: 'not-checked', durationMs: 0, code: 'DEPENDENCY_FAILED', detail: 'Skipped'}]});
    const tryHelperPull = vi.fn().mockResolvedValue({runner: 'runner_docker_1', image: targets.helperImage, context: 'Actual selected daemon', authentication: 'Anonymous', durationMs: 100, success: false, code: 'PULL_FAILED', detail: 'Image pull failed'});
    await act(async () => renderInto(<SystemDiagnosticsDialog open onClose={vi.fn()} loadTargets={loadTargets} checkConnection={checkConnection} tryHelperPull={tryHelperPull}/>, root));
    expect(loadTargets).toHaveBeenCalledTimes(1); expect(checkConnection).not.toHaveBeenCalled(); expect(tryHelperPull).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('may download layers'); expect(document.body.textContent).toContain('disk/cache space');
    await click('Check connection'); expect(checkConnection).toHaveBeenCalledWith('registry'); expect(tryHelperPull).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('ENOTFOUND'); expect(document.body.textContent).toContain('not-checked'); expect(document.body.textContent).toContain('12 ms');
    await click('Try helper-image pull'); expect(tryHelperPull).toHaveBeenCalledWith('runner_docker_1');
    expect(document.body.textContent).toContain('Actual selected daemon'); expect(document.body.textContent).toContain('PULL_FAILED');
});
test('no runner disables pull while controller check remains available', async () => {
    await act(async () => renderInto(<SystemDiagnosticsDialog open onClose={vi.fn()} loadTargets={async () => ({...targets, runners: []})} checkConnection={vi.fn()} tryHelperPull={vi.fn()}/>, root));
    expect(button('Try helper-image pull').disabled).toBe(true); expect(button('Check connection').disabled).toBe(false);
});
test('busy operation disables duplicate actions; raw server error is never rendered', async () => {
    let reject: (error: Error) => void = () => undefined;
    const checkConnection = vi.fn().mockImplementation(() => new Promise((_resolve, rejectResult) => {reject = rejectResult;}));
    await act(async () => renderInto(<SystemDiagnosticsDialog open onClose={vi.fn()} loadTargets={async () => targets} checkConnection={checkConnection} tryHelperPull={vi.fn()}/>, root));
    await click('Check connection'); expect(button('Try helper-image pull').disabled).toBe(true); expect(button('Close').disabled).toBe(true);
    await act(async () => reject(Error('token=must-not-leak')));
    expect(document.body.textContent).not.toContain('must-not-leak'); expect(document.body.textContent).toContain('Diagnostics are unavailable'); expect(button('Close').disabled).toBe(false);
});
test('closing clears results and stale asynchronous metadata cannot populate a reopened dialog', async () => {
    let finish: (value: typeof targets) => void = () => undefined;
    const loadTargets = vi.fn().mockImplementationOnce(() => new Promise(resolve => {finish = resolve;})).mockResolvedValueOnce({...targets, registry: 'https://new.example.test'});
    const props = {onClose: vi.fn(), loadTargets, checkConnection: vi.fn(), tryHelperPull: vi.fn()};
    await act(async () => renderInto(<SystemDiagnosticsDialog {...props} open/>, root));
    await act(async () => renderInto(<SystemDiagnosticsDialog {...props} open={false}/>, root));
    await act(async () => renderInto(<SystemDiagnosticsDialog {...props} open/>, root));
    await act(async () => finish(targets));
    expect(document.body.textContent).toContain('https://new.example.test'); expect(document.body.textContent).not.toContain(targets.registry);
});
