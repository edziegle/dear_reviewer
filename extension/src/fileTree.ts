// The folders and files of a Change as Change Files lists them: folders
// first, then files, each by name. Like the Explorer with
// `explorer.compactFolders`, a folder whose only child is a folder shows
// as one row, such as `infra/modules/vpc`. Kept apart from `vscode` so the
// unit tests can run it under plain Node.

export type FileTreeNode<F> =
  | {
      kind: "directory";
      /** The folder's path from the repository root. */
      path: string;
      /** What its row shows: its name, or the names of the folders compacted into it. */
      name: string;
      /** Every file under it, shown or not. */
      files: F[];
      children: FileTreeNode<F>[];
    }
  | { kind: "file"; file: F };

interface Directory<F> {
  dirs: Map<string, Directory<F>>;
  files: F[];
}

/**
 * The tree of the files, by their `/`-separated paths, leaving out the
 * files `shown` doesn't show and the folders left empty. With `compact`, a
 * folder whose only child is a folder joins it in one row.
 */
export function fileTree<F extends { path: string }>(
  files: readonly F[],
  {
    compact,
    shown = () => true,
  }: { compact: boolean; shown?: (file: F) => boolean }
): FileTreeNode<F>[] {
  const root: Directory<F> = { dirs: new Map(), files: [] };
  for (const file of files) {
    let dir = root;
    for (const name of file.path.split("/").slice(0, -1)) {
      let next = dir.dirs.get(name);
      if (!next) dir.dirs.set(name, (next = { dirs: new Map(), files: [] }));
      dir = next;
    }
    dir.files.push(file);
  }
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const nodes = (dir: Directory<F>, prefix: string): FileTreeNode<F>[] => {
    const dirs = [...dir.dirs.keys()].sort(byName).flatMap((first) => {
      let name = first;
      let inner = dir.dirs.get(first)!;
      while (compact && inner.files.length === 0 && inner.dirs.size === 1) {
        const [[next, child]] = inner.dirs;
        name = `${name}/${next}`;
        inner = child;
      }
      const path = prefix + name;
      const children = nodes(inner, `${path}/`);
      if (children.length === 0) return [];
      return [
        {
          kind: "directory" as const,
          path,
          name,
          files: files.filter((f) => f.path.startsWith(`${path}/`)),
          children,
        },
      ];
    });
    const shownFiles = dir.files
      .filter(shown)
      .sort((a, b) => byName(a.path, b.path))
      .map((file) => ({ kind: "file" as const, file }));
    return [...dirs, ...shownFiles];
  };
  return nodes(root, "");
}
