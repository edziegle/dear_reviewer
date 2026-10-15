// Scripts the fake `claude`, reads back what it received, and reads the
// Assistant panel and the Claude login the way the Reviewer sees them.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { FakeClaudeScript, RecordedClaudeCall } from "../fakeClaude";
import { readingOrderRequest, toolUse, waitFor } from "../fakeClaude";
import { eventually, type ChangeRequest } from "./reviewer";
import type { Take } from "./timeline";

export type { FakeClaudeScript, RecordedClaudeCall };
export { toolUse, waitFor };

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
 * Replaces what the fake `claude` answers, and forgets the runs it saw. The
 * sessions it keeps, which `--resume` brings back, stay.
 */
export function scriptClaude(script: FakeClaudeScript): void {
  const dir = fakeClaudeDir();
  fs.rmSync(path.join(dir, "calls"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "turns-taken"), { force: true });
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script));
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

/** Every run of the fake `claude` since it was last scripted, oldest first. */
export function callsToClaude(): RecordedClaudeCall[] {
  const dir = path.join(fakeClaudeDir(), "calls");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) =>
      BigInt(a.split("-")[0]) < BigInt(b.split("-")[0]) ? -1 : 1
    )
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/** The print-mode runs, which carry the Assistant's conversations. */
export function assistantRuns(): RecordedClaudeCall[] {
  return callsToClaude().filter((c) => c.args.includes("-p"));
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
  /** The Claude login status bar item, once a login has been checked. */
  loginStatus(): { text: string; tooltip?: string } | undefined;
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

export async function loginStatus(): Promise<
  { text: string; tooltip?: string } | undefined
> {
  return (await assistantApi()).loginStatus();
}

/** Runs Show Assistant on the Change, which opens its chat panel. */
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
