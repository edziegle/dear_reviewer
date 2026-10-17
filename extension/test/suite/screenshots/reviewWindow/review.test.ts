// Takes the review's marketing screenshots, in a dark and a light theme, in
// the review window, where a Change opened from the Dashboard goes: its
// overview, a diff with Comments, Findings, the Assistant and Code Flow.
// Run it with `mise run screenshots`; it is not part of `mise run test`.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAssistant,
  renderedPanel,
  showAssistant,
  summaryWritten,
} from "../../assistant";
import { settle } from "../../capture";
import { changeFiles, select } from "../../changeFiles";
import { codeFlowPanel, showCodeFlow } from "../../codeFlow";
import { findIssues, findingsView } from "../../findings";
import { comment } from "../../review";
import { closeChange, eventually, openChange } from "../../reviewer";
import { showTimeline } from "../../timeline";
import {
  find,
  fresh,
  lineOf,
  retryAfter,
  setUpScene,
  shoot,
  tearDownScene,
  type Scene,
} from "../scene";

describe("Marketing screenshots, the review window", function () {
  this.timeout(10 * 60_000);
  let scene: Scene;

  before(async () => {
    scene = await setUpScene();
  });

  after(async () => {
    await closeChange(scene.change);
    await tearDownScene();
  });

  it("the Change overview", async () => {
    await openChange(scene.change);
    // VSCodium says the extension added the Change's folders, in the status
    // bar for ten seconds, which a Change sent from the Dashboard doesn't.
    const statusCleared = settle(10_000);
    const take = await summaryWritten(scene.title);
    if (!take.text) throw new Error("no summary was written");
    await fresh();
    await showTimeline(scene.change);
    await Promise.all([statusCleared, settle(3000)]);
    await shoot("overview");
  });

  it("a diff with Comments", async () => {
    await fresh();
    const entry = find(await changeFiles(), "retry.ts");
    if (!entry) throw new Error("no retry.ts in the Change files");
    await select(entry);
    await settle(2000);
    const headFolder = vscode.workspace.workspaceFolders!.find(
      (f) =>
        fs.existsSync(path.join(f.uri.fsPath, "src/payments/retry.ts")) &&
        fs.readFileSync(
          path.join(f.uri.fsPath, "src/payments/retry.ts"),
          "utf8"
        ) === retryAfter
    )!.uri.fsPath;
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
    await findIssues(scene.change);
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
    await showTimeline(scene.change);
    await showAssistant(scene.change);
    await askAssistant(
      scene.title,
      "Could the retry in charge() bill a customer twice?"
    );
    await eventually(async () => {
      const panel = await renderedPanel(scene.title);
      const last = panel?.messages.at(-1);
      if (!panel || panel.busy || last?.from !== "assistant")
        throw new Error("the Assistant is still answering");
    }, 60_000);
    await shoot("assistant");
  });

  it("Code Flow", async () => {
    await fresh();
    await showCodeFlow(scene.change);
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
