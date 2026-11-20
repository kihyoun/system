import { renderInto, unmountFrom } from '../../../../testRoot';
import React from 'react';
import { act } from 'react';
import Main from '../../../../api/Main';
import StartFields from './StartFields';
test('runner token stays masked until Show is selected', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const main = new Main();
    main.init = false;
    main.config!.gitlabRunnerToken = 'glrt-test-only';
    act(() => { renderInto(<StartFields main={main}/>, root); });
    const input = () => Array.from(root.querySelectorAll('input'))
        .find(item => item.value === 'glrt-test-only')!;
    expect(input().type).toBe('password');
    const button = root.querySelector('button')!;
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(input().type).toBe('text');
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(input().type).toBe('password');
    act(() => { unmountFrom(root); });
    root.remove();
});
