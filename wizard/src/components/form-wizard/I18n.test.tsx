import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Main from '../../api/Main';
import { I18nProvider, useI18n } from '../../i18n';
import StartFields from './general-form/fields/StartFields';
import SSLSettingsFields from './general-form/fields/SSLSettingsFields';
import WizardSourceDialog from './projects-overview/WizardSourceDialog';
import ProjectFormDialog from './projects-overview/ProjectFormDialog';

function LanguageSwitch() {
    const { locale, setLocale } = useI18n();
    return <button onClick={() => setLocale(locale === 'en' ? 'de' : 'en')}>EN / DE</button>;
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

test('language changes preserve edited configuration, token visibility and generated output', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    const main = new Main();
    main.init = false;
    render(<I18nProvider><LanguageSwitch /><StartFields main={main} /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Runner authentication token'), { target: { value: 'operator-supplied-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    const input = screen.getByLabelText('Runner authentication token');
    const before = main.config!.content;
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByLabelText('Runner-Authentifizierungstoken')).toBe(input);
    expect(input).toHaveValue('operator-supplied-secret');
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ausblenden' })).toBeVisible();
    expect(main.config!.content).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByLabelText('Runner authentication token')).toBe(input);
    expect(main.config!.content).toBe(before);
});

test('an already visible registry warning changes language without changing its configuration', () => {
    const main = new Main();
    main.init = false;
    main.config!.gitlabRegistryDomainMode = 0;
    render(<I18nProvider><LanguageSwitch /><SSLSettingsFields main={main} /></I18nProvider>);
    expect(screen.getByText('You are using an insecure-registry. This is not recommended.', { exact: false })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByText('Sie verwenden eine ungesicherte Registry. Dies wird nicht empfohlen.', { exact: false })).toBeVisible();
    expect(main.config!.gitlabRegistryDomainMode).toBe(0);
    expect(screen.getByText('https://docs.docker.com/registry/insecure/')).toHaveTextContent('https://docs.docker.com/registry/insecure/');
});

test('project key validation translates without changing the invalid input', () => {
    const main = new Main();
    main.init = false;
    render(<I18nProvider><LanguageSwitch /><ProjectFormDialog main={main} open activeProject="" handleClose={() => {}} /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Project Key'), { target: { value: 'Invalid-Key' } });
    expect(screen.getByText('Required: lowercase a-z and digits 0-9 only.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByText('Erforderlich: nur Kleinbuchstaben a-z und Ziffern 0-9.')).toBeVisible();
    expect(screen.getByLabelText('Projektschlüssel')).toHaveValue('Invalid-Key');
});

test('a pending dialog translates its existing status without restarting its request and preserves backend text', async () => {
    let reject: (error: Error) => void = () => {};
    const projectRequest = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
    render(<I18nProvider><LanguageSwitch /><WizardSourceDialog sync={{ projectRequest }} onClose={() => {}} /></I18nProvider>);
    expect(screen.getByText('Loading source preview…')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByText('Quellcodevorschau wird geladen…')).toBeVisible();
    expect(projectRequest).toHaveBeenCalledTimes(1);
    await act(async () => { reject(Error('operator.example.test: custom backend diagnostic')); });
    expect(screen.getByText('operator.example.test: custom backend diagnostic')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'EN / DE', hidden: true }));
    expect(screen.getByText('operator.example.test: custom backend diagnostic')).toBeVisible();
    expect(projectRequest).toHaveBeenCalledTimes(1);
});
