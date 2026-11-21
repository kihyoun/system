import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MigrationGuide from './MigrationGuide';
import { upgradeGraph, upgradePath } from '../../docs/upgradePaths';
import { I18nProvider, localeStorageKey } from '../../i18n';

beforeEach(() => {
  localStorage.clear();
});

describe('Offline migration guide', () => {
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
    const first = upgradeGraph.transitions.find((edge) => edge.to === '1.2.0')!;
    const graph = {
      ...upgradeGraph,
      versions: ['1.1.3', '1.2.0', '1.3.0'],
      transitions: [
        first,
        {
          ...first,
          from: '1.2.0',
          to: '1.3.0',
          requiredStage: 'public-release-upgrade-1-2-0-to-1-3-0',
        },
      ],
    };
    expect(upgradePath('1.1.3', '1.3.0', graph).transitions.map((edge) => edge.to)).toEqual([
      '1.2.0',
      '1.3.0',
    ]);
    render(<MigrationGuide graph={graph} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Installed version' }), {
      target: { value: '1.1.3' },
    });
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      '1.1.3 → 1.2.0',
      '1.2.0 → 1.3.0',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(12);
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
      expect(document.querySelector('pre')).toHaveTextContent('operations/dist/cli.js upgrade');
      expect(screen.getByRole('alert').querySelector('a')).toHaveAttribute(
        'href',
        'https://github.com/kihyoun/system/blob/v2.0.0/gitlab/UPGRADE.md',
      );
    });
});
