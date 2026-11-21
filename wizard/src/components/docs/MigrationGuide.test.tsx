import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MigrationGuide from './MigrationGuide';
import { upgradeGraph, upgradePath } from '../../docs/upgradePaths';
import { I18nProvider, localeStorageKey } from '../../i18n';

beforeEach(() => {
  localStorage.clear();
});

describe('Offline migration guide', () => {
  for (const [locale, sourceLabel, targetLabel, unknown] of [
    ['en', 'Installed version', 'Target version', 'Unknown / other version'],
    ['de', 'Installierte Version', 'Zielversion', 'Unbekannte / andere Version'],
    ['ko', '설치된 버전', '대상 버전', '알 수 없는 버전 / 다른 버전'],
  ])
    it(`keeps ${locale} selection labels clear of the unknown-version option`, () => {
      localStorage.setItem(localeStorageKey, locale);
      render(
        <I18nProvider>
          <MigrationGuide />
        </I18nProvider>,
      );
      for (const label of [sourceLabel, targetLabel]) {
        const control = screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
        expect(control.tagName).toBe('SELECT');
        expect(Array.from(control.options, (option) => option.value)).toEqual([
          '',
          ...upgradeGraph.versions,
        ]);
        fireEvent.change(control, { target: { value: '' } });
        expect(control.selectedOptions[0]).toHaveTextContent(unknown);
        expect(screen.getByText(label, { selector: 'label' })).toHaveAttribute(
          'data-shrink',
          'true',
        );
        expect(screen.getByLabelText(label)).toBe(control);
      }
    });

  it('requires manual source selection and never contacts Sync', () => {
    const network = vi.spyOn(globalThis, 'fetch');
    render(<MigrationGuide />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Target version' }), {
      target: { value: '1.2.0' },
    });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unknown release');
    fireEvent.change(screen.getByRole('combobox', { name: 'Installed version' }), {
      target: { value: '1.1.3' },
    });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Supported transition');
    const steps = screen.getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    const first = screen.getByRole('checkbox', { name: '1.1.3 → 1.2.0: Prerequisites' });
    fireEvent.click(first);
    expect(first).toBeChecked();
    expect(steps).toEqual([
      'Prerequisites',
      'Matching backups',
      'Preflight and reviewed plan',
      'Explicit apply',
      'Verification',
      'Recovery',
    ]);
    expect(screen.getAllByRole('button', { name: 'Copy bash example' })).toHaveLength(4);
    expect(document.querySelector('pre')).toHaveTextContent('--target 1.2.0');
    expect(document.querySelector('pre')).toHaveTextContent(
      'python3 bootstrapper/upgrade-release.py',
    );
    expect(document.querySelector('pre')).not.toHaveTextContent('--gitlab-checkpoint');
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('distinguishes same release, unsupported downgrade and unknown source', () => {
    render(<MigrationGuide />);
    const source = screen.getByRole('combobox', { name: 'Installed version' });
    fireEvent.change(source, { target: { value: '2.0.0' } });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No release upgrade is necessary');
    fireEvent.change(screen.getByRole('combobox', { name: 'Target version' }), {
      target: { value: '1.1.3' },
    });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No supported path');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.change(source, { target: { value: '' } });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unknown release');
  });

  it('composes every mandatory intermediate release in CLI order', () => {
    expect(upgradePath('1.1.3', '2.0.0').transitions.map((edge) => edge.to)).toEqual([
      '1.2.0',
      '2.0.0',
    ]);
    render(<MigrationGuide />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Installed version' }), {
      target: { value: '1.1.3' },
    });
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      '1.1.3 → 1.2.0',
      '1.2.0 → 2.0.0',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(12);
    const examples = document.querySelectorAll('pre');
    expect(examples[0]).toHaveTextContent('python3 bootstrapper/upgrade-release.py');
    expect(examples[0]).toHaveTextContent('--target 1.2.0');
    expect(examples[4]).toHaveTextContent('dist/cli/main.js upgrade');
    expect(examples[4]).toHaveTextContent('--target 2.0.0');
    const prerequisite = screen.getByRole('checkbox', { name: '1.1.3 → 1.2.0: Prerequisites' });
    fireEvent.click(prerequisite);
    fireEvent.change(screen.getByRole('combobox', { name: 'Target version' }), {
      target: { value: '1.2.0' },
    });
    expect(prerequisite).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  for (const [locale, source, target, supported] of [
    ['de', 'Installierte Version', 'Zielversion', 'Unterstützter Übergang'],
    ['ko', '설치된 버전', '대상 버전', '지원되는 전환'],
  ])
    it(`provides usable ${locale} selections and instructions offline`, () => {
      localStorage.setItem(localeStorageKey, locale);
      render(
        <I18nProvider>
          <MigrationGuide />
        </I18nProvider>,
      );
      fireEvent.change(screen.getByRole('combobox', { name: source }), {
        target: { value: '1.2.0' },
      });
      expect(screen.getByRole('combobox', { name: target })).toHaveValue('2.0.0');
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(supported);
      expect(screen.getByRole('alert')).toHaveTextContent('GitLab 19.5.3 → 19.6.1');
      expect(document.querySelector('pre')).toHaveTextContent('--gitlab-checkpoint');
      expect(document.querySelector('pre')).toHaveTextContent('dist/cli/main.js upgrade');
      expect(screen.getByRole('alert').querySelector('a')).toHaveAttribute(
        'href',
        'https://github.com/kihyoun/system/blob/v2.0.0/gitlab/UPGRADE.md',
      );
    });
});
