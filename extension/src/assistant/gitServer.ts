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
  capOutput,
  type ChangeHistory,
  gitArgs,
  gitServerName,
  gitTimeoutMs,
  gitToolDefinitions,
  historyVariables,
  maxOutputChars,
  parseRequest,
  Refusal,
  revisionsOf,
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
 * Git's environment: never prompting, and never taking a lock or rewriting
 * the index, even for a command that would refresh it.
 */
function gitEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
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

/** The git tools for one Change. */
export class GitHistory {
  constructor(
    readonly history: ChangeHistory,
    readonly limits: GitLimits = {
      maxChars: maxOutputChars,
      timeoutMs: gitTimeoutMs,
    },
    private readonly git = "git"
  ) {}

  async call(tool: string, input: unknown): Promise<ToolResult> {
    let request;
    const resolved: Record<string, string> = {};
    try {
      request = parseRequest(tool, input);
      for (const revision of revisionsOf(request))
        resolved[revision] = await this.inHistory(revision);
    } catch (err) {
      if (err instanceof Refusal) return { text: err.message, isError: true };
      throw err;
    }
    const run = await runCapped(
      this.git,
      gitArgs(request, resolved, this.history),
      this.history.repository,
      this.limits
    );
    if (run.timedOut)
      return {
        text: timeoutText(request, this.limits.timeoutMs),
        isError: true,
      };
    if (run.code !== 0 && !run.cut)
      return {
        text: `git ${tool} failed: ${run.stderr.trim() || `exit code ${run.code}`}`,
        isError: true,
      };
    return {
      text: toolText(request, run.output, run.cut, this.limits.maxChars),
      isError: false,
    };
  }

  /**
   * The commit the revision names, if the Change's base or head reaches it;
   * otherwise a Refusal, the same whether the commit is elsewhere or nowhere,
   * so nothing outside the Change's history reaches the conversation.
   */
  private async inHistory(revision: string): Promise<string> {
    const refused = new Refusal(
      `${revision} isn't a commit in the Change's history: the tools reach only commits that the Change's base (${this.history.base}) or head (${this.history.head}) has, them included.`
    );
    const parsed = await this.quiet([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);
    const commit = parsed.code === 0 ? parsed.stdout.trim() : "";
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw refused;
    for (const tip of [this.history.head, this.history.base]) {
      const ancestor = await this.quiet([
        "merge-base",
        "--is-ancestor",
        commit,
        tip,
      ]);
      if (ancestor.code === 0) return commit;
    }
    throw refused;
  }

  private quiet(args: string[]): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve) => {
      execFile(
        this.git,
        [
          "--no-pager",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          ...args,
        ],
        {
          cwd: this.history.repository,
          env: gitEnvironment(),
          timeout: this.limits.timeoutMs,
        },
        (err, stdout) => {
          // Its code is git's exit code, or a string when git didn't run.
          const code = (err as { code?: unknown } | null)?.code;
          resolve({
            code: !err ? 0 : typeof code === "number" ? code : -1,
            stdout,
          });
        }
      );
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
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
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
  const params = message.params ?? {};
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
  void serve(process.stdin, process.stdout, new GitHistory(history)).then(() =>
    process.exit(0)
  );
}

if (require.main === module) main();
