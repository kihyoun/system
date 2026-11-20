import { vi } from 'vitest';
import { renderInto, unmountFrom } from '../../../testRoot';
import React from 'react';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';
import WizardEnvironmentsDialog from './WizardEnvironmentsDialog';
const route = '/projects/wizard/environments';
const settings = {
    review: {
        enabled: false,
        host: 'review.system-bootstrapper.com',
        domainMode: 2,
        ssl: '/ssl/live/review.system-bootstrapper.com/fullchain.pem',
        sslKey: '/ssl/live/review.system-bootstrapper.com/privkey.pem'
    },
    beta: {
        enabled: false,
        host: 'beta.system-bootstrapper.com',
        domainMode: 2,
        ssl: '/ssl/live/beta.system-bootstrapper.com/fullchain.pem',
        sslKey: '/ssl/live/beta.system-bootstrapper.com/privkey.pem'
    }
};
const preview = {
    version: 1,
    previewHash: 'context-before-edit',
    settingsHash: 'server-settings',
    settings,
    capabilities: {
        canActivate: true,
        canUpdate: false,
        reasons: [],
        reviewLease: 'single-active-mr',
        manualJobsOnly: true,
        productionDeployment: false
    }
};
const button = (label: string) => Array.from(document.body.querySelectorAll('button'))
    .find(element => element.textContent === label) as HTMLButtonElement | undefined;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const checkbox = (name: string) => document.body.querySelector('[aria-label="Enable ' + name + '"]') as HTMLInputElement;
