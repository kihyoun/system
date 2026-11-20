import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {I18nProvider} from '../../i18n';
import TokenOverviewDialog from './TokenOverviewDialog';

afterEach(cleanup);
it('shows unknown metadata honestly and only saves monitoring edits to the form', async () => {
  const request = vi.fn().mockResolvedValue({projects: ['example/system'], observedAt: '2026-11-09T12:00:00Z', credentials: [
    {projectPath: 'example/system', key: 'DOCKERHUB_TOKEN', purpose: 'Container publication', provider: 'Docker Hub',
      status: 'unknown', expiresAt: null, expirySource: 'unavailable', renewalGuide: '#docs/token-expiry'},
    {projectPath: 'example/system', key: 'RENOVATE_TOKEN', purpose: 'Renovate', provider: 'GitLab', configured: true,
      status: 'expiring', expiresAt: '2026-11-12', daysRemaining: 3, expirySource: 'gitlab', renewalGuide: '#docs/dependency-updates'}
  ]});
  const push = vi.fn();
  const main = {config: {runtimeOptions: {SYSTEM_CREDENTIAL_PROJECT_PATHS: '["example/system"]'} as Record<string, string>}, sync: {projectRequest: request, push}};
  render(<I18nProvider><TokenOverviewDialog main={main} onClose={vi.fn()}/></I18nProvider>);
  expect(await screen.findByText('Unknown expiry')).toBeTruthy();
  expect(screen.getByText('Expiry date: Unknown expiry')).toBeTruthy();
  expect(screen.getByText('Days remaining: 3')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Record external expiry date (optional)'), {target: {value: '2027-01-01'}});
  fireEvent.click(screen.getByText('Save monitoring settings to form'));
  expect(JSON.parse(main.config.runtimeOptions.SYSTEM_CREDENTIAL_EXPIRY_METADATA)[0].expiresAt).toBe('2027-01-01');
  expect(push).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Refresh metadata'));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request).toHaveBeenLastCalledWith('/operations/credentials');
});
