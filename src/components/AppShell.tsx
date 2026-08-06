'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PlusFileIcon, PlusFolderIcon } from '@/components/icons';
import LinkImpactModal from '@/components/LinkImpactModal';
import MoveToDialog from '@/components/MoveToDialog';
import NoteTree, { type PendingCreate } from '@/components/NoteTree';
import RowContextMenu from '@/components/RowContextMenu';
import type { FixableLink, UnfixableLink } from '@/lib/links/rewrite';
import { dirName, baseName, renameVerb } from '@/lib/paths';
import { filePathsOf, folderPathsOf, withClientFile, withClientFolder, type TreeNode } from '@/lib/tree';

type LinkImpactState = {
  oldPath: string;
  newPath: string;
  fixable: FixableLink[];
  unfixable: UnfixableLink[];
  busy: boolean;
  error: string | null;
};

async function requestJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}

/**
 * Owns the state that has to span the sidebar and the main content, which
 * `page.tsx` — a Server Component — can't hold itself: which folder new
 * items land in, an in-progress create's typed name, and (later phases)
 * which modal or toast is active.
 *
 * Confirming a file's name never touches the server here — it only pushes
 * `?new=1`, and the existing autosave pipeline (`sessions.ts`) writes the
 * first byte on the first keystroke. A folder is even simpler: it's never
 * real until a file lands inside it (crud-operations-spec.md), so it's
 * nothing but a name added to `clientFolders` — no request at all.
 */
