// Which file Next and Previous Unviewed File move to. Kept apart from
// `vscode` so the unit tests can run it under plain Node.

/**
 * The next file not yet viewed after `from`, or the one before it when
 * `direction` is -1, in the order given, going round at the end. From no
 * file, the first or last. Skim-only files (ADR 0045) are passed over unless
 * `visitSkimOnly` is set, or unless every file left unviewed is skim-only, so
 * the keys still lead somewhere.
 */
export function unviewedAfter<T extends { path: string }>(input: {
  files: readonly T[];
  viewed: ReadonlySet<string>;
  skimOnly: ReadonlySet<string>;
  from: string | undefined;
  direction: 1 | -1;
  visitSkimOnly: boolean;
}): T | undefined {
  const { files, viewed, skimOnly, from, direction } = input;
  const start = from ? files.findIndex((f) => f.path === from) : -1;
  const scan = (accepts: (file: T) => boolean): T | undefined => {
    for (let step = 1; step <= files.length; step++) {
      const i =
        start === -1
          ? direction === 1
            ? step - 1
            : files.length - step
          : (start + direction * step + files.length * step) % files.length;
      const file = files[i];
      if (file.path !== from && accepts(file)) return file;
    }
  };
  const unviewed = (file: T) => !viewed.has(file.path);
  return (
    scan(
      (file) =>
        unviewed(file) && (input.visitSkimOnly || !skimOnly.has(file.path))
    ) ?? scan(unviewed)
  );
}
