// How far the Reviewer is through a Change's files, as the Change's row in
// Change Files shows it: a bar and a count, such as "■■■□□□□ 3/7", and the
// same in words for a screen reader. Kept apart from `vscode` so the unit
// tests can run it under plain Node.

const segments = 7;

export interface ViewedProgress {
  /** The bar, then the count. */
  text: string;
  /** Such as "3 of 7 files viewed". */
  label: string;
}

/**
 * The bar has as many segments whatever the number of files. Any viewed file
 * fills at least one, and it is full only once every file is viewed.
 */
export function viewedProgress(viewed: number, total: number): ViewedProgress {
  const filled =
    viewed <= 0 || total <= 0
      ? 0
      : viewed >= total
        ? segments
        : Math.min(
            segments - 1,
            Math.max(1, Math.round((viewed / total) * segments))
          );
  const bar = "■".repeat(filled) + "□".repeat(segments - filled);
  return {
    text: `${bar} ${viewed}/${total}`,
    label: `${viewed} of ${total} ${total === 1 ? "file" : "files"} viewed`,
  };
}
