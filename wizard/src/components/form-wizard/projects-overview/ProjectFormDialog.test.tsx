import { vi } from 'vitest';
import { renderInto, unmountFrom } from '../../../testRoot';
import React from 'react';
import { act } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import Main from '../../../api/Main';
import ProjectFormDialog from './ProjectFormDialog';
test('debounce ignores stale responses and preserves invalid input without normalization', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const main = new Main();
    main.sync.connected = true;
    let finishOld: (value: any) => void = () => undefined;
    const request = vi.spyOn(main.sync, 'projectRequest').mockImplementation((route: string) => {
        if (route === '/projects/namespaces')
            return Promise.resolve({
                namespaces: [{
                        id: 1,
                        path: 'root'
                    }]
            });
        if (route.includes('projectKey=first'))
            return new Promise(resolve => { finishOld = resolve; });
        return Promise.resolve({ availability: 'occupied' });
    });
    await act(async () => {
        renderInto(<ProjectFormDialog main={main} open={true} activeProject="" handleClose={() => undefined}/>, root);
    });
    const keyInput = () => document.querySelector('input') as HTMLInputElement;
    const namespace = screen.getByRole('combobox', { name: 'GitLab namespace' }) as HTMLSelectElement;
    expect(namespace.value).toBe('');
    expect(namespace.selectedOptions[0].textContent).toBe('Select namespace');
    act(() => {
        fireEvent.change(namespace, { target: { value: '1' } } as any);
        fireEvent.change(keyInput(), { target: { value: 'first' } } as any);
    });
    expect(namespace.value).toBe('1');
    expect(request.mock.calls.filter(call => call[0].includes('availability'))).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(400); });
    act(() => { fireEvent.change(keyInput(), { target: { value: 'second' } } as any); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => { finishOld({ availability: 'available' }); });
    expect(document.body.textContent).toContain('Repository already exists.');
    act(() => { fireEvent.change(keyInput(), { target: { value: 'Ä Bad-key' } } as any); });
    expect(keyInput().value).toBe('Ä Bad-key');
    expect(document.body.textContent).toContain('lowercase a-z and digits 0-9 only');
    const count = request.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(request.mock.calls).toHaveLength(count);
    act(() => { unmountFrom(root); });
    root.remove();
    vi.useRealTimers();
});
