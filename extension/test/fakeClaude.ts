// A fake `claude` executable for the tests. run.ts puts a wrapper on disk that
// runs this file with node, passing the fake's state folder first.
//
// It answers `claude auth status` and `claude --version`, and in print mode it
// replays scripted stream-json events for each user message on stdin. Every
// run records its arguments, working directory, environment and the messages
// it received, so tests can check what reached the outside world.
//
// Tests control it through files in the state folder:
//   script.json   what to answer (FakeClaudeScript); absent means the defaults
//   calls/        one JSON file (RecordedClaudeCall) per run, kept up to date

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export interface FakeClaudeScript {
  /** What `claude auth status` prints as JSON. Defaults to a claude.ai login. */
  authStatus?: Record<string, unknown>;
  /** Its exit code; defaults to 0 when signed in and 1 otherwise. */
  authStatusExitCode?: number;
  /**
   * The stream-json events printed for each user message, in order. Once they
   * run out, the last turn repeats. Defaults to a short summary.
   */
  turns?: Record<string, unknown>[][];
}

export interface RecordedClaudeCall {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** The stream-json lines received on stdin, parsed. */
  input: Record<string, unknown>[];
}

export const fakeSessionId = "00000000-0000-4000-8000-000000000000";

export function defaultTurn(
  text = "A fake summary."
): Record<string, unknown>[] {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: fakeSessionId,
      tools: ["Read", "Grep", "Glob"],
      apiKeySource: "none",
    },
    {
      type: "assistant",
      session_id: fakeSessionId,
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: fakeSessionId,
      result: text,
    },
  ];
}

function main(): void {
  const [stateDir, ...args] = process.argv.slice(2);
  const script = readScript(stateDir);
  const call: RecordedClaudeCall = {
    args,
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
    input: [],
  };
  const callsDir = path.join(stateDir, "calls");
  fs.mkdirSync(callsDir, { recursive: true });
  const callFile = path.join(
    callsDir,
    `${process.hrtime.bigint()}-${process.pid}.json`
  );
  const record = () => {
    fs.writeFileSync(`${callFile}.tmp`, JSON.stringify(call, null, 2));
    fs.renameSync(`${callFile}.tmp`, callFile);
  };
  record();

  if (args[0] === "--version") {
    process.stdout.write("2.1.300 (Claude Code)\n");
    return;
  }
  if (args[0] === "auth" && args[1] === "status") {
    const status = script.authStatus ?? {
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      subscriptionType: "max",
    };
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    process.exitCode =
      script.authStatusExitCode ?? (status.loggedIn === false ? 1 : 0);
    return;
  }
  if (!args.includes("-p") && !args.includes("--print")) {
    process.stderr.write(
      `fake claude: unexpected arguments ${args.join(" ")}\n`
    );
    process.exitCode = 2;
    return;
  }

  const turns = script.turns?.length ? script.turns : [defaultTurn()];
  let turn = 0;
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as Record<string, unknown>;
    call.input.push(message);
    record();
    if (message.type !== "user") return;
    const events = turns[Math.min(turn++, turns.length - 1)];
    for (const event of events)
      process.stdout.write(JSON.stringify(event) + "\n");
  });
}

function readScript(stateDir: string): FakeClaudeScript {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(stateDir, "script.json"), "utf8")
    ) as FakeClaudeScript;
  } catch {
    return {};
  }
}

if (require.main === module) main();
