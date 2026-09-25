import { FolderArchive } from 'lucide-react';

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-xl font-semibold tracking-tight whitespace-nowrap">
      <FolderArchive className="h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
      <span>
        <span className="text-[var(--color-accent)]">Durable-</span>
        <span className="text-[var(--color-text-primary)]">DAV</span>
      </span>
    </span>
  );
}
