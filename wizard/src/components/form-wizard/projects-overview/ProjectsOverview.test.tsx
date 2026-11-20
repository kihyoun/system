import { renderInto, unmountFrom } from '../../../testRoot';
import React from 'react';
import { act } from 'react';
import { vi } from 'vitest';
import Main from '../../../api/Main';
import ProjectConfig from '../../../api/ProjectConfig';
import ProjectsOverview from './ProjectsOverview';
import { runInAction } from 'mobx';
// The export dialog's ESM syntax-highlighter is unrelated to this table behavior.
vi.mock('../dialog/DownloadReactCiDialog', () => ({ default: () => null }));
test('the managed Wizard appears first with its actual URL and cannot be edited or deleted here', () => {
    const main = new Main();
    main.projects.set('example', new ProjectConfig(main, { projectKey: 'example' }));
    const project = new ProjectConfig(main, {
        projectKey: 'wizard',
        template: 'wizard',
        useProdHost: 'true',
        prodHost: 'localhost',
        prodDomainMode: 0,
        useBetaHost: 'false',
        useReviewHost: 'false',
        repository: {
            systemProject: true,
            template: 'wizard',
            webUrl: 'http://gitlab.localhost/root/wizard',
            generatedCi: 'scaffold'
        }
    });
    main.projects.set('wizard', project);
    const root = document.createElement('div');
    document.body.appendChild(root);
    act(() => { renderInto(<ProjectsOverview main={main}/>, root); });
    const row = root.querySelector('tbody tr')!;
    expect(row.textContent).toContain('wizard · System interface');
    expect(row.textContent).toContain('http://localhost');
    expect((row.querySelector('[aria-label="edit"]') as HTMLButtonElement).disabled).toBe(true);
    expect((row.querySelector('[aria-label="delete"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(root.textContent).toContain('Existing Wizard interface');
    expect(root.textContent).toContain('Configure Beta and Review separately');
    const copy = new Main();
    copy.importProjectEnvData(project.content);
    expect(copy.projects.get('wizard')!.repository.systemProject).toBe(true);
    expect(copy.projects.get('wizard')!.gitlabCi).toBe('scaffold');
    act(() => { unmountFrom(root); });
    root.remove();
});
test('the managed row offers environment setup only while connected and opens a read-only preview', async () => {
    const main = new Main();
    main.projects.set('wizard', new ProjectConfig(main, {
        projectKey: 'wizard',
        template: 'wizard',
        useProdHost: 'true',
        prodHost: 'system-bootstrapper.com',
        prodDomainMode: 2,
        useBetaHost: 'false',
        useReviewHost: 'false',
        repository: {
            systemProject: true,
            template: 'wizard',
            webUrl: 'https://gitlab.system-bootstrapper.com/root/wizard'
        }
    }));
    const disabled = {
        enabled: false,
        host: '',
        domainMode: 2,
        ssl: '',
        sslKey: ''
    };
    const request = vi.spyOn(main.sync, 'projectRequest').mockResolvedValue({
        previewHash: 'environment-context',
        settingsHash: 'disabled-settings',
        settings: {
            review: disabled,
            beta: disabled
        },
        capabilities: {
            canActivate: false,
            canUpdate: false,
            reasons: ['Verify the imported candidate first.'],
            reviewLease: 'single-active-mr',
            manualJobsOnly: true,
            productionDeployment: false
        }
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
        await act(async () => { renderInto(<ProjectsOverview main={main}/>, root); });
        const row = root.querySelector('tbody tr');
        if (!row)
            throw new Error('Managed Wizard row is missing');
        await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        const find = (label: string) => Array.from(document.body.querySelectorAll('button'))
            .find(element => element.textContent === label) as HTMLButtonElement;
        expect(find('Configure Review and Beta').disabled).toBe(true);
        expect(find('Initialize Wizard source')).toBeTruthy();
        expect(find('Build and verify Wizard')).toBeTruthy();
        expect(request).not.toHaveBeenCalled();
        act(() => { runInAction(() => { main.sync.connected = true; }); });
        expect(find('Configure Review and Beta').disabled).toBe(false);
        await act(async () => {
            find('Configure Review and Beta').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(request.mock.calls).toEqual([['/projects/wizard/environments']]);
        expect(document.body.textContent).toContain('Verify the imported candidate first.');
        expect(find('Enable environments').disabled).toBe(true);
        await act(async () => { find('Close').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(request).toHaveBeenCalledTimes(1);
        expect((row.querySelector('[aria-label="edit"]') as HTMLButtonElement).disabled).toBe(true);
        expect((row.querySelector('[aria-label="delete"]') as HTMLButtonElement).disabled).toBe(true);
    }
    finally {
        act(() => { unmountFrom(root); });
        root.remove();
        request.mockRestore();
    }
});
test('the canonical source-primary row offers source and native status instead of import or activation', () => {
    const main = new Main();
    const project = new ProjectConfig(main, {
        projectKey: 'wizard', template: 'wizard', prodHost: 'wizard.example.test',
        repository: {systemProject: true, managementMode: 'source-primary', path: 'team/wizard',
            webUrl: 'https://gitlab.example.test/team/wizard', pipelineUrl: 'https://gitlab.example.test/team/wizard/-/pipelines'}
    });
    main.projects.set('wizard', project);
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
        act(() => { renderInto(<ProjectsOverview main={main}/>, root); });
        const row = root.querySelector('tbody tr')!;
        act(() => { row.dispatchEvent(new MouseEvent('click', {bubbles: true})); });
        expect(root.textContent).toContain('Canonical Wizard repository');
        expect(root.textContent).toContain('Wizard source');
        expect(root.textContent).toContain('Native build status');
        expect(root.textContent).not.toContain('Initialize Wizard source');
        expect(root.textContent).not.toContain('Build and verify Wizard');
        const restored = new Main();
        restored.importProjectEnvData(project.content);
        expect(restored.projects.get('wizard')!.repository.managementMode).toBe('source-primary');
    } finally { act(() => { unmountFrom(root); }); root.remove(); }
});
