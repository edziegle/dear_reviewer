// Takes the marketing screenshots, in a dark and a light theme: the Dashboard,
// a Change's overview, a diff with Comments, Findings, the Assistant and Code
// Flow. Run it with `mise run screenshots`; it is not part of `mise run test`.
// The story is one pull request, "Retry payment charges with backoff", which
// has a real problem for the Findings to point at: it retries a charge that
// isn't idempotent.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAssistant,
  replyTurn,
  scriptClaude,
  showAssistant,
} from "../assistant";
import { renderedPanel, summaryWritten } from "../assistant";
import { capture, settle, sizeWindow } from "../capture";
import { changeFiles, select, type FileEntry } from "../changeFiles";
import { codeFlowPanel, showCodeFlow } from "../codeFlow";
import { findIssues, findingsView } from "../findings";
import { gitIn } from "../git";
import {
  configure,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { comment } from "../review";
import { closeChange, eventually, openChange, short } from "../reviewer";
import { showTimeline } from "../timeline";
import { showDashboard } from "../dashboard";

const viewer = { login: "reviewer", token: "test-token" };
const themes = [
  ["dark", "Default Dark Modern"],
  ["light", "Default Light Modern"],
] as const;
const hour = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const files: Record<string, string> = {
  "tsconfig.json": JSON.stringify(
    { compilerOptions: { target: "es2022", module: "commonjs", strict: true } },
    null,
    2
  ),
  "src/payments/retry.ts": `export interface RetryOptions {
  attempts: number;
  delayMs: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(options.delayMs);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`,
  "src/payments/client.ts": `import { withRetry } from "./retry";

export interface Charge {
  id: string;
  cents: number;
}

export class PaymentClient {
  constructor(private readonly baseUrl: string) {}

  async charge(customerId: string, cents: number): Promise<Charge> {
    return withRetry(() => this.post("/charges", { customerId, cents }), {
      attempts: 3,
      delayMs: 500,
    });
  }

  async refund(chargeId: string): Promise<void> {
    await this.post(\`/charges/\${chargeId}/refund\`, {});
  }

  private async post(route: string, body: object): Promise<Charge> {
    const response = await fetch(this.baseUrl + route, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(\`Payment API said \${response.status}\`);
    return (await response.json()) as Charge;
  }
}
`,
};

const retryAfter = `import { PaymentError } from "./errors";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetry: RetryOptions = {
  attempts: 5,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = defaultRetry
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, options));
    }
  }
  throw lastError;
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof PaymentError) {
    return error.status >= 500 || error.status === 429;
  }
  return true;
}

export function backoffDelay(attempt: number, options: RetryOptions): number {
  const exponential = options.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * exponential;
  return Math.min(options.maxDelayMs, exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;

const errorsAfter = `export class PaymentError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
`;

const clientAfter = files["src/payments/client.ts"]
  .replace(
    'import { withRetry } from "./retry";',
    'import { PaymentError } from "./errors";\nimport { withRetry } from "./retry";'
  )
  .replace(
    `    return withRetry(() => this.post("/charges", { customerId, cents }), {
      attempts: 3,
      delayMs: 500,
    });`,
    `    return withRetry(() => this.post("/charges", { customerId, cents }));`
  )
  .replace(
    "throw new Error(`Payment API said ${response.status}`)",
    "throw new PaymentError(response.status, `Payment API said ${response.status}`)"
  );

const testAfter = `import assert from "node:assert";
import { test } from "node:test";
import { backoffDelay, isRetryable } from "../src/payments/retry";
import { PaymentError } from "../src/payments/errors";

const options = { attempts: 5, baseDelayMs: 100, maxDelayMs: 1_000 };

test("backoff never exceeds the maximum", () => {
  for (let attempt = 1; attempt < 20; attempt++) {
    assert.ok(backoffDelay(attempt, options) <= options.maxDelayMs);
  }
});

test("only server errors and rate limits are retried", () => {
  assert.equal(isRetryable(new PaymentError(503, "down")), true);
  assert.equal(isRetryable(new PaymentError(429, "slow down")), true);
  assert.equal(isRetryable(new PaymentError(402, "declined")), false);
});
`;

const summary = [
  "Charges to the payment API now retry with **exponential backoff and jitter** instead of a fixed half-second pause.",
  "",
  "- `src/payments/retry.ts:23` is the heart of it: `withRetry` stops at once on errors that retrying can't fix.",
  "- `src/payments/client.ts:12` drops its own retry settings for the new defaults.",
  "- A new `PaymentError` carries the HTTP status, so `isRetryable` can tell a decline from an outage.",
  "",
  "Start with `src/payments/retry.ts:23`. Worth a close look: `charge` is retried, and a charge isn't safe to repeat.",
].join("\n");

const findingsReply = JSON.stringify({
  findings: [
    {
      path: "src/payments/client.ts",
      side: "head",
      startLine: 12,
      endLine: 12,
      message:
        "`charge` is retried but sends no idempotency key, so a timeout after the bank accepted the charge can bill the customer twice.",
    },
    {
      path: "src/payments/retry.ts",
      side: "head",
      startLine: 40,
      endLine: 40,
      message:
        "Network errors that aren't `PaymentError`s are always retried, including a request that already reached the server.",
    },
    {
      path: "src/payments/retry.ts",
      side: "head",
      startLine: 45,
      endLine: 47,
      message:
        "The jitter is added on top of the exponential delay, so the delay can reach twice `baseDelayMs * 2 ** attempt` before `Math.min` caps it. Full jitter, `random() * exponential`, spreads retries better.",
    },
  ],
});

const readingOrder = [
  "```json",
  JSON.stringify({
    steps: [
      {
        label: "The new policy",
        files: [
          { path: "src/payments/errors.ts", why: "carries the HTTP status" },
          {
            path: "src/payments/retry.ts",
            why: "backoff and what gets retried",
          },
        ],
      },
      {
        label: "Who uses it",
        files: [
          {
            path: "src/payments/client.ts",
            why: "charge() now retries by default",
          },
          { path: "test/retry.test.ts", why: "pins the policy down" },
        ],
      },
    ],
  }),
  "```",
].join("\n");

