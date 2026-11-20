import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Docs, { DocsNavigation } from '../Docs';
import App from '../../App';
import CodeBlock from './CodeBlock';
import Markdown from './Markdown';
import { chapters } from '../../docs/model';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/docs#docs/getting-started');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Docs reader', () => {
  it('shows prerequisites, expected results, chapter navigation and history-selected content', () => {
    render(
      <>
        <DocsNavigation />
        <Docs />
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '0. Getting Started' })).toHaveFocus();
    expect(screen.getByText('Before you begin')).toBeVisible();
    expect(screen.getByText('Expected result')).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Chapter navigation' })).getByRole('link', {
        name: /Next: 1. Installation/,
      }),
    ).toHaveAttribute('href', '#docs/installation');
    act(() => {
      window.history.pushState({}, '', '#docs/configuration');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      screen.getByRole('heading', { level: 1, name: '3. Configuration · main actions' }),
    ).toBeVisible();
    expect(
      screen
        .getByRole('navigation', { name: 'Documentation chapters' })
        .querySelector('[aria-current="page"]'),
    ).toHaveAttribute('href', '#docs/configuration');
  });

  it('searches all chapters and lets readers clear or open a result', () => {
    render(<Docs />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search all docs' }), {
      target: { value: 'checksummed completion manifest' },
    });
    const results = screen.getByRole('region', { name: 'Documentation search results' });
    expect(
      within(results).getByRole('link', { name: '3. Configuration · main actions' }),
    ).toHaveAttribute('href', expect.stringMatching(/^#docs\/configuration/));
    expect(within(results).getByText(/… copying its data/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear documentation search' }));
    expect(screen.getByRole('heading', { name: '0. Getting Started', level: 1 })).toBeVisible();
  });

  it('uses the shared app drawer for wider, collapsible chapter navigation', async () => {
    const { container } = render(<App />);
    // Scope named controls to the real drawer and toolbar. Searching the entire
    // handbook repeatedly makes this interaction test depend on chapter size.
    const drawer = within(container.querySelector<HTMLElement>('#docs-drawer')!);
    const toolbar = within(container.querySelector<HTMLElement>('header')!);
    expect(drawer.getByRole('navigation', { name: 'Documentation chapters' })).toBeVisible();
    fireEvent.click(drawer.getByRole('button', { name: 'Close docs drawer' }));
    const open = await toolbar.findByRole('button', { name: 'Open docs drawer' });
    expect(open).toBeVisible();
    expect(open).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(open);
    expect(drawer.getByRole('button', { name: 'Close docs drawer' })).toBeVisible();
    expect(drawer.getByRole('navigation', { name: 'Documentation chapters' })).toBeVisible();
  });

  it('renders safe Markdown tables, inline code and local links', () => {
    render(<Markdown chapter={chapters.find((chapter) => chapter.id === 'foundations')!} />);
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Working storage' })).toHaveAttribute(
      'href',
      '#docs/storage',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Backup files contain credentials');
  });
});

describe('example clipboard', () => {
  it('shows an accessible success confirmation and copies only the commands', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CodeBlock code={'$ echo hello\nhello\n'} language="bash" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy bash example' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('echo hello');
  });

  it('explains clipboard failure and permits a retry', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CodeBlock code="git --version" language="bash" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy bash example' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select the example and copy it manually',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy bash example' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('does not offer output-only text as a runnable command', () => {
    render(<CodeBlock code="Sync authentication is configured." language="text" />);
    expect(screen.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
  });
});
