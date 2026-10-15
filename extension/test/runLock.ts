// A lock file that lets one test run at a time use VSCodium on this machine.
// It holds the holder's pid, so a run that died without releasing it doesn't
// block the next.

import * as fs from "fs";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Takes the lock at `file` for `owner`, a description for anyone waiting,
 * calling `onWait` once with the holder's if another run holds it. Resolves to
 * a function that releases it.
 */
export async function acquireRunLock(
  file: string,
  owner: string,
  onWait: (holder: string) => void,
  pollMs = 1000
): Promise<() => void> {
  const content = `${process.pid}\n${owner}`;
  let waiting = false;
  for (;;) {
    try {
      fs.writeFileSync(file, content, { flag: "wx" });
      return () => {
        if (readOrEmpty(file) === content) fs.rmSync(file, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // A holder that's still empty after a moment died while writing it.
    const holder = readOrEmpty(file) || (await sleep(100), readOrEmpty(file));
    const [pid, description] = holder.split("\n");
    if (!holder || !alive(Number(pid))) {
      // Another waiter may have replaced the dead run's lock with its own.
      if (readOrEmpty(file) === holder) fs.rmSync(file, { force: true });
      continue;
    }
    if (!waiting) onWait(`${description} (pid ${pid})`);
    waiting = true;
    await sleep(pollMs);
  }
}
