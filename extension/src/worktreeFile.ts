// Reading a file of a Change's worktree by a path a person or the Assistant
// gave, which can lead out of the worktree (`..`, or a symbolic link).

import * as fs from "fs";
import * as path from "path";

/**
 * The file at `given`, a path from the worktree's root, with its path as the
 * repository has it and its text. Gives nothing if the path leaves the
 * worktree, also through a symbolic link, or isn't a file that can be read.
 */
export async function readInWorktree(
  dir: string,
  given: string
): Promise<{ path: string; text: string } | undefined> {
  const file = path.resolve(dir, given);
  const relative = path.relative(dir, file);
  if (!isInside(relative)) return;
  try {
    const real = fs.realpathSync(file);
    if (!isInside(path.relative(fs.realpathSync(dir), real))) return;
    return {
      path: relative.split(path.sep).join("/"),
      text: await fs.promises.readFile(real, "utf8"),
    };
  } catch {
    return;
  }
}

/** How many lines the text has: one for each line break, and one for text after the last. */
export function countLines(text: string): number {
  return text.split("\n").length - (text === "" || text.endsWith("\n") ? 1 : 0);
}

function isInside(relative: string): boolean {
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
