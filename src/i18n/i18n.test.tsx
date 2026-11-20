import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { german, I18nProvider, localeStorageKey, translate, useI18n } from './index';
import korean from './korean';
import { backupText } from './backupWorkflow';

function Example() {
  const { locale, setLocale, t } = useI18n();
  const [value, setValue] = useState('operator.example.test');
  return <><button onClick={() => setLocale(locale === 'en' ? 'de' : 'en')}>EN | DE</button>
    <label>{t('Connect')}<input value={value} onChange={event => setValue(event.target.value)} /></label></>;
}

describe('Language preference', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); document.documentElement.lang = 'en'; });
  it('switches visible text and document language without discarding edited fields', () => {
    render(<I18nProvider><Example /></I18nProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited.example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'EN | DE' }));
    expect(screen.getByLabelText('Verbinden')).toHaveValue('edited.example.test');
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem(localeStorageKey)).toBe('de');
    fireEvent.click(screen.getByRole('button', { name: 'EN | DE' }));
    expect(screen.getByLabelText('Connect')).toHaveValue('edited.example.test');
    expect(document.documentElement.lang).toBe('en');
  });
  it('restores a supported saved preference and safely ignores invalid stored values', () => {
    localStorage.setItem(localeStorageKey, 'de');
    const view = render(<I18nProvider><Example /></I18nProvider>);
    expect(screen.getByLabelText('Verbinden')).toBeVisible(); view.unmount();
    localStorage.setItem(localeStorageKey, 'invalid');
    render(<I18nProvider><Example /></I18nProvider>);
    expect(screen.getByLabelText('Connect')).toBeVisible();
  });
  it('uses library interpolation and plural selection while preserving placeholder values', () => {
    expect(translate('docs.searchResults', 'en', { count: 1, query: 'PERSISTENT_DIR' })).toBe('1 chapter matching “PERSISTENT_DIR”');
    expect(translate('docs.searchResults', 'en', { count: 2, query: 'PERSISTENT_DIR' })).toBe('2 chapters matching “PERSISTENT_DIR”');
    expect(translate('docs.searchResults', 'de', { count: 2, query: 'PERSISTENT_DIR' })).toBe('2 Kapitel zu „PERSISTENT_DIR“');
    expect(translate('code.copyExample', 'de', { language: 'bash' })).toBe('bash-Beispiel kopieren');
  });
  it('works with blocked browser storage and preserves unknown technical or operator values', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    render(<I18nProvider><Example /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'EN | DE' }));
    expect(screen.getByLabelText('Verbinden')).toBeVisible();
    expect(translate('GITLAB_RUNNER_TOKEN', 'de')).toBe('GITLAB_RUNNER_TOKEN');
    expect(translate('operator.example.test', 'de')).toBe('operator.example.test');
    expect(translate('Connect', 'en')).toBe('Connect');
    expect(translate('Import finished: untouched-config.json', 'de')).toBe('Import abgeschlossen: untouched-config.json');
    expect(translate('error reading file: untouched-config.json', 'de')).toBe('Fehler beim Lesen der Datei: untouched-config.json');
    expect(translate('Import finished. (Skipped 3 File(s)', 'de')).toBe('Import abgeschlossen. (Übersprungen: 3 Datei(en)');
  });
});

function ThreeLanguages() {
  const { setLocale, t } = useI18n();
  const [value, setValue] = useState('operator.example.test');
  return <>{(['en', 'de', 'ko'] as const).map(locale => <button key={locale} onClick={() => setLocale(locale)}>{locale}</button>)}
    <label>{t('Connect')}<input value={value} onChange={event => setValue(event.target.value)} /></label></>;
}

describe('Complete Korean language support', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; });
  afterEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; });

  it('provides an explicit Korean translation for every known key and preserves placeholders', () => {
    expect(Object.keys(korean).sort()).toEqual(Object.keys(german).sort());
    for (const [key, value] of Object.entries(korean)) {
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toBe(key);
      const placeholders = key.startsWith('docs.searchResults_') ? ['{{count}}', '{{query}}'] : key === 'code.copyExample' ? ['{{language}}'] : key === 'status.skippedFiles' ? ['{{count}}'] : key.match(/\{\{?[^{}]+\}\}?/g)?.sort() ?? [];
      expect(value.match(/\{\{?[^{}]+\}\}?/g)?.sort() ?? [], key).toEqual(placeholders);
    }
  });

  it('restores Korean and keeps edits through EN, DE and Korean switches', () => {
    localStorage.setItem(localeStorageKey, 'ko');
    const first = render(<I18nProvider><ThreeLanguages /></I18nProvider>);
    expect(screen.getByLabelText('연결')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '한글-operator.example.test' } });
    for (const [locale, label] of [['en', 'Connect'], ['de', 'Verbinden'], ['ko', '연결']]) {
      fireEvent.click(screen.getByRole('button', { name: locale }));
      expect(screen.getByLabelText(label)).toHaveValue('한글-operator.example.test');
      expect(document.documentElement.lang).toBe(locale);
      expect(localStorage.getItem(localeStorageKey)).toBe(locale);
    }
    first.unmount();
    render(<I18nProvider><ThreeLanguages /></I18nProvider>);
    expect(screen.getByLabelText('연결')).toBeVisible();
  });

  it('uses Korean plural rules and preserves command, filename and operator values', () => {
    for (const count of [0, 1, 2])
      expect(translate('docs.searchResults', 'ko', { count, query: 'PERSISTENT_DIR' }))
        .toBe(`“PERSISTENT_DIR”에 일치하는 장 ${count}개`);
    expect(translate('code.copyExample', 'ko', { language: 'bash' })).toBe('bash 예제 복사');
    for (const value of ['You build it. You own it.', 'GITLAB_RUNNER_TOKEN', 'sudo docker compose up', '사용자.example.test'])
      expect(translate(value, 'ko')).toBe(value);
    expect(translate('Import finished: 사용자-config.json', 'ko')).toBe('가져오기 완료: 사용자-config.json');
    expect(translate('Import finished. (Skipped 3 File(s)', 'ko')).toBe('가져오기가 완료되었습니다. (건너뛴 파일: 3개');
    expect(backupText('ko-KR', 'start')).toBe('Seed 및 설정 백업');
    expect(backupText('ko', 'configuration.user-value')).toBe('configuration.user-value');
  });
});
