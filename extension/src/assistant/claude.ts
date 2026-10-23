// Runs the Reviewer's own installed `claude` CLI, which is what powers the
// Assistant. Dear Reviewer never handles Claude credentials and never offers
// Claude sign-in: `claude` uses whatever login that machine already has, and
// this module only makes sure nothing in the environment overrides it.
// See docs/research/claude-subscription-auth-macos.md and ADR 0004.

import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import {
  allowedGitTools,
  type ChangeHistory,
  gitServerConfig,
  gitServerName,
} from "./gitTools";

/** The Assistant can look at code, never change it or run anything. */
export const readOnlyTools = ["Read", "Grep", "Glob"];

/**
 * What `--allowedTools` lets the Assistant do without asking: its git tools,
 * and none of `readOnlyTools` (ADR 0042). In `dontAsk` mode, Claude Code lets
 * `Read`, `Grep` and `Glob` work inside the working folder and the `--add-dir`
 * folders and refuses every other path, a symbolic link whose target is
 * outside them included, as long as no `allow` rule from a flag or a settings
 * file says otherwise. A bare `Read` here would allow every file the
 * Reviewer's user can read, as `--add-dir` only widens what is allowed
 * without asking.
 */
export const allowedWithoutAsking = [...allowedGitTools];

/**
 * The git tools' MCP server, which esbuild bundles beside the extension's
 * own dist/extension.js (ADR 0030).
 */
const gitServerScript = path.join(__dirname, "gitServer.js");

/**
 * A problem with `claude` itself, worded for the Reviewer: what's wrong and
 * what they can do about it.
 */
export class ClaudeProblem extends Error {
  constructor(
    readonly kind: "notFound" | "notSignedIn" | "failed",
    message: string
  ) {
    super(message);
  }
}

export interface ClaudeLogin {
  signedIn: boolean;
  /** `authMethod` from `claude auth status`, such as `claude.ai` or `api_key`. */
  method: string;
  /** How the Reviewer sees the login, such as "Claude subscription (Max)". */
  label: string;
  /** Whether usage is billed per token rather than to a subscription. */
  billedPerToken: boolean;
}

/**
 * The variables `claude` gets from the extension host's environment, and why:
 * only what it needs to find itself, its login and the network. Anything else
 * stays out, above all `ANTHROPIC_*` and `CLAUDE_CODE_*`, which can make it
 * bill an API key or a cloud provider, or send its requests elsewhere,
 * instead of using the login the Reviewer set up in Claude Code.
 */
const passedVariables = new Set([
  // Finds node for an npm install of claude, and git and ripgrep for its tools.
  "PATH",
  // Finds ~/.claude and ~/.claude.json, where its settings and login live.
  "HOME",
  // Moves ~/.claude elsewhere, for a Reviewer who keeps their login there.
  "CLAUDE_CONFIG_DIR",
  // Name the account its login is kept under in the OS keychain.
  "USER",
  "LOGNAME",
  // The shell it runs commands in; it checks for one when it starts.
  "SHELL",
  // macOS gives each user a private temporary folder here.
  "TMPDIR",
  // How it reads and writes non-ASCII text.
  "LANG",
  // Whether it may colour what it writes.
  "TERM",
  // Reach claude.ai through the proxy and certificates the network requires.
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
]);

/**
 * The environment `claude` runs in: built from the extension host's, keeping
 * only the variables in `passedVariables` and the locale's `LC_*`.
 */
export function claudeEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (passedVariables.has(key) || key.startsWith("LC_")) result[key] = value;
  }
  return result;
}

/** What a custom Claude Command must do, which the Assistant's panel and the setting link to. */
export const customClaudeCommandGuide =
  "https://github.com/edziegle/dear_reviewer/wiki/custom-claude-command";

const installLocations = [
  path.join(os.homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".npm-global", "bin"),
  path.join(os.homedir(), ".claude", "local"),
];