const askAnswer = [
  "Yes, `charge` is the risky one. Here is how a duplicate happens:",
  "",
  "1. `client.ts:12` calls `withRetry`, and `post` sends the charge.",
  "2. The bank accepts it, but the response times out.",
  "3. `isRetryable` (`retry.ts:38`) returns `true` for anything that isn't a `PaymentError`, so the charge is sent again.",
  "",
  "`refund` doesn't use `withRetry`, so it isn't affected. A fix is an idempotency key per charge, sent as a header and reused across attempts.",
].join("\n");

/** The line, counted from 1, of the first line in the file containing the text. */
function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`no "${needle}" in the file`);
  return index + 1;
}

function find(entries: FileEntry[], label: string): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.label === label) return entry;
    const inside = find(entry.children, label);
    if (inside) return inside;
  }
}

/** Starts a scene from clean editors, so each shot shows only its own panels. */
async function fresh() {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
}

/** Takes the screenshot in each theme. */
async function shoot(name: string) {
  for (const [suffix, theme] of themes) {
    await vscode.workspace
      .getConfiguration("workbench")
      .update("colorTheme", theme, vscode.ConfigurationTarget.Global);
    await settle(1000);
    await capture(`${name}-${suffix}`);
  }
}

describe("Marketing screenshots", function () {
  this.timeout(10 * 60_000);
  const root = process.env.DEAR_REVIEWER_FIXTURES!;
  const scene = path.join(root, "payments-api");
  const remotes = path.join(root, "remotes");
  const upstream = path.join(remotes, "acme", "payments-api.git");
  const clone = path.join(root, "payments-api-clone");
  const repository = "acme/payments-api";
  const number = 128;
  let change: {
    repository: string;
    base: string;
    head: string;
    pullRequest: { repository: string; number: number };
  };
  let title = "";
  let headFolder = "";
  const settings = new Map<string, unknown>();

  before(async () => {
    const git = (...args: string[]) => gitIn(scene, ...args);
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(scene, file)), { recursive: true });
      fs.writeFileSync(path.join(scene, file), text);
    };
    const commit = (message: string, date: string) => {
      git("add", "-A");
      gitIn(
        scene,
        "-c",
        `user.name=Alice Park`,
        "-c",
        "user.email=alice@example.com",
        "commit",
        "-q",
        "--date",
        date,
        "-m",
        message
      );
      return git("rev-parse", "HEAD");
    };
    fs.rmSync(scene, { recursive: true, force: true });
    fs.mkdirSync(scene, { recursive: true });
    git("init", "-q", "-b", "main");
    for (const [file, text] of Object.entries(files)) write(file, text);
    const base = commit("Add the payment client", ago(20 * 24 * hour));

    write("src/payments/errors.ts", errorsAfter);
    write("src/payments/retry.ts", retryAfter);
    const first = commit(
      "Back off exponentially between retries",
      ago(3 * 24 * hour)
    );
    write("src/payments/client.ts", clientAfter);
    const second = commit(
      "Use the default retry policy in the client",
      ago(2 * 24 * hour)
    );
    write("test/retry.test.ts", testAfter);
    const head = commit("Test the retry policy", ago(26 * hour));

    // GitHub has the pull request; the Reviewer's clone has only main.
    fs.rmSync(remotes, { recursive: true, force: true });
    fs.mkdirSync(upstream, { recursive: true });
    gitIn(upstream, "init", "-q", "--bare", "-b", "main");
    gitIn(upstream, "fetch", "-q", scene, `+${base}:refs/heads/main`);
    gitIn(upstream, "fetch", "-q", scene, `+${head}:refs/pull/${number}/head`);
    fs.rmSync(clone, { recursive: true, force: true });
    fs.mkdirSync(clone);
    gitIn(clone, "init", "-q", "-b", "main");
    gitIn(clone, "remote", "add", "origin", upstream);
    gitIn(clone, "remote", "add", "upstream", upstream);
    gitIn(clone, "fetch", "-q", "--all");
    gitIn(clone, "checkout", "-q", "-B", "main", "upstream/main");

    // A branch of the Reviewer's own, ahead of main.
    git("checkout", "-q", "-b", "idempotency", base);
    write(
      "src/payments/idempotency.ts",
      "export const idempotencyKey = () => crypto.randomUUID();\n"
    );
    const own = commit("Add idempotency keys", ago(3 * hour));
    gitIn(
      clone,
      "fetch",
      "-q",
      scene,
      `+${own}:refs/heads/feature/idempotency-keys`
    );
    // The pull request's commits, which the clone has by now, as it would after a first look.
    gitIn(
      clone,
      "fetch",
      "-q",
      scene,
      `+${head}:refs/remotes/upstream/alice-retry-backoff`
    );

    change = {
      repository: clone,
      base,
      head,
      pullRequest: { repository, number },
    };
    title = `${path.basename(clone)} ${short(base)}..${short(head)}`;

    const pullRequest: FakePullRequest = {
      repository,
      number,
      title: "Retry payment charges with backoff",
      author: "alice",
      createdAt: ago(3 * 24 * hour),
      reviewRequested: ["reviewer"],
      reviewRequestedAt: ago(2.5 * hour),
      headRefName: "alice/retry-backoff",
      baseRefName: "main",
      headSha: head,
      additions: 71,
      deletions: 9,
      checks: "FAILURE",
      checkRuns: [
        {
          type: "checkRun",
          name: "build",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        {
          type: "checkRun",
          name: "lint",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        {
          type: "checkRun",
          name: "unit-tests",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        {
          type: "checkRun",
          name: "integration-tests",
          status: "COMPLETED",
          conclusion: "FAILURE",
        },
      ],
      reviewDecision: "REVIEW_REQUIRED",
      body: [
        "Payment charges failed for good whenever the API hiccuped. This retries them with exponential backoff and jitter.",
        "",
        "- New `PaymentError` carries the HTTP status",
        "- `withRetry` gives up at once on declines (4xx other than 429)",
        "- Backoff is capped at 10 seconds",
        "",
        "Closes #97.",
      ].join("\n"),
      files: [
        { path: "src/payments/client.ts" },
        { path: "src/payments/errors.ts" },
        { path: "src/payments/retry.ts" },
        { path: "test/retry.test.ts" },
      ],
      timeline: [
        {
          type: "commit",
          sha: first,
          message: "Back off exponentially between retries",
          author: "alice",
          date: ago(3 * 24 * hour),
        },
        {
          type: "commit",
          sha: second,
          message: "Use the default retry policy in the client",
          author: "alice",
          date: ago(2 * 24 * hour),
        },
        {
          type: "comment",
          author: "bob",
          body: "Nice. Do we want jitter here? Thundering herds bit us in the ledger service.",
          date: ago(2 * 24 * hour - hour),
        },
        {
          type: "comment",
          author: "alice",
          body: "Added in the first commit. I'll push tests next.",
          date: ago(2 * 24 * hour - 2 * hour),
        },
        {
          type: "commit",
          sha: head,
          message: "Test the retry policy",
          author: "alice",
          date: ago(26 * hour),
        },
      ],
      reviews: [
        {
          id: "PRR_bob",
          author: "bob",
          state: "COMMENTED",
          body: "Looks close. A couple of questions.",
          submittedAt: ago(40 * hour),
          commit: second,
          threads: [
            {
              id: "PRRT_bob1",
              path: "src/payments/retry.ts",
              side: "RIGHT",
              line: lineOf(retryAfter, "const jitter"),
              comments: [
                {
                  id: "PRRC_bob1",
                  body: "Is `Math.random()` fine here, or do we want something we can seed in tests?",
                  createdAt: ago(40 * hour),
                },
              ],
            },
          ],
        },
      ],
    };
    const others: FakePullRequest[] = [
      {
        repository: "acme/web-checkout",
        number: 412,
        title: "Show saved cards first at checkout",
        author: "carol",
        createdAt: ago(5 * 24 * hour),
        reviewRequested: ["reviewer"],
        reviewRequestedAt: ago(20 * hour),
        files: [{ path: "src/cards.tsx" }],
        additions: 86,
        deletions: 31,
        checks: "SUCCESS",
      },
      {
        repository: "acme/ledger",
        number: 77,
        title: "Reconcile refunds nightly",
        author: "dmitri",
        createdAt: ago(9 * 24 * hour),
        reviewRequested: ["reviewer"],
        reviewRequestedAt: ago(6 * 24 * hour),
        files: [{ path: "reconcile.py" }],
        additions: 240,
        deletions: 12,
        checks: "PENDING",
      },
      {
        repository,
        number: 131,
        title: "Add idempotency keys to charges",
        author: "reviewer",
        createdAt: ago(3 * hour),
        headRefName: "feature/idempotency-keys",
        files: [{ path: "src/payments/idempotency.ts" }],
        additions: 18,
        deletions: 2,
        checks: "SUCCESS",
        reviewDecision: "REVIEW_REQUIRED",
      },
    ];

    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of ["githubApiUrl", "repositories", "localClones"])
      settings.set(key, config.inspect(key)?.globalValue);
    await serveGitHub({ viewer, pullRequests: [pullRequest, ...others] });
    await configure({
      repositories: [repository, "acme/web-checkout", "acme/ledger"],
    });
    await config.update(
      "localClones",
      { [repository]: clone },
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await scriptClaude(change, {
      turns: [
        replyTurn(summary),
        replyTurn(findingsReply),
        replyTurn(askAnswer),
      ],
      readingOrder: replyTurn(readingOrder),
    });
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("workbench.action.closePanel");
    sizeWindow(1600, 1000);
    await settle(2000);
  });

  after(async () => {
    await closeChange(change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const [key, value] of settings)
      await config.update(key, value, vscode.ConfigurationTarget.Global);
  });

  it("the Dashboard", async () => {
    await refreshInbox();
    await showDashboard();
    await settle(2000);
    await shoot("dashboard");
  });

  it("the Change overview", async () => {
    await openChange(change);
    const take = await summaryWritten(title);
    if (!take.text) throw new Error("no summary was written");
    await fresh();
    await showTimeline(change);
    await settle(3000);
    await shoot("overview");
  });

  it("a diff with Comments", async () => {
    await fresh();
    const entry = find(await changeFiles(), "retry.ts");
    if (!entry) throw new Error("no retry.ts in the Change files");
    await select(entry);
    await settle(2000);
    const folder = vscode.workspace.workspaceFolders!.find(
      (f) =>
        fs.existsSync(path.join(f.uri.fsPath, "src/payments/retry.ts")) &&
        fs.readFileSync(
          path.join(f.uri.fsPath, "src/payments/retry.ts"),
          "utf8"
        ) === retryAfter
    );
    headFolder = folder!.uri.fsPath;
    const line = lineOf(retryAfter, "return true;") - 1;
    const thread = await comment(
      path.join(headFolder, "src/payments/retry.ts"),
      line,
      line,
      "Any other error is retried, even one that already reached the server. For a charge that can bill twice. Should this default to `false`?",
      "startReview"
    );
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await settle(1000);
    await shoot("diff");
  });

  it("Findings", async () => {
    await findIssues(change);
    await eventually(async () => {
      if ((await findingsView()).length === 0)
        throw new Error("no Findings yet");
    }, 60_000);
    await fresh();
    await vscode.commands.executeCommand("dearReviewer.nextFinding");
    await settle(1500);
    await vscode.commands.executeCommand("editor.action.showHover");
    await settle(1500);
    await shoot("findings");
  });

  it("the Assistant", async () => {
    await fresh();
    await showTimeline(change);
    await showAssistant(change);
    await askAssistant(
      title,
      "Could the retry in charge() bill a customer twice?"
    );
    await eventually(async () => {
      const panel = await renderedPanel(title);
      const last = panel?.messages.at(-1);
      if (!panel || panel.busy || last?.from !== "assistant")
        throw new Error("the Assistant is still answering");
    }, 60_000);
    await shoot("assistant");
  });

  it("Code Flow", async () => {
    await fresh();
    await showCodeFlow(change);
    await eventually(async () => {
      const panel = await codeFlowPanel("acme/payments-api #128");
      if (
        !panel?.rendered ||
        panel.rendered.loading ||
        panel.rendered.flow.nodes.length < 2
      )
        throw new Error(
          `Code Flow hasn't drawn yet: ${JSON.stringify(panel?.rendered ?? panel?.sent)?.slice(0, 1500)}`
        );
    }, 120_000);
    await shoot("code-flow");
  });
});