const click = async (label: string) => {
    const element = button(label);
    if (!element)
        throw new Error('Missing button: ' + label);
    await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const change = (id: string, value: string) => act(() => { fireEvent.change(input(id), { target: { value } } as any); });
const enable = (name: string, checked: boolean) => act(() => {
    if (checkbox(name).checked !== checked) fireEvent.click(checkbox(name));
});
let root: HTMLDivElement;
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
afterEach(() => { act(() => { unmountFrom(root); }); root.remove(); });
const render = async (projectRequest: any, onClose: any = vi.fn()) => {
    await act(async () => {
        renderInto(<WizardEnvironmentsDialog sync={{ projectRequest }} onClose={onClose}/>, root);
    });
};
test('opening is read-only; confirmation preserves disabled Beta and uses exact preview, HTTPS settings and paths', async () => {
    let finish: (value: any) => void = () => undefined;
    const projectRequest = vi.fn().mockResolvedValueOnce(preview)
        .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    await render(projectRequest, onClose);
    expect(projectRequest.mock.calls).toEqual([[route]]);
    expect(checkbox('Review').checked).toBe(false);
    expect(checkbox('Beta').checked).toBe(false);
    expect(input('wizard-review-host').disabled).toBe(true);
    expect(document.body.textContent).toContain('one active merge request at a time');
    expect(document.body.textContent).toContain('manual deploy and stop jobs');
    enable('Review', true);
    const expected = {
        review: {
            ...settings.review,
            enabled: true
        },
        beta: settings.beta
    };
    await click('Enable environments');
    expect(projectRequest).toHaveBeenLastCalledWith(route, {
        previewHash: 'context-before-edit',
        settings: expected
    });
    expect(button('Close')?.disabled).toBe(true);
    await click('Close');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
        finish({
            environments: {
                phase: 'ready',
                settings: expected
            },
            message: 'Recipe verified.'
        });
    });
    expect(button('Close')?.disabled).toBe(false);
    expect(document.body.textContent).toContain('Recipe verified.');
    expect(button('Update environments')?.disabled).toBe(true);
    expect(projectRequest.mock.calls.some(call => /deploy|production|pipeline/.test(call[0]))).toBe(false);
});
test('a ready inactive recipe can update only changed settings from a fresh allowed preview', async () => {
    const current = {
        review: {
            ...settings.review,
            enabled: true
        },
        beta: settings.beta
    };
    const ready = {
        ...preview,
        settings: current,
        environments: {
            phase: 'ready',
            settings: current
        },
        capabilities: {
            ...preview.capabilities,
            canActivate: false,
            canUpdate: true
        }
    };
    const projectRequest = vi.fn().mockResolvedValueOnce(ready)
        .mockResolvedValueOnce({
        environments: { phase: 'ready' },
        message: 'Updated safely.'
    });
    await render(projectRequest);
    expect(button('Update environments')?.disabled).toBe(true);
    expect(input('wizard-review-host').disabled).toBe(false);
    change('wizard-review-host', 'review2.system-bootstrapper.com');
    change('wizard-review-ssl', '/ssl/review2/fullchain.pem');
    change('wizard-review-ssl-key', '/ssl/review2/privkey.pem');
    expect(button('Update environments')?.disabled).toBe(false);
    await click('Update environments');
    expect(projectRequest).toHaveBeenLastCalledWith(route, {
        previewHash: preview.previewHash,
        settings: {
            review: {
                ...current.review,
                host: 'review2.system-bootstrapper.com',
                ssl: '/ssl/review2/fullchain.pem',
                sslKey: '/ssl/review2/privkey.pem'
            },
            beta: settings.beta
        }
    });
});
test('active resources freeze settings and expose the server ownership/stop reason', async () => {
    const reason = 'Review is owned by MR 8. Stop it in GitLab before changing hosts.';
    const projectRequest = vi.fn().mockResolvedValue({
        ...preview,
        environments: { phase: 'ready' },
        capabilities: {
            ...preview.capabilities,
            canActivate: false,
            reasons: [reason]
        }
    });
    await render(projectRequest);
    expect(checkbox('Review').disabled).toBe(true);
    expect(button('Update environments')?.disabled).toBe(true);
    expect(document.body.textContent).toContain(reason);
    expect(projectRequest).toHaveBeenCalledTimes(1);
});
test('pending setup preserves settings and requires fresh preview after status before explicit resume', async () => {
    const pending = {
        ...preview,
        environments: {
            phase: 'pending',
            settings
        }
    };
    const projectRequest = vi.fn().mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({
        environments: {
            phase: 'recipe-installed',
            settings
        }
    })
        .mockResolvedValueOnce(pending).mockResolvedValueOnce({
        environments: {
            phase: 'ready',
            settings
        }
    });
    await render(projectRequest);
    expect(checkbox('Review').disabled).toBe(true);
    expect(button('Resume environment setup')?.disabled).toBe(false);
    await click('Refresh status');
    expect(projectRequest).toHaveBeenLastCalledWith(route + '/status');
    expect(button('Resume environment setup')?.disabled).toBe(true);
    await click('Refresh preview');
    expect(button('Resume environment setup')?.disabled).toBe(false);
    await click('Resume environment setup');
    expect(projectRequest).toHaveBeenLastCalledWith(route, {
        previewHash: preview.previewHash,
        settings
    });
    expect(projectRequest.mock.calls.filter(call => call[1])).toHaveLength(1);
});
test('an uncertain POST cannot retry through preview alone; status and then a fresh preview are required', async () => {
    const pending = {
        ...preview,
        environments: {
            phase: 'recipe-installed',
            settings
        }
    };
    const projectRequest = vi.fn().mockResolvedValueOnce(preview)
        .mockRejectedValueOnce(new Error('Connection lost after update.'))
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({
        environments: {
            phase: 'recipe-installed',
            settings
        }
    })
        .mockResolvedValueOnce(pending);
    await render(projectRequest);
    await click('Enable environments');
    expect(document.body.textContent).toContain('Connection lost after update.');
    expect(document.body.textContent).toContain('Do not retry an uncertain write');
    expect(button('Enable environments')?.disabled).toBe(true);
    await click('Refresh preview');
    expect(button('Resume environment setup')?.disabled).toBe(true);
    await click('Refresh status');
    expect(button('Resume environment setup')?.disabled).toBe(true);
    await click('Refresh preview');
    expect(button('Resume environment setup')?.disabled).toBe(false);
    expect(projectRequest.mock.calls.filter(call => call[1])).toHaveLength(1);
});
test('reconciliation stays refresh-only even if fresh preview activation capability is inconsistent', async () => {
    const uncertain = {
        ...preview,
        environments: {
            phase: 'requires-reconciliation',
            settings
        }
    };
    const projectRequest = vi.fn().mockResolvedValue(uncertain);
    await render(projectRequest);
    expect(document.body.textContent).toContain('administrator must inspect');
    expect(checkbox('Review').disabled).toBe(true);
    expect(button('Resume environment setup')?.disabled).toBe(true);
    await click('Refresh preview');
    expect(button('Resume environment setup')?.disabled).toBe(true);
    expect(projectRequest.mock.calls.every(call => !call[1])).toBe(true);
});
test('enabled environments require explicit certificate and key paths without inventing coverage', async () => {
    const projectRequest = vi.fn().mockResolvedValue({
        ...preview,
        settings: {
            ...settings,
            review: {
                ...settings.review,
                ssl: '',
                sslKey: ''
            }
        }
    });
    await render(projectRequest);
    enable('Review', true);
    expect(button('Enable environments')?.disabled).toBe(true);
    expect(input('wizard-review-ssl').value).toBe('');
    expect(input('wizard-review-ssl-key').value).toBe('');
    change('wizard-review-ssl', '/ssl/operator-reviewed/fullchain.pem');
    expect(button('Enable environments')?.disabled).toBe(true);
    change('wizard-review-ssl-key', '/ssl/operator-reviewed/privkey.pem');
    expect(button('Enable environments')?.disabled).toBe(false);
    expect(projectRequest).toHaveBeenCalledTimes(1);
});
test('failed status hides previous verified status and invalidates confirmation until a fresh preview', async () => {
    const projectRequest = vi.fn().mockResolvedValueOnce({
        ...preview,
        environments: { phase: 'ready' },
        capabilities: {
            ...preview.capabilities,
            canActivate: false,
            canUpdate: true
        }
    }).mockRejectedValueOnce(new Error('Cannot verify active ownership.'));
    await render(projectRequest);
    expect(document.body.textContent).toContain('recipe is verified');
    await click('Refresh status');
    expect(document.body.textContent).not.toContain('recipe is verified');
    expect(document.body.textContent).toContain('Environment status is unverified');
    expect(button('Update environments')?.disabled).toBe(true);
    expect(checkbox('Review').disabled).toBe(true);
});
test('read-only preview is cancelable and ignores late replies after unmount', async () => {
    let finish: (value: any) => void = () => undefined;
    const projectRequest = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onClose = vi.fn(() => { unmountFrom(root); });
    await render(projectRequest, onClose);
    expect(button('Close')?.disabled).toBe(false);
    await click('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        await act(async () => { finish(preview); });
        expect(document.body.textContent).not.toContain('review.system-bootstrapper.com');
        expect(errors).not.toHaveBeenCalled();
        expect(projectRequest).toHaveBeenCalledTimes(1);
    }
    finally {
        errors.mockRestore();
    }
});
test('an unsupported preview fails closed without offering a write', async () => {
    const projectRequest = vi.fn().mockResolvedValue({
        ...preview,
        capabilities: {}
    });
    await render(projectRequest);
    expect(document.body.textContent).toContain('incomplete or unsupported');
    expect(button('Enable environments')).toBeUndefined();
    expect(projectRequest.mock.calls).toEqual([[route]]);
});
