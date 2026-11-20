import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import PushDialog from './PushDialog';
test.each([
  [
    'routing',
    'Only application routing will be applied. GitLab stays available; affected application routes reload briefly.',
  ],
  [
    'restart',
    'This Push restarts the platform, including GitLab. The Wizard and application routes will be temporarily unavailable. Keep a current configuration Backup before continuing.',
  ],
  ['none', 'No service changes detected. Configuration will be saved without a restart.'],
])('reviews %s impact before allowing the exact plan to be pushed', async (mode, notice) => {
  const handlePush = vi.fn(),
    main = {
      sync: {
        pushImpact: vi
          .fn()
          .mockResolvedValue({ mode, projects: ['sample'], fingerprint: 'reviewed' }),
      },
    };
  render(<PushDialog main={main} open setOpen={vi.fn()} handlePush={handlePush} />);
  expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
  expect(await screen.findByText(notice)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Push' }));
  expect(handlePush).toHaveBeenCalledWith('reviewed');
});
test('failed impact verification prevents an unreviewed Push', async () => {
  const handlePush = vi.fn(),
    main = { sync: { pushImpact: vi.fn().mockRejectedValue(new Error('unavailable')) } };
  render(<PushDialog main={main} open setOpen={vi.fn()} handlePush={handlePush} />);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify Push impact'),
  );
  expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
  expect(handlePush).not.toHaveBeenCalled();
});
