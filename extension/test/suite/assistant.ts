// Scripts the fake `claude`, reads back what it received, and reads the
// Assistant panel and the Claude login the way the Reviewer sees them.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  FakeClaudeLogin,
  FakeClaudeScript,
  McpResult,
  RecordedClaudeCall,
  ScriptedTurns,
} from "../fakeClaude";
import { mcpCall, readingOrderRequest, toolUse, waitFor } from "../fakeClaude";
import { eventually, type ChangeRequest } from "./reviewer";
import type { Take } from "./timeline";

export type {
  FakeClaudeLogin,
  FakeClaudeScript,
  McpResult,
  RecordedClaudeCall,
};
export { mcpCall, toolUse, waitFor };

export function fakeClaudePath(): string {
  const file = process.env.DEAR_REVIEWER_FAKE_CLAUDE;
  if (!file) throw new Error("DEAR_REVIEWER_FAKE_CLAUDE is not set");
  return file;
}

function fakeClaudeDir(): string {
  const dir = process.env.DEAR_REVIEWER_FAKE_CLAUDE_DIR;
  if (!dir) throw new Error("DEAR_REVIEWER_FAKE_CLAUDE_DIR is not set");
  return dir;
}

/**
 * The fake's state for the conversation of the Change the request opens, or
 * opened while it is open, under the name of the folder Dear Reviewer runs
 * the conversation's `claude` in. A Change the Inbox opened from a branch
 * has the branch's conversation, so name the branch as the request's head
 * before it opens.
 */
async function conversationDir(change: ChangeRequest): Promise<string> {
  const folder = await (await assistantApi()).conversationFolder(change);
  return path.join(fakeClaudeDir(), "conversations", folder);
}

/**
 * Scripts what the Assistant answers in the conversation of the Change this
 * request opens, or opened, and forgets the conversation's runs so far.
 *
 * The script's turns answer the conversation's user messages from now on,
 * in order: for a conversation that hasn't started, the first is its
 * summary. A conversation already going on gets them from its next message.
 * Other Changes' conversations keep their own scripts, and a conversation no
 * test scripted gets a short summary for every turn.
 */
export async function scriptClaude(
  change: ChangeRequest,
  script: FakeClaudeScript
): Promise<void> {
  const dir = await conversationDir(change);
  fs.rmSync(path.join(dir, "calls"), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // A new generation starts the turns again, even for a turn already counting.
  const scripted: ScriptedTurns = {
    ...script,
    generation: crypto.randomUUID(),
  };
  writeAtOnce(path.join(dir, "script.json"), scripted);
}

/**
 * Replaces how the fake `claude` answers `claude auth status`, by default
 * signed in with a Claude subscription, and forgets the login checks so far.
 * A test that signs out puts the default back when it ends.
 */
export function scriptClaudeLogin(login: FakeClaudeLogin = {}): void {
  const dir = fakeClaudeDir();
  fs.rmSync(path.join(dir, "calls"), { recursive: true, force: true });
  writeAtOnce(path.join(dir, "login.json"), login);
}

/** Writes the JSON so that a run reading the file never finds it half written. */
function writeAtOnce(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}

/** Lets a turn held back by `waitFor(name)` go on. */
export function releaseClaude(name: string): void {
  fs.writeFileSync(path.join(fakeClaudeDir(), name), "");
}

/** Makes the fake `claude` forget every session, as if Claude Code had lost them. */
export function forgetClaudeSessions(): void {
  fs.rmSync(path.join(fakeClaudeDir(), "sessions"), {
    recursive: true,
    force: true,
  });
}

function callsIn(dir: string): RecordedClaudeCall[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) =>
      BigInt(a.split("-")[0]) < BigInt(b.split("-")[0]) ? -1 : 1
    )
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/**
 * The runs of the fake `claude` outside any conversation, such as
 * `claude auth status`, since its login was last scripted, oldest first.
 */
export function loginChecks(): RecordedClaudeCall[] {
  return callsIn(path.join(fakeClaudeDir(), "calls"));
}

/**
 * The runs of the Change's conversation, each in print mode, that recorded
 * anything since the test last scripted it, oldest first. A run already
 * going on then comes back once it receives a message, with everything it
 * received.
 */
export async function assistantRuns(
  change: ChangeRequest
): Promise<RecordedClaudeCall[]> {
  return callsIn(path.join(await conversationDir(change), "calls"));
}

/** The value after a flag, such as `--tools`. */
export function flag(
  call: RecordedClaudeCall,
  name: string
): string | undefined {
  const i = call.args.indexOf(name);
  return i >= 0 ? call.args[i + 1] : undefined;
}

