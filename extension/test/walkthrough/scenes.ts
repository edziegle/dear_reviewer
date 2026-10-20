// The screens of the setup walkthrough's images (package.json,
// contributes.walkthroughs): each is a real webview, the Dashboard, the
// Assistant's view or a Change's overview, given a state for the story of
// "Retry failed webhooks with exponential backoff". `capture.mjs` draws them.

import type * as vscode from "vscode";
import { AssistantView } from "../../src/assistant/panel";
import { DashboardView, type DashboardState } from "../../src/dashboard/view";
import { TimelinePanel, type TimelineState } from "../../src/timeline/panel";
import { latestWebview, stubView, type StubWebview } from "./vscodeStub";

/** Where a screen sits, which sets its background: the side bar or an editor. */
type Surface = "sideBar" | "editor";

export interface Scene {
  /** The image's name, such as `signin` for `signin-dark.png`. */
  name: string;
  surface: Surface;
  width: number;
  height: number;
  /** Makes the webview, which then waits for its page to say it is ready. */
  open(): StubWebview;
}

const noop = () => undefined;
const uri = (path: string) => ({ fsPath: path }) as vscode.Uri;
const view = () => stubView() as unknown as vscode.WebviewView;

const emptyDashboard: DashboardState = {
  inProgress: [],
  branches: [],
  loading: false,
  problems: [],
  branchProblems: [],
};

function dashboard(state: Partial<DashboardState>): StubWebview {
  const dashboardView = new DashboardView(
    { ...emptyDashboard, ...state },
    uri("/avatars"),
    noop
  );
  dashboardView.resolveWebviewView(view());
  return latestWebview();
}

const take =
  "This change moves webhook retries from a fixed 3-attempt loop to an exponential backoff queue backed by Redis. The core is the new `RetryScheduler` in `src/webhooks/retry.py:42`, which replaces the inline loop in the dispatcher. Start there, then check the migration that adds the `attempts` column.";

const changedFiles = new Set([
  "src/webhooks/retry.py",
  "src/webhooks/dispatcher.py",
  "migrations/0042_attempts.py",
]);

const overview: TimelineState = {
  title: "Retry failed webhooks with exponential backoff",
  byline: "acme/api #482 · octocat → main",
  url: "https://github.com/acme/api/pull/482",
  size: { files: 12, additions: 340, deletions: 58 },
  standing: ["3 of 12 viewed"],
  progress: { viewed: 3, total: 12 },
  pending: 0,
  take: { label: "Assistant", reading: false, text: take },
  readingOrder: {
    writing: false,
    outOfDate: false,
    steps: [
      {
        label: "The scheduler",
        files: [
          {
            path: "src/webhooks/retry.py",
            why: "the new backoff queue",
            viewed: true,
          },
          {
            path: "src/webhooks/dispatcher.py",
            why: "drops the inline loop",
            viewed: false,
          },
        ],
      },
      {
        label: "Storage",
        files: [
          {
            path: "migrations/0042_attempts.py",
            why: "adds the attempts column",
            viewed: false,
          },
        ],
      },
    ],
  },
  finish: "Submit Review…",
  history: "Timeline",
  loading: false,
  items: [],
};

function change(state: Partial<TimelineState>): StubWebview {
  new TimelinePanel(
    { ...overview, ...state },
    "acme/api #482",
    uri("/avatars"),
    (path) => changedFiles.has(path),
    noop,
    false
  );
  return latestWebview();
}

export const scenes: Scene[] = [
  {
    name: "signin",
    surface: "sideBar",
    width: 340,
    height: 150,
    open: () =>
      dashboard({
        setup: {
          text: "Sign in to GitHub to list the pull requests waiting on you and the ones you authored.",
          actions: [
            { id: "signIn", label: "Sign In to GitHub" },
            { id: "setToken", label: "Use a Personal Access Token" },
            { id: "openSetup", label: "Set Up Dear Reviewer" },
          ],
        },
      }),
  },
  {
    name: "repos",
    surface: "sideBar",
    width: 340,
    height: 230,
    open: () =>
      dashboard({
        setup: {
          text: "The Dashboard lists pull requests from the GitHub repositories you have open in your windows. Open a clone of one, or add a clone from elsewhere on this machine.",
          actions: [
            { id: "addRepository", label: "Add Repository…" },
            { id: "openFolder", label: "Open Folder…" },
            { id: "openSetting", label: "Repositories Setting" },
          ],
        },
      }),
  },
  {
    name: "claude",
    surface: "sideBar",
    width: 900,
    height: 600,
    open: () => {
      const assistant = new AssistantView(noop);
      assistant.resolveWebviewView(view());
      const webview = latestWebview();
      // The state waits for the page's ready, which sends it.
      assistant.update({
        name: "acme/api #482",
        range: "3f2a1c0..9be41d7",
        login: "eric@example.com (Claude Max)",
        busy: false,
        messages: [
          { from: "assistant", text: take },
          {
            from: "reviewer",
            text: "Why is the max delay unbounded here?",
            context: [
              {
                path: "src/webhooks/retry.py",
                side: "head",
                startLine: 61,
                endLine: 64,
              },
            ],
          },
        ],
      });
      return webview;
    },
  },
  {
    name: "trust",
    surface: "editor",
    width: 900,
    height: 470,
    open: () => change({ navigationOff: true }),
  },
  {
    name: "open",
    surface: "sideBar",
    width: 340,
    height: 400,
    open: () =>
      dashboard({
        facts: "2 waiting on you · oldest 4 days",
        next: {
          kind: "open",
          id: "acme/infra#1203",
          label: "Review acme/infra #1203",
          place: "acme/infra #1203 has waited longest on you: 4 days",
        },
        waiting: [
          {
            id: "acme/infra#1203",
            title: "Bump terraform-aws-modules/vpc to 5.8",
            name: "acme/infra #1203",
            author: "renovate[bot]",
            waited: "4 days",
            size: { files: 3, additions: 12, deletions: 9 },
            checks: "passed",
            notes: [],
          },
          {
            id: "acme/api#490",
            title:
              "Add per-tenant rate limits to the ingest API and the billing exporter",
            name: "acme/api #490",
            author: "a-very-long-login-name",
            waited: "1 day",
            size: { files: 31, additions: 120, deletions: 2204 },
            checks: "running",
            notes: ["new commits since your Review"],
          },
        ],
      }),
  },
  {
    name: "read",
    surface: "editor",
    width: 900,
    height: 470,
    open: () => change({}),
  },
  {
    name: "finish",
    surface: "editor",
    width: 900,
    height: 480,
    open: () =>
      change({
        standing: ["2 pending Comments", "12 of 12 viewed"],
        progress: { viewed: 12, total: 12 },
        pending: 2,
        submit: {
          asked: 1,
          verdict: "approve",
          verdicts: [
            {
              verdict: "comment",
              label: "Comment",
              detail: "Publish your summary and Comments without approving.",
            },
            {
              verdict: "approve",
              label: "Approve",
              detail: "Publish your summary and Comments, and approve merging.",
            },
            {
              verdict: "requestChanges",
              label: "Request Changes",
              detail:
                "Publish your summary and Comments as changes to make first.",
            },
          ],
          needsSummary: {},
          comments: [
            {
              path: "src/webhooks/retry.py",
              side: "RIGHT",
              line: 61,
              text: "Cap the delay: an unbounded backoff can push a retry past the webhook's expiry.",
            },
            {
              path: "src/webhooks/dispatcher.py",
              side: "LEFT",
              line: 12,
              text: "Suggested change",
            },
          ],
          submitting: false,
        },
      }),
  },
];
