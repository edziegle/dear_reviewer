// Takes screenshots of the test window, on macOS, for the screenshots suite.
// The window must be on screen, which `mise run screenshots` arranges: the
// other suites run it hidden. Its traps: `screencapture` needs the terminal to
// have Screen Recording permission, and resizing needs Accessibility
// permission; a window left at its own size still gets captured.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { testWindowPids } from "../runPlan";

/** Where the screenshots go, when this run takes them. */
export function screenshotDir(): string {
  const dir = process.env.DEAR_REVIEWER_SCREENSHOTS;
  if (!dir) throw new Error("DEAR_REVIEWER_SCREENSHOTS is not set");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function windowPids(): number[] {
  const userData = process.env.DEAR_REVIEWER_USER_DATA;
  if (!userData) throw new Error("DEAR_REVIEWER_USER_DATA is not set");
  const ps = cp.execFileSync("ps", ["-A", "-o", "pid=,args="], {
    encoding: "utf8",
  });
  const pids = testWindowPids(ps, userData);
  if (pids.length === 0) throw new Error("the test window isn't running");
  return pids;
}

const windowIdScript = `
ObjC.import("CoreGraphics");
function run([pids]) {
  const owners = pids.split(",").map(Number);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)));
  const mine = list.filter(w => owners.includes(w.kCGWindowOwnerPID) && w.kCGWindowLayer === 0);
  mine.sort((a, b) => b.kCGWindowBounds.Width * b.kCGWindowBounds.Height - a.kCGWindowBounds.Width * a.kCGWindowBounds.Height);
  return mine.length ? String(mine[0].kCGWindowNumber)
    : "none; windows: " + JSON.stringify(list.filter(w => /codium/i.test(w.kCGWindowOwnerName)).map(w => [w.kCGWindowOwnerName, w.kCGWindowOwnerPID, w.kCGWindowLayer]));
}`;

function windowId(): string {
  const id = cp
    .execFileSync(
      "osascript",
      ["-l", "JavaScript", "-e", windowIdScript, windowPids().join(",")],
      { encoding: "utf8" }
    )
    .trim();
  if (!/^\d+$/.test(id))
    throw new Error(`the test window ${windowPids()} isn't on screen: ${id}`);
  return id;
}

/** Moves and resizes the window, so every screenshot has the same frame. */
export function sizeWindow(width: number, height: number): void {
  try {
    cp.execFileSync("osascript", [
      "-e",
      `tell application "System Events" to tell (first process whose frontmost is true) to tell window 1
        set position to {40, 40}
        set size to {${width}, ${height}}
      end tell`,
    ]);
  } catch (err) {
    console.warn(`Couldn't resize the window: ${(err as Error).message}`);
  }
}

/** Lets the window finish drawing what the last command changed. */
export const settle = (ms = 1500) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Saves the window as `<name>.png` in the screenshots folder, without its shadow. */
export async function capture(name: string): Promise<string> {
  await settle();
  const file = path.join(screenshotDir(), `${name}.png`);
  cp.execFileSync("screencapture", ["-o", "-x", "-l", windowId(), file]);
  console.log(`Captured ${file}`);
  return file;
}
