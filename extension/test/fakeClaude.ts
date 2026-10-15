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
//
// A request for a Reading Order, which follows every new summary, gets the
// script's `readingOrder` answer on the side, so the scripted turns stay
// the summary and what the Reviewer asks.
//
// The scripted turns are one list for every Change: `turns-taken` counts
// the turns of every run, so whichever Change asks next gets the next turn,
// and each new conversation takes one as its summary. A run reads script.json
// once, as it starts, so a run already going on when the test scripts the
// fake again keeps its old turns while counting from the first again.
//
// In the scripted events, the strings {head} and {base} stand for the first
// and second `--add-dir` the run was given, the Change's worktrees, so a
// tool-use event (see toolUse) can name files the way Claude Code does.
//
// An mcpCall event calls a tool of an MCP server from the run's
// `--mcp-config` for real, as Claude Code would: it starts the server with
// the config's command, arguments and environment over its own, and records
// the result in the run's `mcpResults`.

import * as cp from "child_process";
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
   * across every run of every Change. Once they run out, the last turn repeats. Defaults to a
   * short summary. Each event's `session_id` is replaced with the run's
   * session, and a `waitFor` event pauses the turn until its file exists.
   */
  turns?: Record<string, unknown>[][];
  /**
   * The stream-json events printed for every request for a Reading Order,
   * which take no turn. Defaults to a reply with no order in it.
   */
  readingOrder?: Record<string, unknown>[];
}

/** What a request for a Reading Order says, which the fake answers on the side. */
export const readingOrderRequest = "Suggest a Reading Order";

/** An event that holds the rest of the turn back until the test writes the file. */
export function waitFor(name: string): Record<string, unknown> {
  return { type: "fakeClaude.waitFor", file: name };
}

/**
 * The event in which the Assistant calls a tool, as Claude Code prints it
 * before running the tool, followed by the tool's result.
 */
export function toolUse(
  name: string,
  input: Record<string, unknown>
): Record<string, unknown>[] {
  const id = `toolu_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return [
    {
      type: "assistant",
      session_id: fakeSessionId,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name, input }],
      },
    },
    {
      type: "user",
      session_id: fakeSessionId,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: id, content: "(fake result)" },
        ],
      },
    },
  ];
}

/**
 * The events in which the Assistant calls a tool of an MCP server in the
 * run's `--mcp-config`, which the fake really calls, followed by its result.
 */
export function mcpCall(
  server: string,
  tool: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  return { type: "fakeClaude.mcpCall", server, tool, input };
}

/** What an MCP tool the fake called gave back. */
export interface McpResult {
  name: string;
  input: Record<string, unknown>;
  text: string;
  isError: boolean;
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
  /** The results of the MCP tools its turns called, oldest first. */
  mcpResults?: McpResult[];
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

  const mcp = new McpServers(args, (result) => {
    call.mcpResults = [...(call.mcpResults ?? []), result];
    record();
  });
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
    const text = textOf(message);
    session.messages.push(text);
    fs.writeFileSync(sessionFile, JSON.stringify(session));
    const worktrees = args.flatMap((arg, i) =>
      args[i - 1] === "--add-dir" ? [arg] : []
    );
    if (text.includes(readingOrderRequest)) {
      const events =
        script.readingOrder ?? defaultTurn("No Reading Order, sorry.");
      replying = replying.then(() =>
        reply(stateDir, events, sessionId, worktrees, mcp)
      );
      return;
    }
    const taken = Number(readText(turnCounter) ?? "0");
    fs.writeFileSync(turnCounter, String(taken + 1));
    const events = turns[Math.min(taken, turns.length - 1)];
    replying = replying.then(() =>
      reply(stateDir, events, sessionId, worktrees, mcp)
    );
  });
}

async function reply(
  stateDir: string,
  events: Record<string, unknown>[],
  sessionId: string,
  [head = "", base = ""]: string[],
  mcp: McpServers
): Promise<void> {
  for (const event of events) {
    if (event.type === "fakeClaude.mcpCall") {
      const { server, tool, input } = event as {
        server: string;
        tool: string;
        input: Record<string, unknown>;
      };
      const name = `mcp__${server}__${tool}`;
      const id = `toolu_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      process.stdout.write(
        JSON.stringify({
          type: "assistant",
          session_id: sessionId,
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id, name, input }],
          },
        }) + "\n"
      );
      const result = await mcp.call(server, tool, input);
      process.stdout.write(
        JSON.stringify({
          type: "user",
          session_id: sessionId,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content: result.text,
                is_error: result.isError,
              },
            ],
          },
        }) + "\n"
      );
      continue;
    }
    if (event.type === "fakeClaude.waitFor") {
      const file = path.join(stateDir, String(event.file));
      while (!fs.existsSync(file))
        await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const out =
      "session_id" in event ? { ...event, session_id: sessionId } : event;
    const line = JSON.stringify(out)
      .replaceAll("{head}", JSON.stringify(head).slice(1, -1))
      .replaceAll("{base}", JSON.stringify(base).slice(1, -1));
    process.stdout.write(line + "\n");
  }
}

/**
 * The MCP servers of the run's `--mcp-config`, each started on its first
 * call and kept for the run, as Claude Code keeps them.
 */
class McpServers {
  private readonly config: Record<string, McpServerConfig>;
  private readonly started = new Map<string, Promise<McpClient>>();

  constructor(
    args: string[],
    private readonly recordResult: (result: McpResult) => void
  ) {
    const at = args.indexOf("--mcp-config");
    this.config =
      at >= 0
        ? (
            JSON.parse(args[at + 1]) as {
              mcpServers: Record<string, McpServerConfig>;
            }
          ).mcpServers
        : {};
  }

  async call(
    server: string,
    tool: string,
    input: Record<string, unknown>
  ): Promise<McpResult> {
    const name = `mcp__${server}__${tool}`;
    let result: McpResult;
    try {
      let client = this.started.get(server);
      if (!client) {
        const config = this.config[server];
        if (!config) throw new Error(`No MCP server ${server} in --mcp-config`);
        client = McpClient.start(config);
        this.started.set(server, client);
      }
      const answer = (await (
        await client
      ).request("tools/call", {
        name: tool,
        arguments: input,
      })) as { content: { text: string }[]; isError?: boolean };
      result = {
        name,
        input,
        text: answer.content.map((c) => c.text).join(""),
        isError: answer.isError === true,
      };
    } catch (err) {
      result = { name, input, text: (err as Error).message, isError: true };
    }
    this.recordResult(result);
    return result;
  }
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** A client of one stdio MCP server, after the handshake. */
class McpClient {
  private next = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();
  private stderr = "";

  private constructor(private readonly child: cp.ChildProcess) {
    readline.createInterface({ input: child.stdout! }).on("line", (line) => {
      const message = JSON.parse(line) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      const waiter =
        message.id === undefined ? undefined : this.waiting.get(message.id);
      if (!waiter) return;
      this.waiting.delete(message.id!);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    child.stderr!.on(
      "data",
      (chunk: Buffer) => (this.stderr += chunk.toString())
    );
    child.on("exit", (code) => {
      for (const waiter of this.waiting.values())
        waiter.reject(
          new Error(
            `The MCP server stopped (exit code ${code}): ${this.stderr}`
          )
        );
      this.waiting.clear();
    });
  }

  static async start(config: McpServerConfig): Promise<McpClient> {
    const child = cp.spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", () => undefined);
    const client = new McpClient(child);
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-claude", version: "0" },
    });
    client.send({ method: "notifications/initialized" });
    return client;
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin!.write(
      JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"
    );
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