/**
 * How to start `claude`: a program and the arguments that go before Dear
 * Reviewer's own (ADR 0049).
 */
export interface ClaudeCommand {
  program: string;
  args: string[];
}

/**
 * The command as JSON, for messages: quotes and spaces inside an item, which
 * the Settings editor shows without escaping, would hide in a joined string.
 */
export function describeCommand(command: ClaudeCommand): string {
  return JSON.stringify([command.program, ...command.args]);
}

/**
 * The command that starts `claude`: the Reviewer's Claude Command, or else
 * their deprecated Claude Path as a command of one item, or else the first
 * `claude` on the PATH or in a usual install location. The first item of a
 * command is a path, with a leading `~` expanded, or a bare name looked up on
 * the PATH.
 */
export function resolveClaude(
  claudeCommand: string[],
  claudePath: string,
  home: string = os.homedir()
): ClaudeCommand {
  const configured = claudeCommand.length > 0 ? claudeCommand : [claudePath];
  const [first, ...args] = configured;
  if (first) {
    const program = findProgram(expandHome(first, home));
    if (program) return { program, args };
    throw new ClaudeProblem(
      "notFound",
      `Claude Code isn't at ${JSON.stringify(first)}, so \`${JSON.stringify(configured)}\` can't run. Install Claude Code, or set Dear Reviewer: Claude Command to the command that starts \`claude\`.`
    );
  }
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...installLocations,
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (isExecutable(candidate)) return { program: candidate, args: [] };
  }
  throw new ClaudeProblem(
    "notFound",
    "Couldn't find Claude Code. Install it, or set Dear Reviewer: Claude Command to the command that starts `claude`."
  );
}

function expandHome(item: string, home: string): string {
  return item === "~" || item.startsWith("~/")
    ? path.join(home, item.slice(1))
    : item;
}

/** A path as it is, or a bare name found on the PATH. */
function findProgram(program: string): string | undefined {
  if (program.includes("/") || path.isAbsolute(program))
    return isExecutable(program) ? program : undefined;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, program);
    if (dir && isExecutable(candidate)) return candidate;
  }
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export class ClaudeCli {
  constructor(readonly command: ClaudeCommand) {}

  /** Which login `claude` would use, from `claude auth status`. */
  login(): Promise<ClaudeLogin> {
    return new Promise((resolve, reject) => {
      execFile(
        this.command.program,
        [...this.command.args, "auth", "status"],
        { env: claudeEnvironment(), timeout: 30_000 },
        (err, stdout, stderr) => {
          // It exits non-zero when signed out, but still reports the status.
          let status: Record<string, unknown>;
          try {
            status = JSON.parse(stdout);
          } catch {
            return reject(this.failure(err, stderr || stdout));
          }
          resolve(describeLogin(status));
        }
      );
    });
  }

  /** Starts a conversation that can read the Change's worktrees. */
  converse(options: ConversationOptions): ClaudeConversation {
    return new ClaudeConversation(this.command, options);
  }

  private failure(err: Error | null, output: string): ClaudeProblem {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "EACCES")
      return new ClaudeProblem(
        "notFound",
        `Couldn't run Claude Code with \`${describeCommand(this.command)}\`. Install Claude Code, or set Dear Reviewer: Claude Command to the command that starts \`claude\`.`
      );
    return new ClaudeProblem(
      "failed",
      `\`claude auth status\` failed: ${output.trim() || err?.message}`
    );
  }
}

