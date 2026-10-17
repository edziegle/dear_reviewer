// Stands in for the VSCodium executable: launches the app hidden with `open -g -j`
// so it doesn't take focus from whatever the developer is doing, and hides it
// again whenever it takes focus anyway, as it does when it opens a window. `open`
// drops the app's environment, output and exit code, so this forwards the
// environment, streams the output back through FIFOs, and reads the result the
// suite writes. The output and the result also stay in <output dir> for CI to
// keep when a run fails.
// Usage: node backgroundCodium.js <VSCodium.app> <output dir> [codium args...]

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const [codiumApp, outputDir, ...codiumArgs] = process.argv.slice(2);
const fifoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dear-reviewer-codium-"));
const result = path.join(outputDir, "result");
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(result, { force: true });

function relay(name: string, to: NodeJS.WritableStream): fs.ReadStream {
  const fifo = path.join(fifoDir, name);
  cp.execFileSync("mkfifo", [fifo]);
  const stream = fs.createReadStream(fifo);
  stream.pipe(to, { end: false });
  const log = path.join(outputDir, `${name}.log`);
  stream.on("data", (chunk) => fs.appendFileSync(log, chunk));
  return stream;
}

const stdout = relay("stdout", process.stdout);
const stderr = relay("stderr", process.stderr);
// open rejects `_`, which the shell sets to the program path.
const { _, ...inherited } = process.env;
const env = { ...inherited, DEAR_REVIEWER_RESULT: result };
// The screenshots suite needs a window on screen, in front.
const onScreen = !!process.env.DEAR_REVIEWER_SCREENSHOTS;
const open = cp.spawn(
  "open",
  [
    ...(onScreen ? [] : ["-g", "-j"]),
    "-n",
    "-W",
    "--stdout",
    path.join(fifoDir, "stdout"),
    "--stderr",
    path.join(fifoDir, "stderr"),
    ...Object.entries(env).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
    "-a",
    codiumApp,
    "--args",
    ...codiumArgs,
  ],
  { stdio: "inherit" }
);

// Hides the app whenever it comes to the front, until it quits, and hands focus
// back to the app that had it; left to itself, macOS picks another.
const keepHidden = `
function run([pid]) {
  const processes = Application("System Events").processes;
  let previous;
  for (;;) {
    const app = processes.whose({ unixId: Number(pid) });
    if (app.length === 0) return;
    const front = processes.whose({ frontmost: true });
    if (front.length === 0) {
      // Nothing is in front for a moment while apps switch.
    } else if (front[0].unixId() !== Number(pid)) previous = front[0];
    else {
      app[0].visible = false;
      if (previous) previous.frontmost = true;
    }
    delay(0.2);
  }
}`;

function launchedPid(): number | undefined {
  const executable = path.join(codiumApp, "Contents", "MacOS", "VSCodium");
  const testsPath = codiumArgs.find((a) =>
    a.startsWith("--extensionTestsPath=")
  );
  const ps = cp.execFileSync("ps", ["-axo", "pid=,args="], {
    encoding: "utf8",
  });
  for (const line of ps.split("\n")) {
    const [, pid, args] = line.match(/^\s*(\d+) (.*)$/) ?? [];
    if (args?.startsWith(`${executable} `) && args.includes(testsPath!)) {
      return Number(pid);
    }
  }
}

// CI runners have no one to take focus from, and may not let System Events in.
const findPid =
  process.env.CI || onScreen
    ? undefined
    : setInterval(() => {
        const pid = launchedPid();
        if (pid === undefined) return;
        clearInterval(findPid);
        cp.spawn(
          "osascript",
          ["-l", "JavaScript", "-e", keepHidden, String(pid)],
          {
            stdio: "ignore",
          }
        );
      }, 100);

const closed = (stream: fs.ReadStream) =>
  new Promise<void>((resolve) => stream.on("close", () => resolve()));

open.on("exit", async (code) => {
  clearInterval(findPid);
  const passed =
    code === 0 &&
    fs.existsSync(result) &&
    fs.readFileSync(result, "utf8") === "passed";
  // A launch that never opened the FIFOs would leave their readers waiting.
  await Promise.race([
    Promise.all([closed(stdout), closed(stderr)]),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  fs.rmSync(fifoDir, { recursive: true, force: true });
  process.stdout.write("", () => process.exit(passed ? 0 : 1));
});
