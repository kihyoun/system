import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ServerControlButton from './ServerControlButton';

function callbacks(harvest: ReturnType<typeof vi.fn>) {
  return {main: {sync: {harvest}}, setOpenSuccess: vi.fn(), setOpenAlert: vi.fn(), setLastStatusMessage: vi.fn()};
}

test('Harvest remains pending and blocks repeated mutations until the held server request finishes', async () => {
  let finish: () => void = () => undefined;
  const props = callbacks(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
  render(<ServerControlButton {...props} />);
  fireEvent.click(screen.getByRole('button', {name: 'Synchronize'}));
  fireEvent.click(screen.getByRole('menuitem', {name: 'Harvest'}));
  expect(screen.getByRole('status')).toHaveTextContent('Harvest in progress');
  expect(screen.getByRole('button', {name: 'Harvest in progress...'})).toHaveAttribute('aria-disabled', 'true');
  expect(props.setOpenSuccess.mock.calls).toEqual([['']]);
  fireEvent.click(screen.getByRole('button', {name: 'Harvest in progress...'}));
  expect(props.main.sync.harvest).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(screen.queryByRole('status')).toBe(null);
  expect(props.setOpenSuccess).toHaveBeenLastCalledWith('Harvest completed.');
  expect(screen.getByRole('button', {name: 'Synchronize'})).not.toHaveAttribute('aria-disabled');
});

test('a failed Harvest reports failure without displaying completion', async () => {
  let fail: (error: Error) => void = () => undefined;
  const props = callbacks(vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })));
  render(<ServerControlButton {...props} />);
  fireEvent.click(screen.getByRole('button', {name: 'Synchronize'}));
  fireEvent.click(screen.getByRole('menuitem', {name: 'Harvest'}));
  await act(async () => { fail(new Error('Seed copy failed')); });
  expect(props.setOpenAlert).toHaveBeenLastCalledWith('Error: Seed copy failed');
  expect(props.setOpenSuccess.mock.calls).toEqual([['']]);
  expect(props.setLastStatusMessage).toHaveBeenLastCalledWith('Harvest failed.');
  expect(screen.queryByRole('status')).toBe(null);
});
