import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let text = fallback ?? key;
      for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  }),
  // `apps/web/src/i18n.ts` initialises i18next at import time; the init plugin
  // is inert here so the import side effect stays a no-op.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { Logo } from '../apps/web/src/components/layout/Logo';
import { Header } from '../apps/web/src/components/layout/Header';
import { ConfirmDeleteModal } from '../apps/web/src/components/modals/ConfirmDeleteModal';
import { LanguageSettingsCard } from '../apps/web/src/components/settings/LanguageSettingsCard';
import { VolumeFileList } from '../apps/web/src/views/volume/VolumeFileList';
import { VolumeFileModals } from '../apps/web/src/views/volume/VolumeFileModals';
import { VolumeFilePager } from '../apps/web/src/views/volume/VolumeFilePager';
import { VolumeOverwritePrompt } from '../apps/web/src/views/volume/VolumeOverwritePrompt';
import type { DavEntry } from '../apps/web/src/types';

const noop = () => {};

function fileEntry(overrides: Partial<DavEntry> = {}): DavEntry {
  return {
    href: '/alice/photos/a.txt',
    name: 'a.txt',
    path: 'a.txt',
    isCollection: false,
    size: 12,
    contentType: 'text/plain',
    lastModified: null,
    etag: null,
    ...overrides,
  };
}

describe('volume views render from props alone', () => {
  it('shows the spinner while loading and the empty states after', () => {
    const base = {
      owner: 'alice',
      volume: 'photos',
      entries: [],
      busy: false,
      onPreview: noop,
      onRename: noop,
      onDuplicate: noop,
      onDelete: noop,
    };
    const { unmount } = render(<VolumeFileList {...base} status="loading" />);
    expect(screen.getByRole('status')).toBeTruthy();
    unmount();

    render(<VolumeFileList {...base} status="missing" />);
    expect(screen.getByText('This Folder Does Not Exist Or You Do Not Have Access.')).toBeTruthy();
  });

  it('lists entries with per-row actions', () => {
    const onDelete = vi.fn();
    render(
      <VolumeFileList
        owner="alice"
        volume="photos"
        entries={[fileEntry(), fileEntry({ name: 'docs', path: 'docs', isCollection: true })]}
        status="ready"
        busy={false}
        onPreview={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('a.txt')).toBeTruthy();
    expect(screen.getByText('docs/')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides the pager for a single page and ranges a real one', () => {
    const { container, unmount } = render(
      <VolumeFilePager entries={[]} page={1} limit={100} total={3} paged={false} onPageChange={noop} onPageSizeChange={noop} />,
    );
    expect(container.textContent).toBe('');
    unmount();

    const onPageChange = vi.fn();
    render(
      <VolumeFilePager entries={[fileEntry()]} page={2} limit={25} total={100} paged onPageChange={onPageChange} onPageSizeChange={noop} />,
    );
    expect(screen.getByTestId('volume-pager-range').textContent).toContain('26–50 of 100');
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('asks before replacing and reports which entry', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<VolumeOverwritePrompt name="b.txt" busy={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Replace Existing Entry?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace It' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep Both' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('confirms a delete by naming the entry', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteModal title="Delete Entry" displayName="b.txt" onConfirm={onConfirm} onCancel={noop} />);
    expect(screen.getByText('Delete b.txt? This Cannot Be Undone.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('opens the mkdir dialog and the delete confirmation from one state object', () => {
    const { unmount } = render(
      <VolumeFileModals
        busy={false}
        mkdirOpen
        mkdirName=""
        renaming={null}
        renameValue=""
        deleting={null}
        preview={null}
        onCloseMkdir={noop}
        onMkdirName={noop}
        onMkdirSubmit={(e) => e.preventDefault()}
        onRenameValue={noop}
        onRenameSubmit={(e) => e.preventDefault()}
        onCloseRename={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onClosePreview={noop}
      />,
    );
    expect(screen.getByPlaceholderText('photos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    unmount();

    render(
      <VolumeFileModals
        busy={false}
        mkdirOpen={false}
        mkdirName=""
        renaming={null}
        renameValue=""
        deleting={fileEntry({ name: 'b.txt', path: 'b.txt' })}
        preview={null}
        onCloseMkdir={noop}
        onMkdirName={noop}
        onMkdirSubmit={(e) => e.preventDefault()}
        onRenameValue={noop}
        onRenameSubmit={(e) => e.preventDefault()}
        onCloseRename={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onClosePreview={noop}
      />,
    );
    expect(screen.getByText('Delete b.txt? This Cannot Be Undone.')).toBeTruthy();
  });

  it('offers the supported languages', () => {
    const onLanguageChange = vi.fn();
    render(<LanguageSettingsCard language="en" onLanguageChange={onLanguageChange} />);
    expect(screen.getByText('English')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(onLanguageChange).toHaveBeenCalledWith('en');
  });

  it('shows navigation chrome for a signed-in account', () => {
    const { container } = render(
      <MemoryRouter>
        <Header userEmail="alice@example.com" username="alice" />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('Durable-DAV');
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders the logo mark without a router', () => {
    const { container } = render(<Logo />);
    expect(container.textContent).toContain('Durable-DAV');
  });
});
