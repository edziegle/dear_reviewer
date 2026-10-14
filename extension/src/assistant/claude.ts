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

/** The Assistant can look at code, never change it or run anything. */
export const readOnlyTools = ["Read", "Grep", "Glob"];

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
 * The environment `claude` runs in: the extension host's, without anything
 * that would make it bill an API key or a cloud provider instead of the login
 * the Reviewer set up in Claude Code.
 */
export function claudeEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const removed = new Set([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    // Set when VSCodium was started from a Claude Code session.
    "CLAUDECODE",
  ]);
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (removed.has(key) || key.startsWith("CLAUDE_CODE_USE_")) continue;
    result[key] = value;
  }
  return result;
}

const installLocations = [
  path.join(os.homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".npm-global", "bin"),
  path.join(os.homedir(), ".claude", "local"),
];

/**
 * The `claude` executable: the configured path, or else the first `claude` on
 * the PATH or in a usual install location.
 */
export function findClaude(configured: string): string {
  if (configured) {
    if (isExecutable(configured)) return configured;
    throw new ClaudeProblem(
      "notFound",
      `Claude Code isn't at ${configured}. Install Claude Code, or set Dear Reviewer: Claude Path to your \`claude\` executable.`
    );
  }
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...installLocations,
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (isExecutable(candidate)) return candidate;
  }
  throw new ClaudeProblem(
    "notFound",
    "Couldn't find Claude Code. Install it, or set Dear Reviewer: Claude Path to your `claude` executable."
  );
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
  constructor(readonly executable: string) {}

  /** Which login `claude` would use, from `claude auth status`. */
  login(): Promise<ClaudeLogin> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        ["auth", "status"],
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
    return new ClaudeConversation(this.executable, options);
  }

  private failure(err: Error | null, output: string): ClaudeProblem {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "EACCES")
      return new ClaudeProblem(
        "notFound",
        `Couldn't run Claude Code at ${this.executable}. Install Claude Code, or set Dear Reviewer: Claude Path to your \`claude\` executable.`
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
  /** The folders the Assistant may read: the head and base worktrees. */
  addDirs: string[];
  /** Added to Claude Code's own system prompt. */
  systemPrompt: string;
  /** An earlier session to carry on, which Claude Code keeps under `cwd`. */
  resume?: string;
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

  constructor(executable: string, options: ConversationOptions) {
    const args = [
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
      readOnlyTools.join(","),
      "--permission-mode",
      "dontAsk",
      // A Change's worktrees are someone else's code: don't run its hooks or
      // connect its MCP servers.
      "--setting-sources",
      "user",
      "--strict-mcp-config",
      "--append-system-prompt",
      options.systemPrompt,
      ...options.addDirs.flatMap((dir) => ["--add-dir", dir]),
      ...(options.resume ? ["--resume", options.resume] : []),
    ];
    this.resumed = options.resume !== undefined;
    this.sessionId = options.resume;
    this.child = spawn(executable, args, {
      cwd: options.cwd,
      env: claudeEnvironment(),
    });
    this.child.on("error", (err) =>
      this.end(this.spawnFailure(executable, err))
    );
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

  private spawnFailure(executable: string, err: NodeJS.ErrnoException): Error {
    if (err.code === "ENOENT" || err.code === "EACCES")
      return new ClaudeProblem(
        "notFound",
        `Couldn't run Claude Code at ${executable}. Install Claude Code, or set Dear Reviewer: Claude Path to your \`claude\` executable.`
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

interface StreamEvent {
  type?: string;
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
