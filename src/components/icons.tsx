/**
 * Inline SVG only — no icon font, no CDN. Sixteen-pixel grid, drawn as strokes
 * so they inherit `currentColor` and sit correctly beside text.
 */

type IconProps = { className?: string };

export function FolderIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
    </svg>
  );
}

export function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H14V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
    </svg>
  );
}

export function NoteIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 2.5C4 1.95 4.45 1.5 5 1.5H9.5L12.5 4.5V13.5C12.5 14.05 12.05 14.5 11.5 14.5H5C4.45 14.5 4 14.05 4 13.5V2.5Z" />
      <path d="M9.5 1.5V4.5H12.5" />
    </svg>
  );
}

/** Triangle + exclamation. Shared by broken and ambiguous links — both mean
 *  "needs attention"; the distinction is color and wording, not icon. */
export function WarningIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2L14.5 13H1.5L8 2Z" strokeLinecap="round" />
      <path d="M8 6.5V9.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Two chain links on a diagonal — the header trigger for a note's link list. */
export function LinkIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.5 9.5L9.5 6.5" />
      <path d="M7 4.5L8.2 3.3C9.16 2.34 10.72 2.34 11.68 3.3C12.64 4.26 12.64 5.82 11.68 6.78L10.46 8" />
      <path d="M9 11.5L7.8 12.7C6.84 13.66 5.28 13.66 4.32 12.7C3.36 11.74 3.36 10.18 4.32 9.22L5.54 8" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5L10.5 8L6 12.5" />
    </svg>
  );
}

/** `NoteIcon`'s page shape with a plus inside — the "new file" action. */
export function PlusFileIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 2.5C4 1.95 4.45 1.5 5 1.5H9.5L12.5 4.5V13.5C12.5 14.05 12.05 14.5 11.5 14.5H5C4.45 14.5 4 14.05 4 13.5V2.5Z" />
      <path d="M9.5 1.5V4.5H12.5" />
      <path d="M8.25 7.5V11.5M6.25 9.5H10.25" strokeLinecap="round" />
    </svg>
  );
}

/** `FolderIcon`'s shape with a plus inside — the "new folder" action. */
export function PlusFolderIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
      <path d="M8 7.5V11M6.25 9.25H9.75" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 4.5H13.5" />
      <path d="M5.5 4.5V3C5.5 2.45 5.95 2 6.5 2H9.5C10.05 2 10.5 2.45 10.5 3V4.5" />
      <path d="M3.5 4.5L4.2 13C4.24 13.55 4.7 14 5.25 14H10.75C11.3 14 11.76 13.55 11.8 13L12.5 4.5" />
      <path d="M6.5 7V11.5M9.5 7V11.5" />
    </svg>
  );
}

/** A folder with an arrow pointing in — "Move to…". */
export function MoveIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7 5.5H12.5C13.33 5.5 14 6.17 14 7V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V5.5Z" />
      <path d="M6 9.5H10.5M10.5 9.5L8.75 7.75M10.5 9.5L8.75 11.25" />
    </svg>
  );
}

/** A pencil — the "Rename" action. */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.5 2.5L13.5 5.5L5.5 13.5H2.5V10.5L10.5 2.5Z" />
      <path d="M8.75 4.25L11.75 7.25" />
    </svg>
  );
}

/** Vertical kebab dots — the per-row context-menu trigger. */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <circle cx="8" cy="3.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
