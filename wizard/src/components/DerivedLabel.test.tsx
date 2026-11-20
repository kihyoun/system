import { renderInto, unmountFrom } from '../testRoot';
import React from 'react';
import { act } from 'react';
import DerivedLabel, { derivedWarning } from './DerivedLabel';
test('derived labels have a focusable asterisk and an accessible verification warning', () => {
    const root = document.createElement('div');
    act(() => { renderInto(<DerivedLabel label="GITLAB_HOST" source="NGINX route"/>, root); });
    expect(root.textContent).toBe('GITLAB_HOST *');
    expect(root.querySelector('span')!.tabIndex).toBe(0);
    expect(root.querySelector('span')!.getAttribute('aria-label')).toContain(derivedWarning);
    act(() => { unmountFrom(root); });
});
test('saved labels have no derived marker', () => {
    const root = document.createElement('div');
    act(() => { renderInto(<DerivedLabel label="GITLAB_HOST"/>, root); });
    expect(root.textContent).toBe('GITLAB_HOST');
    expect(root.querySelector('span')).toBe(null);
    act(() => { unmountFrom(root); });
});
