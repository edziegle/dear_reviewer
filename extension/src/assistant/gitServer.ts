// The MCP server behind the Assistant's git tools (ADR 0030). `claude`
// starts it over stdio from `--mcp-config`, on VS Code's own binary run as
// Node, and it answers MCP's JSON-RPC, one message a line. It runs git only
// in the Change's repository, only on commits in the Change's history, with
// the command lines gitTools.ts builds. esbuild bundles it as
// dist/gitServer.js, beside the extension.

import { execFile, spawn } from "child_process";
import * as readline from "readline";
import type { Readable, Writable } from "stream";
import {
  type ChangeHistory,
  commitIdKind,
  emptyTreeOf,
  failureText,
  type GitRequest,
  gitRuns,
  gitMissingText,
  gitServerName,
  gitTimeoutMs,
  gitTooOld,
  gitToolDefinitions,
  historyVariables,
  maxOutputChars,
  outsideHistory,
  parseRequest,
  Refusal,
  revisionsOf,
  splitRevision,
  timeoutText,
  toolText,
} from "./gitTools";

export interface GitLimits {
  maxChars: number;
  timeoutMs: number;
}

export interface GitRun {
  output: string;
  /** Whether the output went past `maxChars`, so git was stopped early. */
  cut: boolean;
  timedOut: boolean;
  /** The exit code, or null when git was stopped. */
  code: number | null;
  stderr: string;
}

/**
 * Git's environment: never prompting, never fetching, never replacing a
 * commit's parents, and never taking a lock or rewriting the index, even for
 * a command that would refresh it.
 */
function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    // A partial clone would otherwise fetch missing objects, over the network
    // and through its own ssh command.
    GIT_NO_LAZY_FETCH: "1",
    // Replace refs and grafts would give commits other parents, which could
    // lead outside the Change's history.
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_GRAFT_FILE: "/dev/null",
  };
}

/**
 * Runs the program with the arguments in the folder, keeping at most
 * `maxChars` of what it prints: past that, or past the timeout, it is killed.
 */
