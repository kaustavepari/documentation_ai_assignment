'use client';

import { useEffect, useRef } from 'react';

import { MoveIcon, PencilIcon, TrashIcon } from '@/components/icons';

/**
 * Per-row actions for a note: Rename, Move to…, Delete — file-only
 * (`crud-operations-spec.md`'s decided scope; folder rows never render
 * this). Anchored at fixed `x, y` coordinates rather than the document
 * flow, the same pattern `AmbiguousLinkOverlay`/`LinksMenu` already use, so
 * it works identically whether it opened from a right-click or the row's
 * hover-visible "more" button.
 *
 * Each action is optional so this one component can be reused as later
 * phases (Move, Delete) wire in their own handlers without a rewrite.
 */
export default function RowContextMenu({
  x,
  y,
  onRename,
  onMoveTo,
  onDelete,
  onDismiss,
}: {
  x: number;
  y: number;
  onRename?: () => void;
  onMoveTo?: () => void;
  onDelete?: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onScroll = () => onDismiss();

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: x, top: y + 4 }}
      className="z-50 min-w-36 rounded-md border border-line bg-surface py-1 shadow-lg"
    >
      {onRename && (
        <MenuItem icon={<PencilIcon className="size-3.5" />} label="Rename" onClick={onRename} />
      )}
      {onMoveTo && (
        <MenuItem icon={<MoveIcon className="size-3.5" />} label="Move to…" onClick={onMoveTo} />
      )}
      {onDelete && (
        <MenuItem
          icon={<TrashIcon className="size-3.5" />}
          label="Delete"
          onClick={onDelete}
          destructive
        />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/5 ${
        destructive ? 'text-red-400' : 'text-neutral-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
