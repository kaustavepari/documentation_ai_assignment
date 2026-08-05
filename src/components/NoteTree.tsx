'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ChevronIcon, FolderIcon, FolderOpenIcon, NoteIcon } from '@/components/icons';
import { ancestorsOf, type TreeNode } from '@/lib/tree';

/**
 * The note tree.
 *
 * Three things carry the hierarchy, because at five folders deep no single one
 * of them is enough: an indent guide per level, an icon that distinguishes a
 * folder from a note at a glance, and a weight/colour difference between the
 * two.
 *
 * Rows show the note's **title**, not its filename. Thirty-two of the 36 notes
 * have a real title, and "Incident Report: Database Failover — Aug 12, 2024"
 * is far easier to scan than `incident-2024-08-12.md`. The four `todo.md`s are
 * told apart by their titles and their folder; the filename and full path are
 * one hover away.
 */
export default function NoteTree({ nodes, selected }: { nodes: TreeNode[]; selected?: string }) {
  // Everything starts open: the whole tree fits, and the hidden `.scratch`
  // folder should be visible on arrival rather than something to go hunting for.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Opening a deep note reveals it, even if its folder was collapsed.
  //
  // This has to *change* the collapsed set rather than override it at render
  // time: forcing the open note's ancestors open on every render would make
  // them impossible to collapse, since the click would update state that the
  // render then ignored.
  useEffect(() => {
    if (!selected) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      const opened = ancestorsOf(selected).filter((folder) => next.delete(folder));
      return opened.length > 0 ? next : previous;
    });
  }, [selected]);

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <ul className="py-1.5">
      {nodes.map((node) => (
        <Row
          key={node.path}
          node={node}
          selected={selected}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}

type RowProps = {
  node: TreeNode;
  selected?: string;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
};

function Row({ node, selected, collapsed, onToggle }: RowProps) {
  if (node.kind === 'file') return <NoteRow node={node} selected={selected} />;

  const isOpen = !collapsed.has(node.path);

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        aria-expanded={isOpen}
        title={node.path}
        className={`group flex w-full items-center gap-1.5 rounded-r py-[5px] pr-2 pl-1.5 text-left transition-colors hover:bg-white/5 ${
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
          {node.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              selected={selected}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NoteRow({
  node,
  selected,
}: {
  node: Extract<TreeNode, { kind: 'file' }>;
  selected?: string;
}) {
  const isSelected = node.path === selected;

  return (
    <li>
      <Link
        href={`/?path=${encodeURIComponent(node.path)}`}
        // Filename and full path on hover: the title is what you read, the
        // path is what the app actually operates on.
        title={`${node.name}\n${node.path}`}
        aria-current={isSelected ? 'page' : undefined}
        className={`group -ml-[2px] flex items-center gap-1.5 rounded-r border-l-2 py-[5px] pr-2 pl-[13px] transition-colors ${
          isSelected
            ? 'border-accent bg-accent-subtle text-accent'
            : 'border-transparent text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
        }`}
      >
        <NoteIcon
          className={`size-4 shrink-0 ${isSelected ? 'text-accent' : 'text-neutral-600'}`}
        />
        {/* The extension lives inside the label rather than beside it, so it
            aligns with the title by construction and the pair truncates as one
            thing. Only the five non-`.md` notes carry it — tagging the other
            31 `.md` would be noise; the exceptions are the informative part. */}
        <span className={`min-w-0 truncate text-sm ${isSelected ? 'font-medium' : ''}`}>
          {node.title}
          {node.badge && (
            <span
              className={`font-mono text-[10px] ${
                isSelected ? 'text-accent/60' : 'text-neutral-600'
              }`}
            >
              {' '}
              {node.badge}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
