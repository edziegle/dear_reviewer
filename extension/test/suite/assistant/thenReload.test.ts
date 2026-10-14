import * as assert from "assert";
import * as path from "path";
import {
  askAssistant,
  assistantRuns,
  renderedPanel,
  replyTurn,
  scriptClaude,
  showAssistant,
  summaryNote,
} from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import { eventually, openChange, short } from "../reviewer";
import { leaveForReload } from "./handoff";

// Runs last in the first launch: the window reloads with this Change open.
describe("A conversation before a window reload", () => {
  const repo = buildFixtureRepo("reload");

  it("leaves a Change open with a conversation in its Assistant panel", async () => {
    scriptClaude({
      turns: [replyTurn("A summary."), replyTurn("It returns 2.")],
    });
    const change = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const title = `${path.basename(repo.path)} ${short(change.base)}..${short(change.head)}`;
    await openChange(change);
    await showAssistant(change);
    await eventually(async () =>
      assert.strictEqual((await renderedPanel(title))?.busy, false)
    );

    await askAssistant(title, "What does new_helper return?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(title))?.messages.at(-1)?.text,
        "It returns 2."
      )
    );
    const [run] = assistantRuns();
    leaveForReload({ change, title, sessionId: run.sessionId! });
  });
});