/**
 * The text of the user messages the run received, leaving out the requests
 * for a Reading Order, which the fake answers on the side.
 */
export function userMessages(call: RecordedClaudeCall): string[] {
  return messagesOf(call).filter((m) => !m.includes(readingOrderRequest));
}

/** The requests for a Reading Order the run received. */
export function readingOrderRequests(call: RecordedClaudeCall): string[] {
  return messagesOf(call).filter((m) => m.includes(readingOrderRequest));
}

function messagesOf(call: RecordedClaudeCall): string[] {
  return call.input
    .filter((m) => m.type === "user")
    .map((m) => {
      const content = (m.message as { content: unknown }).content;
      if (typeof content === "string") return content;
      return (content as { type: string; text?: string }[])
        .map((block) => block.text ?? "")
        .join("");
    });
}

export function setClaudePath(file: string): Thenable<void> {
  return vscode.workspace
    .getConfiguration("dearReviewer")
    .update("claudePath", file, vscode.ConfigurationTarget.Global);
}

/** Lines of a file on one side of a Change, counted from 1. */
export interface Selection {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  side: "base" | "head";
  startLine: number;
  endLine: number;
}

/** Something the Assistant did while working on a reply, such as reading a file. */
export interface Step {
  /** Such as "Reading". */
  doing: string;
  /** Such as a path relative to the worktree, or a search pattern. */
  subject?: string;
}

export interface Conversation {
  /** The Change's name, which the panel's tab and heading show. */
  name: string;
  /** The Change's commits, such as `3f2a1c0..9be41d7`, under the heading. */
  range: string;
  /** The Claude login the Assistant runs on, as the panel shows it. */
  login?: string;
  /** Whether the Assistant is still working. */
  busy: boolean;
  /** What the Assistant has done so far in the turn it is working on. */
  steps?: Step[];
  messages: {
    from: "assistant" | "reviewer" | "note";
    text: string;
    /** The selections the Reviewer sent with the message. */
    context?: Selection[];
    /** An Assistant reply's Markdown, rendered and sanitised. */
    html?: string;
  }[];
  /** Selections waiting to go with the Reviewer's next message. */
  context?: (Selection & { text: string })[];
  /** What went wrong, in words for the Reviewer. */
  problem?: string;
  /** The button that goes with the problem, by its label. */
  problemAction?: string;
  /** Whether `claude` couldn't run, so Send is off and Retry shows. */
  unavailable?: boolean;
  /** Whether Stop shows, for the turn under way. */
  stoppable?: boolean;
}

interface AssistantApi {
  /**
   * Each Assistant panel: the state last sent to it, the state it last
   * rendered, and a way to send it what the webview would.
   */
  panels(): {
    title: string;
    sent: Conversation;
    rendered?: Conversation;
    receive(message: unknown): void;
  }[];
  /** What each running Assistant has for its Change's overview, by the Change's title. */
  overviews(): { title: string; take: Take }[];
  /** The Assistant's status bar item, once a login has been checked. */
  loginStatus(): LoginStatus | undefined;
  /** The name of the folder the request's Change's conversation runs `claude` in. */
  conversationFolder(request: ChangeRequest): Promise<string>;
}

async function assistantApi(): Promise<AssistantApi> {
  const extension = vscode.extensions.getExtension<{
    assistant: AssistantApi;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).assistant;
}

/**
 * What the Change's Assistant panel has rendered, if it has one, leaving out
 * the replies' rendered Markdown, which `renderedPanelWithHtml` gives.
 */
export async function renderedPanel(
  title: string
): Promise<Conversation | undefined> {
  const rendered = await renderedPanelWithHtml(title);
  if (!rendered) return rendered;
  return {
    ...rendered,
    messages: rendered.messages.map(({ html: _, ...message }) => message),
  };
}

/** What the Change's Assistant panel has rendered, with each reply's HTML. */
export async function renderedPanelWithHtml(
  title: string
): Promise<Conversation | undefined> {
  return (await assistantApi()).panels().find((p) => p.title === title)
    ?.rendered;
}

async function sendToPanel(title: string, message: unknown): Promise<void> {
  const panel = (await assistantApi()).panels().find((p) => p.title === title);
  if (!panel) throw new Error(`No Assistant panel for ${title}`);
  panel.receive(message);
}

/** What the Assistant has for the Change's overview, while it runs, by the Change's title. */
export async function assistantTake(title: string): Promise<Take | undefined> {
  return (await assistantApi()).overviews().find((o) => o.title === title)
    ?.take;
}