export function runCapped(
  executable: string,
  args: string[],
  cwd: string,
  limits: GitLimits
): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    let cut = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, limits.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (cut) return;
      output += chunk;
      if (output.length > limits.maxChars) {
        cut = true;
        output = output.slice(0, limits.maxChars);
        child.kill("SIGKILL");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({ output, cut, timedOut, code, stderr });
    };
    child.on("error", (err) => {
      stderr += err.message;
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** A git run that took too long, while a revision was being resolved. */
class Stopped extends Error {}

/** The most objects an abbreviated commit ID may match before it is too short to look through. */
const maxCandidates = 20;

/** The git tools for one Change. */
export class GitHistory {
  private gitChecked?: Promise<string | undefined>;

  constructor(
    readonly history: ChangeHistory,
    readonly limits: GitLimits = {
      maxChars: maxOutputChars,
      timeoutMs: gitTimeoutMs,
    },
    private readonly git = "git"
  ) {}

  async call(tool: string, input: unknown): Promise<ToolResult> {
    const unusable = await this.checkGit();
    if (unusable) return { text: unusable, isError: true };
    let request: GitRequest;
    try {
      request = parseRequest(tool, input);
    } catch (err) {
      if (err instanceof Refusal) return { text: err.message, isError: true };
      throw err;
    }
    const resolved = new Map<string, string>();
    try {
      for (const [name, revision] of revisionsOf(request))
        resolved.set(revision, await this.inHistory(revision, name));
    } catch (err) {
      if (err instanceof Refusal) return { text: err.message, isError: true };
      if (err instanceof Stopped)
        return {
          text: timeoutText(request, this.limits.timeoutMs),
          isError: true,
        };
      throw err;
    }
    const emptyTree = emptyTreeOf(this.history.head);
    let output = "";
    let cut = false;
    for (const args of gitRuns(request, resolved, this.history, emptyTree)) {
      const run = await runCapped(this.git, args, this.history.repository, {
        ...this.limits,
        maxChars: this.limits.maxChars - output.length,
      });
      if (run.timedOut)
        return {
          text: timeoutText(request, this.limits.timeoutMs),
          isError: true,
        };
      if (run.code !== 0 && !run.cut)
        return { text: failureText(request, run.stderr), isError: true };
      output += run.output;
      if (run.cut) {
        cut = true;
        break;
      }
    }
    return {
      text: toolText(request, output, cut, this.limits.maxChars),
      isError: false,
    };
  }

  /**
   * The commit the revision names, if it is the Change's base or head or
   * one of their ancestors; otherwise a Refusal, the same whether the commit
   * is elsewhere or nowhere. Its commit ID is checked before its `~N` and
   * `^N` are applied, and only commits in the Change's history are looked at,
   * so nothing outside it changes the answer.
   */
  private async inHistory(revision: string, name: string): Promise<string> {
    const refused = new Refusal(outsideHistory(name));
    const { id, suffix } = splitRevision(revision);
    let start: string;
    if (id === "base" || id === "head") start = this.history[id];
    else {
      const kind = commitIdKind(id, this.history.head);
      if (kind === "tooLong") throw refused;
      const matches =
        kind === "full"
          ? [id]
          : (await this.quiet(["rev-parse", `--disambiguate=${id}`])).stdout
              .split("\n")
              .filter(Boolean);
      if (matches.length > maxCandidates)
        throw new Refusal(
          `\`${name}\` is too short to tell commits apart: give more of the commit ID.`
        );
      // Only commits: a tag's ID would otherwise stand for the commit it names.
      const candidates: string[] = [];
      for (const match of matches)
        if (
          (await this.quiet(["cat-file", "-t", match])).stdout.trim() ===
          "commit"
        )
          candidates.push(match);
      const found = new Set<string>();
      for (const candidate of candidates)
        if (await this.reaches(candidate)) {
          const commit = await this.commitOf(candidate);
          if (commit) found.add(commit);
        }
      if (found.size > 1)
        throw new Refusal(
          `\`${name}\` matches more than one commit in the Change's history: give more of the commit ID.`
        );
      if (found.size === 0) throw refused;
      start = [...found][0];
    }
    if (!suffix) return start;
    const commit = await this.commitOf(`${start}${suffix}`);
    // A commit's ancestors are in the history too; this only guards it.
    if (!commit || !(await this.reaches(commit))) throw refused;
    return commit;
  }

  /**
   * Why this machine's git can't run the tools, if it can't, from
   * `git version` with no other option, which an old git would fail on. Only
   * a git that can is remembered: after a failure, such as a slow first run
   * or git not yet installed or updated, the next call checks again.
   */
  checkGit(): Promise<string | undefined> {
    this.gitChecked ??= new Promise<string | undefined>((resolve) => {
      execFile(
        this.git,
        ["version"],
        // Not the calls' own limit, which a caller may set short.
        { env: gitEnvironment(), timeout: gitTimeoutMs },
        (err, stdout) =>
          resolve(err ? gitMissingText(err.message) : gitTooOld(stdout))
      );
    }).then((unusable) => {
      if (unusable) this.gitChecked = undefined;
      return unusable;
    });
    return this.gitChecked;
  }

  /** Whether the object is a commit the Change's head or base has. */
  private async reaches(object: string): Promise<boolean> {
    for (const tip of [this.history.head, this.history.base])
      if (
        (await this.quiet(["merge-base", "--is-ancestor", object, tip]))
          .code === 0
      )
        return true;
    return false;
  }

  /** The full commit ID of a commit ID, or of one with `~N` and `^N` after it. */
  private async commitOf(expression: string): Promise<string | undefined> {
    const parsed = await this.quiet([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${expression}^{commit}`,
    ]);
    const commit = parsed.stdout.trim();
    return parsed.code === 0 && /^[0-9a-f]{40,64}$/.test(commit)
      ? commit
      : undefined;
  }

  private quiet(
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.git,
        [
          "--no-pager",
          "--no-lazy-fetch",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.commitGraph=false",
          ...args,
        ],
        {
          cwd: this.history.repository,
          env: gitEnvironment(),
          timeout: this.limits.timeoutMs,
          killSignal: "SIGKILL",
        },
        (err, stdout, stderr) => {
          if ((err as { killed?: boolean } | null)?.killed)
            return reject(new Stopped());
          // Its code is git's exit code, or a string when git didn't run.
          const code = (err as { code?: unknown } | null)?.code;
          resolve({
            code: !err ? 0 : typeof code === "number" ? code : -1,
            stdout,
            stderr,
          });
        }
      );
      // Nothing for git to read.
      child.stdin?.end();
    });
  }
}

/** The MCP protocol versions the server speaks; it answers in the client's if it knows it. */
const protocolVersions = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Answers MCP's JSON-RPC over the streams, one message a line: the
 * handshake, the list of tools and calls to them. Calls run one at a time.
 */
export function serve(
  input: Readable,
  output: Writable,
  tools: GitHistory
): Promise<void> {
  const send = (message: Record<string, unknown>) =>
    output.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      queue = queue.then(() => {
        send({ id: null, error: { code: -32700, message: "Parse error" } });
      });
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      queue = queue.then(() => {
        send({ id: null, error: { code: -32600, message: "Invalid Request" } });
      });
      return;
    }
    const message = parsed as JsonRpcMessage;
    queue = queue.then(async () => {
      const answer = await answerTo(message, tools);
      if (answer && message.id !== undefined && message.id !== null)
        send({ id: message.id, ...answer });
    });
  });
  return new Promise((resolve) => lines.on("close", () => queue.then(resolve)));
}

async function answerTo(
  message: JsonRpcMessage,
  tools: GitHistory
): Promise<Record<string, unknown> | undefined> {
  const params =
    message.params &&
    typeof message.params === "object" &&
    !Array.isArray(message.params)
      ? message.params
      : {};
  switch (message.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return {
        result: {
          protocolVersion:
            typeof asked === "string" && protocolVersions.includes(asked)
              ? asked
              : protocolVersions[0],
          capabilities: { tools: {} },
          serverInfo: {
            name: `dear-reviewer-${gitServerName}`,
            version: "1.0.0",
          },
          instructions:
            "Read-only git history of the Change under review: log, show, blame and diff, on commits its base or head reaches.",
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: gitToolDefinitions() } };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      let result: ToolResult;
      try {
        result = await tools.call(name, params.arguments);
      } catch (err) {
        result = {
          text: `The git tool failed: ${(err as Error).message}`,
          isError: true,
        };
      }
      return {
        result: {
          content: [{ type: "text", text: result.text }],
          ...(result.isError && { isError: true }),
        },
      };
    }
    default:
      // Notifications, such as notifications/initialized, need no answer.
      if (message.id === undefined || message.id === null) return undefined;
      return {
        error: { code: -32601, message: `Method not found: ${message.method}` },
      };
  }
}

function main(): void {
  const history = {
    repository: process.env[historyVariables.repository] ?? "",
    base: process.env[historyVariables.base] ?? "",
    head: process.env[historyVariables.head] ?? "",
  };
  if (!history.repository || !history.base || !history.head) {
    process.stderr.write(
      `The git tools need ${Object.values(historyVariables).join(", ")}.\n`
    );
    process.exit(2);
  }
  const tools = new GitHistory(history);
  // Learn once, at the start, whether this git can run the tools.
  void tools.checkGit();
  void serve(process.stdin, process.stdout, tools).then(() => process.exit(0));
}

if (require.main === module) main();
