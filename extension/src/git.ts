import { execFile } from "child_process";
import { promisify } from "util";
import { messageOf } from "./errors";

const run = promisify(execFile);

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly stderr: string
  ) {
    super(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await gitOutput(cwd, ...args)).trim();
}

/** Git's output as it is, such as a file's text with its last newline. */
export async function gitOutput(
  cwd: string,
  ...args: string[]
): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    // A missing cwd fails the spawn itself, with no stderr.
    const stderr = (err as { stderr?: string }).stderr || messageOf(err);
    throw new GitError(args, stderr);
  }
}
