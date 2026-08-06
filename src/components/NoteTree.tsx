'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ChevronIcon, FolderIcon, FolderOpenIcon, MoreIcon, NoteIcon } from '@/components/icons';
import { dirName } from '@/lib/paths';
import { ancestorsOf, type TreeNode } from '@/lib/tree';

export type PendingCreate = { parentPath: string; kind: 'file' | 'folder' } | null;

const DRAG_MIME = 'application/x-note-path';

/**
 * The note tree.
 *
 * Three things carry the hierarchy, because at five folders deep no single one
 * of them is enough: an indent guide per level, an icon that distinguishes a
 * folder from a note at a glance, and a weight/colour difference between the
 * two.
 *
 * Rows show the note's **filename**, not a frontmatter title. Every wiki-link
 * tool that inspired this one — Obsidian, Logseq, TiddlyWiki — shows the
 * identifier you'd actually type or click by default; substituting a separate
 * "nicer" title is opt-in there (a plugin, an explicit alias), never automatic,
 * because a note-taking app silently relabeling files breaks the direct link
 * between what's on disk and what's on screen. The four `todo.md`s are told
 * apart by their folder, same as any filesystem browser. The title is one
 * hover away, not the headline.
 */
export default function NoteTree({
  nodes,
  selected,
  selectedFolder,
  onSelectFolder,
  pendingCreate,
  onCreateConfirm,
  onCreateCancel,
  renamingPath,
  onStartRename,
  onRenameConfirm,
  onRenameCancel,
  onRowContextMenu,
  onDropOnFolder,
}: {
  nodes: TreeNode[];
  selected?: string;
  selectedFolder: string;
  onSelectFolder: (path: string) => void;
  pendingCreate: PendingCreate;
  onCreateConfirm: (name: string) => void;
  onCreateCancel: () => void;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onRenameConfirm: (name: string) => void;
  onRenameCancel: () => void;
  onRowContextMenu: (path: string, x: number, y: number) => void;
  onDropOnFolder: (draggedPath: string, targetFolder: string) => void;
}) {
  // Everything starts open: the whole tree fits, and the hidden `.scratch`
  // folder should be visible on arrival rather than something to go hunting for.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [revealed, setRevealed] = useState(selected);
  // Which row (or the root itself) is the current drag hovering over, and
  // which row is being dragged — both purely presentational, so they live
  // here rather than in `AppShell`.
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  // Opening a deep note reveals it, even if its folder was collapsed.
  //
  // Two constraints pull against each other here. It has to *change* the
  // collapsed set rather than override it at render time: forcing the open
  // note's ancestors open on every render would make them impossible to
  // collapse, since the click would update state that the render then ignored.
  // But it also cannot be an effect, because that renders once with the folder
  // still shut and again with it open.
  //
  // Adjusting state during render when a prop changes is the sanctioned answer
  // to exactly this: React discards the in-progress render and redoes it before
  // touching the DOM, so there is no flash and no cascading re-render.
  if (selected !== revealed) {
    setRevealed(selected);
    if (selected) {
      setCollapsed((previous) => {
        const next = new Set(previous);
        const opened = ancestorsOf(selected).filter((folder) => next.delete(folder));
        return opened.length > 0 ? next : previous;
      });
    }
  }

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const drop = (event: React.DragEvent, targetFolder: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverPath(null);
    const draggedPath = event.dataTransfer.getData(DRAG_MIME);
    if (draggedPath) onDropOnFolder(draggedPath, targetFolder);
  };

  const rowProps = {
    selected,
    selectedFolder,
    onSelectFolder,
    collapsed,
    onToggle: toggle,
    pendingCreate,
    onCreateConfirm,
    onCreateCancel,
    renamingPath,
    onStartRename,
    onRenameConfirm,
    onRenameCancel,
    onRowContextMenu,
    dragOverPath,
    setDragOverPath,
    draggingPath,
    setDraggingPath,
    drop,
  };

  return (
    <ul
      className={`min-h-full py-1.5 ${dragOverPath === 'notes' ? 'bg-accent-subtle' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOverPath('notes');
      }}
      onDragLeave={() => setDragOverPath((prev) => (prev === 'notes' ? null : prev))}
      onDrop={(event) => drop(event, 'notes')}
    >
      {pendingCreate?.parentPath === 'notes' && (
        <CreateRow
          kind={pendingCreate.kind}
          siblingNames={nodes.map((n) => n.name)}
          onConfirm={onCreateConfirm}
          onCancel={onCreateCancel}
        />
      )}
      {nodes.map((node) => (
        <Row key={node.path} node={node} siblingNames={nodes.map((n) => n.name)} {...rowProps} />
      ))}
    </ul>
  );
}

type RowProps = {
  node: TreeNode;
  siblingNames: string[];
  selected?: string;
  selectedFolder: string;
  onSelectFolder: (path: string) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  pendingCreate: PendingCreate;
  onCreateConfirm: (name: string) => void;
  onCreateCancel: () => void;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onRenameConfirm: (name: string) => void;
  onRenameCancel: () => void;
  onRowContextMenu: (path: string, x: number, y: number) => void;
  dragOverPath: string | null;
  setDragOverPath: React.Dispatch<React.SetStateAction<string | null>>;
  draggingPath: string | null;
  setDraggingPath: React.Dispatch<React.SetStateAction<string | null>>;
  drop: (event: React.DragEvent, targetFolder: string) => void;
};

function Row({ node, siblingNames, ...rest }: RowProps) {
  const {
    selected,
    selectedFolder,
    onSelectFolder,
    collapsed,
    onToggle,
    pendingCreate,
    onCreateConfirm,
    onCreateCancel,
    renamingPath,
    onStartRename,
    onRenameConfirm,
    onRenameCancel,
    onRowContextMenu,
    dragOverPath,
    setDragOverPath,
    draggingPath,
    setDraggingPath,
    drop,
  } = rest;

  if (node.kind === 'file') {
    if (node.path === renamingPath) {
      // `CreateRow` renders its own `<li>` — no wrapper here, or the DOM
      // ends up with a `<li>` nested directly inside another `<li>`, which
      // is invalid HTML and breaks hydration.
      return (
        <CreateRow
          kind="file"
          initialName={node.name}
          siblingNames={siblingNames.filter((n) => n !== node.name)}
          onConfirm={onRenameConfirm}
          onCancel={onRenameCancel}
        />
      );
    }
    return (
      <NoteRow
        node={node}
        selected={selected}
        onSelectFolder={onSelectFolder}
        onStartRename={onStartRename}
        onContextMenu={onRowContextMenu}
        isDragOver={dragOverPath === node.path}
        isDragging={draggingPath === node.path}
        onDragOverRow={() => setDragOverPath(node.path)}
        onDragLeaveRow={() => setDragOverPath((prev: string | null) => (prev === node.path ? null : prev))}
        onDropRow={(event) => drop(event, dirName(node.path))}
        onDragStartRow={() => setDraggingPath(node.path)}
        onDragEndRow={() => setDraggingPath(null)}
      />
    );
  }

  const isOpen = !collapsed.has(node.path);
  const isTarget = node.path === selectedFolder;
  const isDragOver = dragOverPath === node.path;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onToggle(node.path);
          onSelectFolder(node.path);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOverPath(node.path);
        }}
        onDragLeave={(event) => {
          event.stopPropagation();
          setDragOverPath((prev: string | null) => (prev === node.path ? null : prev));
        }}
        onDrop={(event) => drop(event, node.path)}
        aria-expanded={isOpen}
        title={node.path}
        className={`group flex w-full items-center gap-1.5 rounded-r py-[5px] pr-2 pl-1.5 text-left transition-colors hover:bg-white/5 ${
          isTarget ? 'bg-white/5' : ''
        } ${isDragOver ? 'bg-accent-subtle ring-1 ring-inset ring-accent' : ''} ${
          node.hidden ? 'text-neutral-500' : 'text-neutral-300'
        }`}
      >
        <ChevronIcon
          className={`size-3.5 shrink-0 text-neutral-600 transition-transform duration-150 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        {isOpen ? (
          <FolderOpenIcon className="size-4 shrink-0 text-accent/70" />
        ) : (
          <FolderIcon className="size-4 shrink-0 text-neutral-500" />
        )}
        {/* min-w-0 lets the label shrink instead of shoving the badges past
            the edge of the sidebar — a flex item refuses to shrink below its
            content width without it. */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        {node.hidden && (
          <span className="shrink-0 rounded border border-dashed border-neutral-700 px-1 text-[10px] text-neutral-500">
            hidden
          </span>
        )}
      </button>

      {isOpen && (
        // The guide line. One border per level is what makes depth readable
        // without the indent eating the whole sidebar.
        <ul className="ml-[13px] border-l border-line">
          {pendingCreate?.parentPath === node.path && (
            <CreateRow
              kind={pendingCreate.kind}
              siblingNames={node.children.map((n) => n.name)}
              onConfirm={onCreateConfirm}
              onCancel={onCreateCancel}
            />
          )}
          {node.children.map((child) => (
            <Row key={child.path} node={child} siblingNames={node.children.map((n) => n.name)} {...rest} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NoteRow({
  node,
  selected,
  onSelectFolder,
  onStartRename,
  onContextMenu,
  isDragOver,
  isDragging,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  onDragStartRow,
  onDragEndRow,
}: {
  node: Extract<TreeNode, { kind: 'file' }>;
  selected?: string;
  onSelectFolder: (path: string) => void;
  onStartRename: (path: string) => void;
  onContextMenu: (path: string, x: number, y: number) => void;
  isDragOver: boolean;
  isDragging: boolean;
  onDragOverRow: () => void;
  onDragLeaveRow: () => void;
  onDropRow: (event: React.DragEvent) => void;
  onDragStartRow: () => void;
  onDragEndRow: () => void;
}) {
  const isSelected = node.path === selected;

  return (
    <li
      className={`group/row relative ${isDragOver ? 'bg-accent-subtle ring-1 ring-inset ring-accent' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, node.path);
        event.dataTransfer.setData('text/plain', node.path);
        event.dataTransfer.effectAllowed = 'move';
        onDragStartRow();
      }}
      onDragEnd={onDragEndRow}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        onDragOverRow();
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        onDragLeaveRow();
      }}
      onDrop={onDropRow}
    >
      <Link
        href={`/?path=${encodeURIComponent(node.path)}`}
        onClick={() => onSelectFolder(dirName(node.path))}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(node.path, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            onStartRename(node.path);
          }
        }}
        // Title and full path on hover: the filename is what you read, the
        // title is the extra context, the path is what the app actually
        // operates on.
        title={`${node.title}\n${node.path}`}
        aria-current={isSelected ? 'page' : undefined}
        className={`flex items-center gap-1.5 rounded-r border-l-2 py-[5px] pr-7 pl-[13px] transition-colors ${
          isDragging ? 'opacity-40' : ''
        } ${
          isSelected
            ? 'border-accent bg-accent-subtle text-accent'
            : 'border-transparent text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
        }`}
      >
        <NoteIcon
          className={`size-4 shrink-0 ${isSelected ? 'text-accent' : 'text-neutral-600'}`}
        />
        <span className={`min-w-0 truncate font-mono text-sm ${isSelected ? 'font-medium' : ''}`}>
          {node.name}
        </span>
      </Link>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu(node.path, rect.left, rect.bottom);
        }}
        aria-label={`Actions for ${node.name}`}
        className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-0.5 text-neutral-500 hover:bg-white/10 hover:text-neutral-200 group-hover/row:block"
      >
        <MoreIcon className="size-3.5" />
      </button>
    </li>
  );
}

/**
 * The inline name input shared by Create and Rename. Create: no default name
 * (confirmed against VS Code's own explorer — a blank editable row, nothing
 * pre-filled). Rename: prefilled with the current name, but only the **stem**
 * selected — Explorer/Finder/VS Code's shared convention, so confirming
 * without retyping anything can't accidentally clobber the extension.
 *
 * Live case-insensitive duplicate check against the target folder's already-
 * loaded siblings (no round trip needed), Enter disabled while it conflicts.
 */
function CreateRow({
  kind,
  initialName,
  siblingNames,
  onConfirm,
  onCancel,
}: {
  kind: 'file' | 'folder';
  initialName?: string;
  siblingNames: string[];
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialName) {
      const dot = initialName.lastIndexOf('.');
      const stemEnd = dot <= 0 ? initialName.length : dot;
      el.setSelectionRange(0, stemEnd);
    }
    // Only run once, on mount — retyping shouldn't reselect anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  const lowerSiblings = new Set(siblingNames.map((n) => n.toLowerCase()));
  const conflict = trimmed !== '' && lowerSiblings.has(trimmed.toLowerCase());

  const submit = () => {
    if (trimmed === '' || conflict) return;
    submittedRef.current = true;
    onConfirm(trimmed);
  };

  return (
    <li className="pl-[13px]">
      <div className="-ml-[2px] flex items-center gap-1.5 border-l-2 border-transparent py-[5px] pr-2">
        {kind === 'folder' ? (
          <FolderIcon className="size-4 shrink-0 text-neutral-500" />
        ) : (
          <NoteIcon className="size-4 shrink-0 text-neutral-600" />
        )}
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') onCancel();
          }}
          onBlur={() => {
            if (!submittedRef.current) onCancel();
          }}
          placeholder={kind === 'folder' ? 'Folder name' : 'File name'}
          aria-invalid={conflict}
          className={`min-w-0 flex-1 rounded border bg-transparent px-1.5 py-0.5 font-mono text-sm text-neutral-200 outline-none ${
            conflict ? 'border-red-500/60' : 'border-line focus:border-accent'
          }`}
        />
      </div>
      {conflict && (
        <p className="pl-[26px] text-[11px] text-red-400">
          &ldquo;{trimmed}&rdquo; already exists here
        </p>
      )}
    </li>
  );
}
