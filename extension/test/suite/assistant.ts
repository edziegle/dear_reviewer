// Scripts the fake `claude`, reads back what it received, and reads the
// Assistant panel and the Claude login the way the Reviewer sees them.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { FakeClaudeScript, RecordedClaudeCall } from "../fakeClaude";

export type { FakeClaudeScript, RecordedClaudeCall };

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

/** Replaces what the fake `claude` answers, and forgets the runs it saw. */
export function scriptClaude(script: FakeClaudeScript): void {
  const dir = fakeClaudeDir();
  fs.rmSync(path.join(dir, "calls"), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script));
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

/** The text of the user messages the run received. */
export function userMessages(call: RecordedClaudeCall): string[] {
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

export interface Conversation {
  /** The Change's title, as the panel names it. */
  title: string;
  /** The Claude login the Assistant runs on, as the panel shows it. */
  login?: string;
  /** Whether the Assistant is still working. */
  busy: boolean;
  messages: { from: "assistant" | "reviewer"; text: string }[];
  /** What went wrong, in words for the Reviewer. */
  problem?: string;
}

interface AssistantApi {
  /** Each Assistant panel: the state last sent to it, and the state it last rendered. */
  panels(): { title: string; sent: Conversation; rendered?: Conversation }[];
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

/** What the Change's Assistant panel has rendered, if it has one. */
export async function renderedPanel(
  title: string
): Promise<Conversation | undefined> {
  return (await assistantApi()).panels().find((p) => p.title === title)
    ?.rendered;
}

export async function loginStatus(): Promise<
  { text: string; tooltip?: string } | undefined
> {
  return (await assistantApi()).loginStatus();
}

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
