import { EditorState, Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

import { parseLinks } from '@/lib/links/parse';
import { resolveLink } from '@/lib/links/resolve';
import type { ResolvedLink } from '@/lib/links/types';

export type AmbiguousLink = Extract<ResolvedLink, { state: 'ambiguous' }>;

export type LinkDecorationContext = {
  sourcePath: string;
  notePaths: string[];
  repoFiles: string[];
  onNavigate: (path: string) => void;
  onAmbiguous: (link: AmbiguousLink, coords: { x: number; y: number }) => void;
};

const linkContext = Facet.define<LinkDecorationContext, LinkDecorationContext>({
  combine: (values) => values[values.length - 1],
});

const setLinkDecorations = StateEffect.define<DecorationSet>();

const linkDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setLinkDecorations)) decorations = effect.value;
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** `null` for malformed/external — they never get painted, per the case matrix. */
function classFor(link: ResolvedLink): string | null {
  if (link.state === 'resolved') return 'cm-link-resolved';
  if (link.state === 'broken') return 'cm-link-broken';
  if (link.state === 'ambiguous') return 'cm-link-ambiguous';
  return null;
}

/**
 * Same wording VS Code itself uses for a followable link ("⌘-click to follow
 * link" / "Ctrl-click to follow link") — the modifier this app's click
 * handler actually requires, so the hover text should say so rather than
 * leaving a resolved link with no affordance until someone tries clicking it.
 */
function navigateHint(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? '⌘-click to open' : 'Ctrl-click to open';
}

function hoverText(link: ResolvedLink): string {
  if (link.state === 'broken') {
    return link.type === 'wiki' ? `No note matches "${link.target}"` : `Nothing at "${link.target}"`;
  }
  if (link.state === 'ambiguous') return `${link.candidates.length} notes match — click to choose`;
  if (link.state === 'resolved' && link.resolvedKind === 'note') {
    return `${navigateHint()} — ${link.resolvedPath}`;
  }
  return '';
}

function computeDecorations(state: EditorState): DecorationSet {
  const ctx = state.facet(linkContext);
  const content = state.doc.toString();
  const links = parseLinks(content).map((link) =>
    resolveLink(ctx.sourcePath, link, { notePaths: ctx.notePaths, repoFiles: ctx.repoFiles }),
  );

  const decorations = links
    .map((link) => {
      const cls = classFor(link);
      if (!cls) return null;
      return Decoration.mark({ class: cls, attributes: { title: hoverText(link) }, link }).range(
        link.from,
        link.to,
      );
    })
    .filter((range) => range !== null);

  return Decoration.set(decorations, true);
}

const DEBOUNCE_MS = 150;

/**
 * Recomputes and repaints link decorations a short beat after the doc stops
 * changing — independent of the editor's own 800ms autosave debounce, since
 * this repaints the DOM (wants to feel immediate) rather than writing to
 * disk (doesn't need to).
 */
const linkDecorationsPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule(update.view);
    }

    private schedule(view: EditorView) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        view.dispatch({ effects: setLinkDecorations.of(computeDecorations(view.state)) });
      }, DEBOUNCE_MS);
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

/**
 * Ctrl/Cmd+Click on a resolved note link navigates. A plain click on an
 * ambiguous link opens the disambiguation overlay (no modifier needed — it
 * isn't navigable on its own, so there's nothing a plain click would
 * otherwise "lose"). Every other click — including plain-click on a
 * resolved link — falls through to CodeMirror's normal cursor placement,
 * so text inside a link is always still editable.
 */
function clickHandler(event: MouseEvent, view: EditorView): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;

  // Collected into an array rather than a mutated `let`: TS's control-flow
  // narrowing doesn't see through a closure's reassignment of an outer
  // variable, so a scalar `hit` would type-narrow to `never` below.
  const hits: ResolvedLink[] = [];
  view.state.field(linkDecorationField).between(pos, pos, (_from, _to, deco) => {
    const link = (deco.spec as { link?: ResolvedLink }).link;
    if (link) hits.push(link);
  });
  const hit = hits[0];
  if (!hit) return false;

  const ctx = view.state.facet(linkContext);

  if (hit.state === 'ambiguous') {
    event.preventDefault();
    const coords = view.coordsAtPos(hit.from);
    if (coords) ctx.onAmbiguous(hit, { x: coords.left, y: coords.bottom });
    return true;
  }

  if (hit.state === 'resolved' && hit.resolvedKind === 'note' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    ctx.onNavigate(hit.resolvedPath);
    return true;
  }

  return false;
}

const linkTheme = EditorView.theme({
  '.cm-link-resolved': {
    color: 'var(--color-accent)',
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-link-broken': {
    color: '#f87171',
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
  },
  '.cm-link-ambiguous': {
    color: '#fbbf24',
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    cursor: 'pointer',
  },
});

export function linkDecorations(ctx: LinkDecorationContext) {
  return [
    linkContext.of(ctx),
    linkDecorationField,
    linkDecorationsPlugin,
    EditorView.domEventHandlers({ mousedown: clickHandler }),
    linkTheme,
  ];
}
