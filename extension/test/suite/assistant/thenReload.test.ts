import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  askAssistant,
  assistantRuns,
  findingTurn,
  renderedPanel,
  replyTurn,
  scriptClaude,
  showAssistant,
  summaryNote,
} from "../assistant";
import { findIssues, findingAt } from "../findings";
import { buildFixtureRepo } from "../fixtures";
import { eventually, openChange, short } from "../reviewer";
import { leaveForReload } from "./handoff";

// Runs last in the first launch: the window reloads with this Change open.
describe("A conversation before a window reload", () => {
  const repo = buildFixtureRepo("reload");

  it("leaves a Change open with a conversation in its Assistant panel, asked about a Finding", async () => {
    const change = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    await scriptClaude(change, {
      turns: [
        replyTurn("A summary."),
        findingTurn(1),
        replyTurn("It returns 2."),
      ],
    });
    const title = `${path.basename(repo.path)} ${short(change.base)}..${short(change.head)}`;
    await openChange(change);
    await showAssistant(change);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );
    await findIssues(change);
    await vscode.commands.executeCommand(
      "dearReviewer.askAboutFinding",
      (await findingAt("util.py:1")).id
    );
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.context?.length, 1)
    );

    await askAssistant(title, "What does new_helper return?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(title))?.messages.at(-1)?.text,
        "It returns 2."
      )
    );
    const [run] = await assistantRuns(change);
    leaveForReload({ change, title, sessionId: run.sessionId! });
  });
});
