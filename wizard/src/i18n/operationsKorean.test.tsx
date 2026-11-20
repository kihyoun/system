import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {I18nProvider, localeStorageKey, useI18n} from './index';
import Main from '../api/Main';
import TokenOverviewDialog from '../components/dialogs/TokenOverviewDialog';
import SystemDiagnosticsDialog from '../components/dialogs/SystemDiagnosticsDialog';
import PreviewSetupDialog from '../components/form-wizard/projects-overview/PreviewSetupDialog';
import BackupWorkflowDialog from '../components/form-wizard/dialog/BackupWorkflowDialog';

beforeEach(() => {localStorage.setItem(localeStorageKey, 'ko'); sessionStorage.clear();});
afterEach(() => {localStorage.clear(); sessionStorage.clear();});

it('renders Korean credential labels and saves only form intent while retaining project paths', async () => {
  const request = vi.fn().mockResolvedValue({projects: ['example/system'], credentials: [{
    projectPath: 'example/system', key: 'RENOVATE_TOKEN', purpose: 'Container publication', provider: 'GitLab',
    status: 'expiring', expiresAt: '2026-11-12', daysRemaining: 3, expirySource: 'gitlab', renewalGuide: '#docs/token-expiry'
  }]});
  const main = new Main(); main.init = false;
  main.config!.runtimeOptions.SYSTEM_CREDENTIAL_PROJECT_PATHS = '["example/system"]';
  main.sync.projectRequest = request;
  render(<I18nProvider><TokenOverviewDialog main={main} onClose={vi.fn()}/></I18nProvider>);
  expect(await screen.findByText('곧 만료됨')).toBeVisible();
  expect(screen.getByText('남은 일수: 3')).toBeVisible();
  expect(screen.getByLabelText('GitLab 자동화 프로젝트 경로')).toHaveValue('example/system');
  fireEvent.click(screen.getByRole('button', {name: '모니터링 설정을 양식에 저장'}));
  expect(screen.getByRole('status')).toHaveTextContent('모니터링 설정을 양식에 저장했습니다.');
  expect(request).toHaveBeenCalledExactlyOnceWith('/operations/credentials');
});

it('renders Korean diagnostics actions without running checks on opening', async () => {
  const loadTargets = vi.fn().mockResolvedValue({registry: 'https://registry.example.test', helper: 'https://registry.gitlab.com',
    helperImage: 'registry.gitlab.com/helper@sha256:fixture', runners: ['runner_docker_1'], context: 'operator context'});
  const checkConnection = vi.fn(), tryHelperPull = vi.fn();
  render(<I18nProvider><SystemDiagnosticsDialog open onClose={vi.fn()} loadTargets={loadTargets} checkConnection={checkConnection} tryHelperPull={tryHelperPull}/></I18nProvider>);
  await waitFor(() => expect(screen.getByRole('button', {name: '연결 검사'})).toBeEnabled());
  expect(screen.getByRole('button', {name: '도우미 이미지 다운로드 시도'})).toBeEnabled();
  expect(screen.getByText('https://registry.example.test', {exact: false})).toBeVisible();
  expect(checkConnection).not.toHaveBeenCalled(); expect(tryHelperPull).not.toHaveBeenCalled();
});

it('renders Korean preview setup labels without applying saved intent', async () => {
  const main = new Main(); main.init = false;
  const request = vi.fn().mockResolvedValue({state: 'not-configured', namespaces: [{path: 'example'}]});
  main.sync.projectRequest = request;
  render(<I18nProvider><PreviewSetupDialog main={main} close={vi.fn()}/></I18nProvider>);
  expect(screen.getByText('개발 미리보기 설정')).toBeVisible();
  expect(screen.getByRole('button', {name: '설정 확인 / 계속'})).toBeDisabled();
  expect(screen.getByRole('button', {name: '준비 사항 검사'})).toBeDisabled();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.map(call => call[0])).toEqual(['/projects/wizard/preview-setup', '/projects/namespaces']);
});

function EnglishSwitch() {const {setLocale} = useI18n(); return <button onClick={() => setLocale('en')}>English</button>;}
it('translates an existing backup failure when switching languages without repeating the backup', async () => {
  const request = vi.fn().mockRejectedValue(Error('operator backend secret'));
  render(<I18nProvider><EnglishSwitch/><BackupWorkflowDialog sync={{diagnosticRequest: request}} onClose={vi.fn()}/></I18nProvider>);
  fireEvent.click(screen.getByRole('button', {name: 'Seed 및 설정 백업'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('백업에 실패했습니다.');
  fireEvent.click(screen.getByRole('button', {name: 'English', hidden: true}));
  expect(screen.getByRole('alert')).toHaveTextContent('Backup failed.');
  expect(request).toHaveBeenCalledExactlyOnceWith('/command/backup', {});
  expect(document.body.textContent).not.toContain('operator backend secret');
});
