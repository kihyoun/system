import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import type Main from '../../../api/Main';
import type {PreviewSetupIntent} from '../../../api/PreviewSetupIntent';
import {I18nProvider, localeStorageKey, translate} from '../../../i18n';
import PreviewSetupDialog from './PreviewSetupDialog';

const route = '/projects/wizard/preview-setup';
const desired: PreviewSetupIntent = {
  version: 1, namespace: 'operator-team',
  wizard: {mode: 'existing', project: 'wizard-source', origin: ''},
  review: {enabled: true, host: 'review.example.com', ssl: '/ssl/live/review.example.com/fullchain.pem', sslKey: '/ssl/live/review.example.com/privkey.pem'},
  beta: {enabled: false, host: '', ssl: '', sslKey: ''}
};
// Actual public API response examples. The System native-locale-messages
// regression independently checks the catalogue against the native producers.
const preflight = 'DNS, exact-host certificates, source availability and runner access checked. Confirm setup to import source and start its native push pipeline. Builds and browser checks take additional time.';
const waiting = 'Wait for the current native default-branch push pipeline, then run preflight and resume. Existing projects require a normal source push; setup never fabricates a successful pipeline.';
const ready = 'Canonical Review/Beta setup is ready. Use the native manual deploy and stop jobs after successful candidate checks. Production retains its accepted public release.';
function open(preflightRequest = vi.fn().mockResolvedValue({previewHash: 'exact-preflight', message: preflight}), applyRequest = vi.fn()) {
  window.localStorage.setItem(localeStorageKey, 'ko');
  const projectRequest = vi.fn((requested: string) => {
    if (requested === route) return Promise.resolve({phase: 'not-started', settings: desired});
    if (requested === '/projects/namespaces') return Promise.resolve({namespaces: [{path: desired.namespace}]});
    if (requested === route + '/preflight') return preflightRequest();
    if (requested === route + '/apply') return applyRequest();
    throw Error('Unexpected fixture route');
  });
  const main = {previewSetup: desired, sync: {projectRequest}} as unknown as Main;
  render(<I18nProvider><PreviewSetupDialog main={main} close={vi.fn()}/></I18nProvider>);
  return {projectRequest, preflightRequest, applyRequest};
}
afterEach(() => window.localStorage.removeItem(localeStorageKey));

test('Korean setup renders native preflight, waiting-build and ready messages without changing operator values', async () => {
  expect(translate(preflight, 'de')).toContain('DNS, Zertifikate für die exakten Hosts');
  const apply = vi.fn().mockResolvedValueOnce({phase: 'waiting-build', message: waiting})
    .mockResolvedValueOnce({phase: 'ready', message: ready, previewUrl: 'https://review.example.com'});
  const {projectRequest} = open(undefined, apply);
  await waitFor(() => expect(projectRequest).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', {name: '준비 사항 검사'}));
  expect(await screen.findByRole('status')).toHaveTextContent('DNS, 정확한 호스트의 인증서, 소스 가용성 및 Runner 접근을 확인했습니다.');
  expect(screen.getByRole('status')).not.toHaveTextContent(preflight);
  fireEvent.click(screen.getByRole('button', {name: '설정 확인 / 계속'}));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('현재 네이티브 기본 브랜치 푸시 파이프라인을 기다린 뒤'));
  expect(screen.getByRole('status')).not.toHaveTextContent(waiting);
  fireEvent.click(screen.getByRole('button', {name: '준비 사항 검사'}));
  await waitFor(() => expect(screen.getByRole('button', {name: '설정 확인 / 계속'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button', {name: '설정 확인 / 계속'}));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('정식 Review/Beta 설정이 준비되었습니다.'));
  expect(screen.getByRole('status')).not.toHaveTextContent(ready);
  expect(screen.getByDisplayValue(desired.review.ssl)).toBeInTheDocument();
  expect(screen.getByDisplayValue(desired.wizard.project)).toBeInTheDocument();
  expect(screen.getByRole('link', {name: '예약된 Review URL'})).toHaveAttribute('href', 'https://review.example.com');
  expect(projectRequest).toHaveBeenLastCalledWith(route + '/apply', {settings: desired, previewHash: 'exact-preflight'});
});

test.each([
  ['Validate DNS and the exact-host HTTPS certificate/key for review before activation.', '활성화 전에 review의 DNS 및 정확한 호스트 HTTPS 인증서/키를 검증하세요.'],
  ['Preview source ownership changed; existing operator projects are never overwritten.', '미리보기 소스 소유권이 변경되었습니다.'],
  ['Source transfer failed. Inspect project ownership and remote refs before explicitly resuming.', '소스 전송에 실패했습니다.'],
  ['An online Docker runner with wizard-source-primary access is required.', 'wizard-source-primary 접근 권한이 있는 온라인 Docker Runner가 필요합니다.'],
  ['Select a namespace and versioned desired preview settings.', '네임스페이스와 버전이 지정된 원하는 미리보기 설정을 선택하세요.'],
  ['Retain the accepted public release installation receipt and image selection before initial preview setup.', '최초 미리보기 설정 전에 승인된 공개 릴리스 설치 기록과 이미지 선택을 보관하세요.'],
  ['Setup mutation completion is unconfirmed. Its exact live-state and preview leases remain held. Inspect the recorded operation before any resumption or targeted recovery.', '설정 변경의 완료가 확인되지 않았습니다.'],
  ['Setup lease ownership changed. No replacement lease was cleared; inspect the exact recorded operation.', '설정 임대 소유권이 변경되었습니다.'],
  ['Setup lease cleanup could not be confirmed. Inspect the exact recorded operation; its preview lease was retained.', '설정 임대 정리를 확인하지 못했습니다.'],
  ['Wait for the current platform operation to finish.', '현재 플랫폼 작업이 끝날 때까지 기다리세요.']
])('Korean setup translates native public failure: %s', async (message, expected) => {
  const {projectRequest} = open(vi.fn().mockRejectedValue({response: {data: {message}}}));
  await waitFor(() => expect(projectRequest).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', {name: '준비 사항 검사'}));
  expect(await screen.findByRole('status')).toHaveTextContent(expected);
  expect(screen.getByRole('status')).not.toHaveTextContent(message);
  expect(screen.getByRole('button', {name: '설정 확인 / 계속'})).toBeDisabled();
});

test('unknown diagnostics and operator identifiers remain verbatim in both locales', async () => {
  const diagnostic = 'Operator diagnostic /ssl/private/example.pem: certificate detail #8071';
  expect(translate(diagnostic, 'de')).toBe(diagnostic);
  expect(translate(diagnostic, 'ko')).toBe(diagnostic);
  const {projectRequest} = open(vi.fn().mockRejectedValue({response: {data: {message: diagnostic}}}));
  await waitFor(() => expect(projectRequest).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', {name: '준비 사항 검사'}));
  expect(await screen.findByRole('status')).toHaveTextContent(diagnostic);
});
