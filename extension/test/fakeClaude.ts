// A fake `claude` executable for the tests. run.ts puts a wrapper on disk that
// runs this file with node, passing the fake's state folder first.
//
// It answers `claude auth status` and `claude --version`, and in print mode it
// replays scripted stream-json events for each user message on stdin. Every
// run records its arguments, working directory, environment and the messages
// it received, so tests can check what reached the outside world.
//
// Like Claude Code, it keeps each session's turns, under the working
// directory it ran in, so `--resume <id>` brings them back only from that
// same directory; otherwise it fails as Claude Code does.
//
// Tests control it through files in the state folder:
//   script.json   what to answer (FakeClaudeScript); absent means the defaults
//   calls/        one JSON file (RecordedClaudeCall) per run, kept up to date
//   sessions/     each session's working directory and user messages
//   <name>        a file a turn waits for (see waitFor), written by the test

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export interface FakeClaudeScript {
  /** What `claude auth status` prints as JSON. Defaults to a claude.ai login. */
  authStatus?: Record<string, unknown>;
  /** Its exit code; defaults to 0 when signed in and 1 otherwise. */
  authStatusExitCode?: number;
  /**
   * The stream-json events printed for each user message, in order, counted
   * across every run. Once they run out, the last turn repeats. Defaults to a
   * short summary. Each event's `session_id` is replaced with the run's
   * session, and a `waitFor` event pauses the turn until its file exists.
   */
  turns?: Record<string, unknown>[][];
}

/** An event that holds the rest of the turn back until the test writes the file. */
export function waitFor(name: string): Record<string, unknown> {
  return { type: "fakeClaude.waitFor", file: name };
}

export interface RecordedClaudeCall {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** The stream-json lines received on stdin, parsed. */
  input: Record<string, unknown>[];
  /** The session the run's events named, for a print-mode run. */
  sessionId?: string;
  /** The user messages of earlier runs that `--resume` brought back. */
  resumed?: string[];
}

interface Session {
  cwd: string;
  /** The text of each user message, oldest first. */
  messages: string[];
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

  const sessionsDir = path.join(stateDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const resumeAt = args.indexOf("--resume");
  const resume = resumeAt >= 0 ? args[resumeAt + 1] : undefined;
  const sessionId = resume ?? crypto.randomUUID();
  const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
  let session: Session = { cwd: fs.realpathSync(process.cwd()), messages: [] };
  if (resume) {
    const earlier = readJson<Session>(sessionFile);
    if (!earlier || earlier.cwd !== session.cwd) {
      process.stderr.write(
        `No conversation found with session ID: ${resume}\n`
      );
      process.exitCode = 1;
      return;
    }
    session = earlier;
    call.resumed = [...earlier.messages];
  }
  call.sessionId = sessionId;
  record();

  const turns = script.turns?.length ? script.turns : [defaultTurn()];
  const turnCounter = path.join(stateDir, "turns-taken");
  let replying = Promise.resolve();
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as Record<string, unknown>;
    call.input.push(message);
    record();
    if (message.type !== "user") return;
    session.messages.push(textOf(message));
    fs.writeFileSync(sessionFile, JSON.stringify(session));
    const taken = Number(readText(turnCounter) ?? "0");
    fs.writeFileSync(turnCounter, String(taken + 1));
    const events = turns[Math.min(taken, turns.length - 1)];
    replying = replying.then(() => reply(stateDir, events, sessionId));
  });
}

async function reply(
  stateDir: string,
  events: Record<string, unknown>[],
  sessionId: string
): Promise<void> {
  for (const event of events) {
    if (event.type === "fakeClaude.waitFor") {
      const file = path.join(stateDir, String(event.file));
      while (!fs.existsSync(file))
        await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const out =
      "session_id" in event ? { ...event, session_id: sessionId } : event;
    process.stdout.write(JSON.stringify(out) + "\n");
  }
}

function textOf(message: Record<string, unknown>): string {
  const content = (message.message as { content: unknown }).content;
  if (typeof content === "string") return content;
  return (content as { text?: string }[]).map((b) => b.text ?? "").join("");
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function readJson<T>(file: string): T | undefined {
  const text = readText(file);
  return text === undefined ? undefined : (JSON.parse(text) as T);
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