/** Waits until the Assistant has written what the Change's overview shows. */
export async function summaryWritten(title: string): Promise<Take> {
  let take: Take | undefined;
  await eventually(async () => {
    take = await assistantTake(title);
    if (!take || take.reading) throw new Error(`no summary of ${title} yet`);
  });
  return take!;
}

/** Types the message into the Change's Assistant panel and sends it. */
export function askAssistant(title: string, text: string): Promise<void> {
  return sendToPanel(title, { type: "ask", text });
}

/** Clicks a link in a reply. */
export function clickReplyLink(title: string, url: string): Promise<void> {
  return sendToPanel(title, { type: "openLink", url });
}

/** Clicks a `path:line` or `path:start-end` reference in a reply. */
export function clickReference(
  title: string,
  reference: { path: string; startLine: number; endLine: number }
): Promise<void> {
  return sendToPanel(title, { type: "openReference", ...reference });
}

/** Clicks Stop while the Assistant writes a reply. */
export function stopAssistant(title: string): Promise<void> {
  return sendToPanel(title, { type: "stop" });
}

/** Clicks Retry in the panel's problem, which starts the Assistant again. */
export function retryAssistant(title: string): Promise<void> {
  return sendToPanel(title, { type: "retry" });
}

/** Clicks the remove button of a selection waiting in the panel, counted from 0. */
export function removeSelection(title: string, index: number): Promise<void> {
  return sendToPanel(title, { type: "removeContext", index });
}

/**
 * Selects lines of the file or document, counted from 0, in an editor, and
 * runs Send Selection to Assistant on them.
 */
export async function sendSelection(
  file: string | vscode.Uri,
  startLine: number,
  endLine: number
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(
    typeof file === "string" ? vscode.Uri.file(file) : file
  );
  const end = document.lineAt(endLine).range.end;
  await vscode.window.showTextDocument(document, {
    selection: new vscode.Range(startLine, 0, end.line, end.character),
    preview: false,
  });
  await vscode.commands.executeCommand("dearReviewer.sendSelectionToAssistant");
}

/**
 * Shows the file or document in an editor, with these lines selected,
 * counted from 0, or with nothing selected, and runs Ask the Assistant.
 */
export async function askAboutFile(
  file: string | vscode.Uri,
  lines?: { startLine: number; endLine: number }
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(
    typeof file === "string" ? vscode.Uri.file(file) : file
  );
  const end = lines && document.lineAt(lines.endLine).range.end;
  await vscode.window.showTextDocument(document, {
    selection:
      lines && end
        ? new vscode.Range(lines.startLine, 0, end.line, end.character)
        : new vscode.Range(0, 0, 0, 0),
    preview: false,
  });
  await vscode.commands.executeCommand("dearReviewer.askAssistant");
}

export interface LoginStatus {
  name: string;
  text: string;
  tooltip?: string;
  /** Whether the item has the warning background. */
  warning: boolean;
}

export async function loginStatus(): Promise<LoginStatus | undefined> {
  return (await assistantApi()).loginStatus();
}

/**
 * Runs Show Assistant on the Change, which opens its chat panel. Showing a
 * Change closes every other Change's panel, though their conversations go
 * on, so a test that shows another Change runs this again for a panel.
 */
export function showAssistant(change: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showAssistant", change);
}

/** The note an Assistant panel starts with: the summary itself is in the Change's overview. */
export const summaryNote = {
  from: "note",
  text: "The Assistant's summary of this Change is in its overview.",
} as const;

/** The editor tabs that hold a webview, such as the Assistant panel, by label. */
export function webviewTabs(): string[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview)
    .map((tab) => tab.label);
}

/** A turn in which the Assistant replies to a request for Findings with one Finding on `util.py`'s `line`. */
export function findingTurn(
  line: number,
  message = `Look at line ${line}.`
): Record<string, unknown>[] {
  return replyTurn(
    JSON.stringify({
      findings: [
        {
          path: "util.py",
          side: "head",
          startLine: line,
          endLine: line,
          message,
        },
      ],
    })
  );
}

/** A turn of stream-json events in which the Assistant replies with this text, streamed in two parts. */
export function replyTurn(text: string): Record<string, unknown>[] {
  const session_id = "11111111-1111-4111-8111-111111111111";
  const half = Math.floor(text.length / 2);
  const delta = (part: string) => ({
    type: "stream_event",
    session_id,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: part },
    },
  });
  return [
    {
      type: "system",
      subtype: "init",
      session_id,
      tools: ["Read", "Grep", "Glob"],
      apiKeySource: "none",
    },
    delta(text.slice(0, half)),
    delta(text.slice(half)),
    {
      type: "assistant",
      session_id,
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id,
      result: text,
    },
  ];
}
