import { rawExtensionOf } from './paths';

export type NoteEntry = { path: string; title: string };

export type FileNode = {
  kind: 'file';
  /** Filename on disk — shown in the tooltip, not as the label. */
  name: string;
  /** What the sidebar actually shows. */
  title: string;
  /** Exact extension, e.g. `.MD`. Empty when it is a plain `.md`. */
  badge: string;
  path: string;
};

export type FolderNode = {
  kind: 'folder';
  name: string;
  path: string;
  /** Dotfolders like `.scratch` are shown, but marked and sorted last. */
  hidden: boolean;
  children: TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

/**
 * Turn the flat list of notes into the nested structure the sidebar renders.
 *
 * Derived from the note list on every request rather than stored — with 36
 * notes a cache buys nothing and is one more thing that can disagree with the
 * repo.
 *
 * Nodes carry the full repo-relative path because that is the only unique
 * identifier available: `todo.md` and `index.md` each appear four times, and
 * two notes are called `notes.md`.
 */
export function buildTree(entries: NoteEntry[], root = 'notes'): TreeNode[] {
  const top: TreeNode[] = [];

  for (const entry of entries) {
    const segments = entry.path.split('/');
    let children = top;

    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      const folderPath = segments.slice(0, i + 1).join('/');
      let folder = children.find(
        (node): node is FolderNode => node.kind === 'folder' && node.name === name,
      );
      if (!folder) {
        folder = {
          kind: 'folder',
          name,
          path: folderPath,
          hidden: name.startsWith('.'),
          children: [],
        };
        children.push(folder);
      }
      children = folder.children;
    }

    const name = segments[segments.length - 1];
    const extension = rawExtensionOf(name);
    children.push({
      kind: 'file',
      name,
      title: entry.title,
      // `.md` is the norm here and labelling 31 of 36 files with it is noise.
      // Anything else is genuinely a different kind of file and says so.
      badge: extension === '.md' ? '' : extension,
      path: entry.path,
    });
  }

  sort(top);

  // The `notes/` wrapper is noise — every note is inside it.
  const wrapper = top.find((node) => node.kind === 'folder' && node.path === root);
  return wrapper && wrapper.kind === 'folder' ? wrapper.children : top;
}

/** Folders, then notes, then hidden folders at the bottom; alphabetical within each. */
function sort(nodes: TreeNode[]): void {
  const rank = (node: TreeNode) =>
    node.kind === 'folder' ? (node.hidden ? 2 : 0) : 1;

  nodes.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  for (const node of nodes) {
    if (node.kind === 'folder') sort(node.children);
  }
}

/** Folders on the way to a note, so opening a deep note reveals it. */
export function ancestorsOf(notePath: string): string[] {
  const segments = notePath.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}
