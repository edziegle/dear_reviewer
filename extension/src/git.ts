import { execFile } from "child_process";
import { promisify } from "util";

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
  try {
    const { stdout } = await run("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new GitError(args, stderr);
  }
}