export default function AppShell({
  tree,
  noteCount,
  selected,
  children,
}: {
  tree: TreeNode[];
  noteCount: number;
  selected?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [selectedFolder, setSelectedFolder] = useState('notes');
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>(null);
  const [clientFolders, setClientFolders] = useState<string[]>([]);
  // A file the user just confirmed a name for but that isn't on disk yet —
  // nothing is written until the first keystroke, so without a placeholder
  // the tree row the user was just typing into would vanish with nothing to
  // replace it. See `withClientFile` for the full reasoning.
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  // The note currently showing an inline rename input in place of its row.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // The row a right-click or "more" button opened a menu for.
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  // The note showing the "Move to…" folder picker — the keyboard-accessible
  // path to the same move that drag-and-drop performs directly.
  const [movingPath, setMovingPath] = useState<string | null>(null);
  // Set once a confirmed rename turns out to affect other notes' links —
  // null means either nothing is pending or the impact scan found nothing
  // worth asking about, in which case the rename already went straight through.
  const [linkImpact, setLinkImpact] = useState<LinkImpactState | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Both graduate to real the moment the server-fetched tree already
  // contains them — drop the ephemeral copy rather than showing it twice.
  // (`NoteEditor` triggers the refresh that makes this happen promptly, on
  // the new file's first successful save.)
  const realFolders = folderPathsOf(tree);
  const liveClientFolders = clientFolders.filter((path) => !realFolders.has(path));
  const livePendingFile = pendingFile && !filePathsOf(tree).has(pendingFile) ? pendingFile : null;

  let displayTree = liveClientFolders.reduce(
    (acc, path) => withClientFolder(acc, dirName(path), baseName(path)),
    tree,
  );
  if (livePendingFile) {
    displayTree = withClientFile(displayTree, dirName(livePendingFile), baseName(livePendingFile));
  }

  // Every folder a note could move to, for the "Move to…" dialog: real ones
  // plus still-ephemeral ones (see `withClientFolder`), always including the
  // root, minus wherever the note already is — moving it there would be a
  // no-op the picker shouldn't even offer.
  const moveTargetFolders = (path: string): string[] => {
    const currentFolder = dirName(path);
    const all = new Set(['notes', ...realFolders, ...liveClientFolders]);
    all.delete(currentFolder);
    return [...all].sort();
  };

  const startCreate = (kind: 'file' | 'folder') => setPendingCreate({ parentPath: selectedFolder, kind });

  const confirmCreate = (name: string) => {
    if (!pendingCreate) return;
    const path = `${pendingCreate.parentPath}/${name}`;
    const kind = pendingCreate.kind;
    setPendingCreate(null);

    if (kind === 'folder') {
      setClientFolders((prev) => [...prev, path]);
      setSelectedFolder(path);
      return;
    }
    setPendingFile(path);
    router.push(`/?path=${encodeURIComponent(path)}&new=1`);
  };

  const startRename = (path: string) => {
    setRenameError(null);
    setRenamingPath(path);
    setContextMenu(null);
  };

  // The actual `git mv` + commit, shared by the no-impact fast path and both
  // of the link-impact modal's non-cancel buttons.
  const performRename = async (oldPath: string, newPath: string, rewriteLinks: boolean) => {
    await requestJson('/api/note/rename', { oldPath, newPath, rewriteLinks });
    setLinkImpact(null);
    if (selected === oldPath) {
      router.push(`/?path=${encodeURIComponent(newPath)}`);
    } else {
      router.refresh();
    }
  };

  // The one entry point for "change this note's path," shared by inline
  // rename, drag-and-drop, and the Move-to dialog — each just computes a
  // different `newPath` and calls this. Checks link impact first; nothing
  // unfixable means nothing here needs a human call (a fixable link is safe
  // by construction, see rewrite.ts), so it proceeds straight through,
  // rewriting whatever's fixable — which may be nothing at all.
  const attemptMove = async (oldPath: string, newPath: string) => {
    if (newPath === oldPath) return;
    try {
      const plan = await requestJson<{ fixable: FixableLink[]; unfixable: UnfixableLink[] }>(
        '/api/note/link-impact',
        { oldPath, newPath },
      );
      if (plan.unfixable.length === 0) {
        await performRename(oldPath, newPath, plan.fixable.length > 0);
        return;
      }
      setLinkImpact({ oldPath, newPath, ...plan, busy: false, error: null });
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : `${renameVerb(oldPath, newPath)} failed.`);
    }
  };

  const confirmRename = (name: string) => {
    const oldPath = renamingPath;
    if (!oldPath) return;
    setRenamingPath(null);
    attemptMove(oldPath, `${dirName(oldPath)}/${name}`);
  };

  const startMove = (path: string) => {
    setRenameError(null);
    setMovingPath(path);
    setContextMenu(null);
  };

  const confirmMove = (destFolder: string) => {
    const oldPath = movingPath;
    if (!oldPath) return;
    setMovingPath(null);
    attemptMove(oldPath, `${destFolder}/${baseName(oldPath)}`);
  };

  // Dropping something currently mid-inline-rename would race the two
  // interactions against the same path — ignored rather than guarded against
  // more elaborately, since it's an edge case a user is unlikely to hit
  // outside of deliberately trying to.
  const handleDrop = (draggedPath: string, targetFolder: string) => {
    if (draggedPath === renamingPath) return;
    setRenameError(null);
    attemptMove(draggedPath, `${targetFolder}/${baseName(draggedPath)}`);
  };

  const resolveLinkImpact = async (rewriteLinks: boolean) => {
    if (!linkImpact) return;
    setLinkImpact({ ...linkImpact, busy: true, error: null });
    try {
      await performRename(linkImpact.oldPath, linkImpact.newPath, rewriteLinks);
    } catch (error) {
      setLinkImpact((prev) =>
        prev ? { ...prev, busy: false, error: error instanceof Error ? error.message : 'Rename failed.' } : prev,
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-200">Notes</p>
            <p className="text-xs text-neutral-500">{noteCount} notes</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => startCreate('file')}
              title="New File"
              aria-label="New File"
              className="rounded p-1 text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
            >
              <PlusFileIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => startCreate('folder')}
              title="New Folder"
              aria-label="New Folder"
              className="rounded p-1 text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
            >
              <PlusFolderIcon className="size-4" />
            </button>
          </div>
        </div>
        {renameError && (
          <div className="flex items-start justify-between gap-2 border-b border-line bg-red-500/10 px-3.5 py-2">
            <p className="text-xs text-red-400">{renameError}</p>
            <button
              type="button"
              onClick={() => setRenameError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-xs text-red-400/70 hover:text-red-400"
            >
              ×
            </button>
          </div>
        )}
        <NoteTree
          nodes={displayTree}
          selected={selected}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          pendingCreate={pendingCreate}
          onCreateConfirm={confirmCreate}
          onCreateCancel={() => setPendingCreate(null)}
          renamingPath={renamingPath}
          onStartRename={startRename}
          onRenameConfirm={confirmRename}
          onRenameCancel={() => setRenamingPath(null)}
          onRowContextMenu={(path, x, y) => setContextMenu({ path, x, y })}
          onDropOnFolder={handleDrop}
        />
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>

      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => startRename(contextMenu.path)}
          onMoveTo={() => startMove(contextMenu.path)}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {movingPath && (
        <MoveToDialog
          path={movingPath}
          folders={moveTargetFolders(movingPath)}
          onConfirm={confirmMove}
          onCancel={() => setMovingPath(null)}
        />
      )}

      {linkImpact && (
        <LinkImpactModal
          oldPath={linkImpact.oldPath}
          newPath={linkImpact.newPath}
          fixable={linkImpact.fixable}
          unfixable={linkImpact.unfixable}
          busy={linkImpact.busy}
          error={linkImpact.error}
          onFix={() => resolveLinkImpact(true)}
          onLeave={() => resolveLinkImpact(false)}
          onCancel={() => setLinkImpact(null)}
        />
      )}
    </div>
  );
}