export function describeLogin(status: Record<string, unknown>): ClaudeLogin {
  const method =
    typeof status.authMethod === "string" ? status.authMethod : "none";
  const signedIn = status.loggedIn !== false && method !== "none";
  const plan =
    typeof status.subscriptionType === "string" && status.subscriptionType
      ? ` (${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)})`
      : "";
  const labels: Record<string, [string, boolean]> = {
    "claude.ai": [`Claude subscription${plan}`, false],
    api_key: ["API key, billed per token", true],
    api_key_helper: ["API key helper, billed per token", true],
    oauth_token: ["Claude OAuth token", false],
    third_party: [
      `Cloud provider${typeof status.apiProvider === "string" ? ` (${status.apiProvider})` : ""}, billed by the provider`,
      true,
    ],
    none: ["not signed in", false],
  };
  const [label, billedPerToken] = labels[method] ?? [method, false];
  return {
    signedIn,
    method,
    label: signedIn ? label : "not signed in",
    billedPerToken,
  };
}

export interface ConversationOptions {
  /** The conversation's own folder, where Claude Code keeps its session. */
  cwd: string;
  /** The folders the Assistant may read: the worktrees and the Change's Assistant folder. */
  addDirs: string[];
  /** Added to Claude Code's own system prompt. */
  systemPrompt: string;
  /** An earlier session to carry on, which Claude Code keeps under `cwd`. */
  resume?: string;
  /** The repository, base and head the Assistant's git tools reach. */
  history: ChangeHistory;
  /** Called with whether the git server connected, each time `claude` says which MCP servers started. */
  onGitTools?: (connected: boolean) => void;
}

/**
 * One long-lived `claude` process in print mode with stream-json input and
 * output. Each `ask` is one turn; turns run one after another.
 */
export class ClaudeConversation {
  private readonly child: ChildProcessWithoutNullStreams;
  private turn?: {
    onText: (text: string) => void;
    onToolUse: (use: ToolUse) => void;
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    done: string;
    partial: string;
  };
  private queue: Promise<unknown> = Promise.resolve();
  private stderr = "";
  private ended?: Error;
  /** Claude Code's session id, once it has said it. */
  sessionId?: string;
  /** Whether the conversation carries on an earlier session. */
  readonly resumed: boolean;
  /** Whether Claude Code has finished a turn, so it took up the session. */
  answered = false;
  private readonly onGitTools: (connected: boolean) => void;

