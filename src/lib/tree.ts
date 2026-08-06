export type NoteEntry = { path: string; title: string };

export type FileNode = {
  kind: 'file';
  /** Filename on disk, exact case and extension — what the sidebar shows. */
  name: string;
  /** The note's title, e.g. from frontmatter — shown in the tooltip, not as the label. */
  title: string;
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
    children.push({
      kind: 'file',
      name,
      title: entry.title,
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

/**
 * Every real folder path in the tree — used to tell a client-only pending
 * folder (see `withClientFolder`) apart from one that has since become real
 * (a file was created inside it, the server-fetched tree caught up), so the
 * ephemeral copy can be dropped without waiting for a page reload.
 */
export function folderPathsOf(nodes: readonly TreeNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    paths.add(node.path);
    for (const path of folderPathsOf(node.children)) paths.add(path);
  }
  return paths;
}

/**
 * Splices one client-only empty folder into an already-built tree, as a
 * child of `parentPath`. Folders are only ever created one at a time as a
 * direct child of a folder already visible in the tree (`crud-operations-
 * spec.md`'s decision to keep this client-side-only, never a real empty
 * directory on disk), so this never has to invent missing ancestors —
 * `parentPath` is always either `root` or an existing node.
 */
export function withClientFolder(
  nodes: readonly TreeNode[],
  parentPath: string,
  name: string,
  root = 'notes',
): TreeNode[] {
  return withClientNode(nodes, parentPath, { kind: 'folder', name, path: `${parentPath}/${name}`, hidden: name.startsWith('.'), children: [] }, root);
}

/**
 * Every real note path in the tree — the file-side counterpart to
 * `folderPathsOf`, for the same reason: telling a client-only pending file
 * (see `withClientFile`) apart from one the server-fetched tree has since
 * caught up with.
 */
export function filePathsOf(nodes: readonly TreeNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'file') paths.add(node.path);
    else for (const path of filePathsOf(node.children)) paths.add(path);
  }
  return paths;
}

/**
 * Splices a placeholder row for a just-created, not-yet-on-disk file into
 * the tree. Confirming a file's name in `CreateRow` opens the editor
 * immediately but writes nothing until the first keystroke (see
 * `structural.ts`'s create design), so without this the tree would show
 * *nothing* where the new file should be — the row you were just typing
 * into vanishes and nothing replaces it until the next full refresh, which
 * reads as the create having silently failed even though it didn't.
 *
 * The title is computed the same way a real note with no frontmatter yet
 * would show — the filename stem — so the placeholder previews exactly what
 * `.noteindex.json` will actually say once this note is real.
 */
export function withClientFile(nodes: readonly TreeNode[], parentPath: string, name: string, root = 'notes'): TreeNode[] {
  const path = `${parentPath}/${name}`;
  const dot = name.lastIndexOf('.');
  const stem = dot <= 0 ? name : name.slice(0, dot);
  return withClientNode(nodes, parentPath, { kind: 'file', name, path, title: stem }, root);
}

function withClientNode(
  nodes: readonly TreeNode[],
  parentPath: string,
  toInsert: TreeNode,
  root: string,
): TreeNode[] {
  if (parentPath === root) {
    if (nodes.some((n) => n.name === toInsert.name)) return [...nodes];
    return sortedInsert([...nodes], toInsert);
  }

  return nodes.map((node) => {
    if (node.kind !== 'folder') return node;
    if (node.path === parentPath) {
      if (node.children.some((c) => c.name === toInsert.name)) return node;
      return { ...node, children: sortedInsert([...node.children], toInsert) };
    }
    if (parentPath === node.path || parentPath.startsWith(`${node.path}/`)) {
      return { ...node, children: withClientNode(node.children, parentPath, toInsert, root) };
    }
    return node;
  });
}

function sortedInsert(nodes: TreeNode[], toInsert: TreeNode): TreeNode[] {
  nodes.push(toInsert);
  sort(nodes);
  return nodes;
}
