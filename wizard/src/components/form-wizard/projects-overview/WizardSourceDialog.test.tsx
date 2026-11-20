import { renderInto, unmountFrom } from '../../../testRoot';
import React from 'react';
import { act } from 'react';
import { vi } from 'vitest';
import WizardSourceDialog from './WizardSourceDialog';
test('preview is read-only; confirmation imports the previewed manifest', async () => {
    let finishImport: (value: any) => void = () => undefined;
    const projectRequest = vi.fn().mockResolvedValueOnce({
        manifestHash: 'previewed',
        sourceRevision: 'source-revision',
        fileCount: 73,
        repository: { path: 'root/wizard' }
    }).mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve; }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onClose = vi.fn();
    await act(async () => {
        renderInto(<WizardSourceDialog sync={{ projectRequest }} onClose={onClose}/>, root);
    });
    expect(projectRequest).toHaveBeenCalledTimes(1);
    expect(projectRequest).toHaveBeenCalledWith('/projects/wizard/source');
    expect(document.body.textContent).toContain('does not start a build or deploy Production');
    expect(document.body.textContent).toContain('root/wizard');
    const confirm = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Import source') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(projectRequest).toHaveBeenLastCalledWith('/projects/wizard/source', { manifestHash: 'previewed' });
    const close = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Close') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishImport({ message: 'Pinned Wizard source imported.' }); });
    expect(close.disabled).toBe(false);
    expect(document.body.textContent).toContain('Pinned Wizard source imported.');
    expect(document.body.textContent).not.toContain('Import source');
    act(() => { unmountFrom(root); });
    root.remove();
});
test('pending read-only preview can close and ignores its late response', async () => {
    let finishPreview: (value: any) => void = () => undefined;
    const projectRequest = vi.fn(() => new Promise(resolve => { finishPreview = resolve; }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onClose = vi.fn(() => { unmountFrom(root); });
    await act(async () => {
        renderInto(<WizardSourceDialog sync={{ projectRequest }} onClose={onClose}/>, root);
    });
    const close = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Close') as HTMLButtonElement;
    const confirm = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Import source') as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    expect(confirm.disabled).toBe(true);
    act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        await act(async () => { finishPreview({ repository: { path: 'late-result' } }); });
        expect(document.body.textContent).not.toContain('late-result');
        expect(errors).not.toHaveBeenCalled();
        expect(projectRequest).toHaveBeenCalledTimes(1);
    }
    finally {
        errors.mockRestore();
        root.remove();
    }
});
test('failed preview cannot enable import and exposes the actionable safe error', async () => {
    const data = { message: 'Snapshot is missing. Rebuild the System image.' };
    const projectRequest = vi.fn().mockRejectedValue({ response: { data } });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => {
        renderInto(<WizardSourceDialog sync={{ projectRequest }} onClose={vi.fn()}/>, root);
    });
    expect(document.body.textContent).toContain('Snapshot is missing');
    const confirm = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Import source') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(projectRequest).toHaveBeenCalledTimes(1);
    act(() => { unmountFrom(root); });
    root.remove();
});
test('a source-primary preview opens the canonical repository without offering source import', async () => {
    const projectRequest = vi.fn().mockResolvedValue({
        mode: 'source-primary', canInitialize: false, sourceRevision: 'reviewed-source',
        repository: {path: 'team/wizard', webUrl: 'https://gitlab.example.test/team/wizard'}
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
        await act(async () => { renderInto(<WizardSourceDialog sync={{projectRequest}} onClose={vi.fn()}/>, root); });
        expect(document.body.textContent).toContain('No source import or extra repository is required');
        expect(document.body.textContent).not.toContain('Import source');
        expect(document.body.textContent).not.toContain('Files:');
        expect(document.body.querySelector('a')?.getAttribute('href')).toBe('https://gitlab.example.test/team/wizard');
        expect(projectRequest.mock.calls).toEqual([['/projects/wizard/source']]);
    } finally { act(() => { unmountFrom(root); }); root.remove(); }
});