  constructor(command: ClaudeCommand, options: ConversationOptions) {
    const args = [
      ...command.args,
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools",
      readOnlyTools.join(","),
      "--allowedTools",
      allowedWithoutAsking.join(","),
      "--permission-mode",
      "dontAsk",
      // A Change's worktrees are someone else's code: don't run its hooks or
      // connect its MCP servers. No user, project or local settings file loads: a user-level
      // `allow` rule such as a bare `Read`, common in the Reviewer's own
      // settings, would let the Assistant read any file (ADR 0042). Only Dear
      // Reviewer's git server connects, on VS Code's own binary run as Node.
      "--setting-sources",
      "",
      // Installed plugins load outside the setting sources, and their hooks
      // would run in the Assistant: all hooks are off (ADR 0042). Not
      // `--safe-mode`, which drops the `--mcp-config` below.
      "--settings",
      JSON.stringify({ disableAllHooks: true }),
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify(
        gitServerConfig(process.execPath, gitServerScript, options.history)
      ),
      "--append-system-prompt",
      options.systemPrompt,
      ...options.addDirs.flatMap((dir) => ["--add-dir", dir]),
      ...(options.resume ? ["--resume", options.resume] : []),
    ];
    this.onGitTools = options.onGitTools ?? (() => undefined);
    this.resumed = options.resume !== undefined;
    this.sessionId = options.resume;
    this.child = spawn(command.program, args, {
      cwd: options.cwd,
      env: claudeEnvironment(),
    });
    this.child.on("error", (err) => this.end(this.spawnFailure(command, err)));
    this.child.stdin.on("error", () => undefined);
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4000);
    });
    this.child.on("exit", (code, signal) =>
      this.end(
        new ClaudeProblem(
          "failed",
          `Claude Code stopped (${signal ?? `exit code ${code}`})${this.stderr.trim() ? `: ${this.stderr.trim()}` : "."}`
        )
      )
    );
    readline
      .createInterface({ input: this.child.stdout })
      .on("line", (line) => this.receive(line));
  }

  /**
   * Sends the prompt as the next user message. `onText` gets the reply so far
   * as it streams, and `onToolUse` each tool the Assistant calls on the way;
   * the promise gives the final reply.
   */
  ask(
    prompt: string,
    onText: (text: string) => void = () => undefined,
    onToolUse: (use: ToolUse) => void = () => undefined
  ): Promise<string> {
    const asked = this.queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (this.ended) return reject(this.ended);
          this.turn = {
            onText,
            onToolUse,
            resolve,
            reject,
            done: "",
            partial: "",
          };
          this.child.stdin.write(
            JSON.stringify({
              type: "user",
              message: {
                role: "user",
                content: [{ type: "text", text: prompt }],
              },
              parent_tool_use_id: null,
              session_id: this.sessionId ?? "",
            }) + "\n"
          );
        })
    );
    this.queue = asked.catch(() => undefined);
    return asked;
  }

  dispose(): void {
    this.end(new ClaudeProblem("failed", "The conversation was closed."));
    this.child.stdin.end();
    this.child.kill();
  }

  private receive(line: string): void {
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    if (typeof event.session_id === "string" && event.session_id)
      this.sessionId = event.session_id;
    if (event.type === "system" && event.subtype === "init")
      this.onGitTools(gitServerConnected(event));
    const turn = this.turn;
    if (!turn) return;
    if (
      event.type === "stream_event" &&
      event.event?.delta?.type === "text_delta"
    ) {
      turn.partial += event.event.delta.text ?? "";
      turn.onText(joinText(turn.done, turn.partial));
    } else if (event.type === "assistant") {
      const content = event.message?.content ?? [];
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      // A message that only calls tools adds nothing to the reply.
      if (text) {
        turn.done = joinText(turn.done, text);
        turn.partial = "";
        turn.onText(turn.done);
      }
      for (const block of content)
        if (block.type === "tool_use" && typeof block.name === "string")
          turn.onToolUse({
            name: block.name,
            input:
              block.input && typeof block.input === "object" ? block.input : {},
          });
    } else if (event.type === "result") {
      this.turn = undefined;
      this.answered = true;
      if (event.is_error || event.subtype !== "success") {
        const detail =
          event.result ||
          (event.errors ?? []).join("; ") ||
          event.subtype ||
          "an error";
        turn.reject(
          new ClaudeProblem("failed", `Claude Code reported ${detail}`)
        );
      } else {
        turn.resolve(event.result ?? turn.done);
      }
    }
  }

  private end(err: Error): void {
    if (this.ended) return;
    this.ended = err;
    this.turn?.reject(err);
    this.turn = undefined;
  }

  private spawnFailure(
    command: ClaudeCommand,
    err: NodeJS.ErrnoException
  ): Error {
    if (err.code === "ENOENT" || err.code === "EACCES")
      return new ClaudeProblem(
        "notFound",
        `Couldn't run Claude Code with \`${describeCommand(command)}\`. Install Claude Code, or set Dear Reviewer: Claude Command to the command that starts \`claude\`.`
      );
    return new ClaudeProblem(
      "failed",
      `Couldn't start Claude Code: ${err.message}`
    );
  }
}

function joinText(a: string, b: string): string {
  return a && b ? `${a}\n\n${b}` : a || b;
}

/** A tool the Assistant called, with the input it gave. */
export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Whether a `system`/`init` event says Dear Reviewer's git server connected.
 * `claude` carries on without a server that failed to start.
 */
export function gitServerConnected(event: StreamEvent): boolean {
  return (
    event.mcp_servers?.some(
      (server) => server.name === gitServerName && server.status === "connected"
    ) ?? false
  );
}

export interface StreamEvent {
  type?: string;
  mcp_servers?: { name: string; status: string }[];
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  message?: {
    content?: {
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }[];
  };
  event?: { delta?: { type?: string; text?: string } };
}
