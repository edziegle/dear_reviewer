import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  eventually,
  foldersAddedSince,
  openChange,
  workspaceFolders,
} from "../reviewer";
import { answering, standInForTrust, trustHint } from "../trust";

// The review window's folders live in Dear Reviewer's storage, which the
// editor doesn't trust until the Reviewer says so. The test run turns
// workspace trust off, so every window here is trusted; the tests stand in
// for the window's trust and for the Reviewer's answer to the question.

describe("Trusting the review window's folder", () => {
  const repo = buildFixtureRepo("trust");
  const request = {
    repository: repo.path,
    base: repo.commits.initial,
    head: repo.commits.renamed,
  };
  let storage = "";

  before(async () => {
    const before = workspaceFolders();
    await openChange(request);
    // A Change's worktrees are in storage/changes/<id>/.
    const [base] = foldersAddedSince(before);
    storage = path.dirname(path.dirname(path.dirname(base.path)));
  });

  after(async () => {
    await closeChange(request);
    await standInForTrust({ isTrusted: true });
  });

  const another = (head: string) => ({ ...request, head });

  it("copies the folder's path to paste into Workspace Trust", async () => {
    await vscode.env.clipboard.writeText("");

    await vscode.commands.executeCommand("dearReviewer.trustReviewWindow");

    assert.strictEqual(await vscode.env.clipboard.readText(), storage);
  });

  it("asks once, when a Change opens, and takes Not now or a dismissal as the answer", async () => {
    const { asked, ask } = answering(undefined);
    await standInForTrust({ isTrusted: false, fresh: true, ask });

    await openChange(another(repo.commits.documented));
    await openChange(another(repo.commits.restructured));

    assert.deepStrictEqual(
      asked.map((a) => a.buttons),
      [["Trust…", "Not now"]]
    );
    for (const said of [
      "Restricted Mode",
      "navigation",
      "workspace settings and tasks",
    ])
      assert.ok(
        asked[0].message.includes(said),
        `${said} in ${asked[0].message}`
      );
    await closeChange(another(repo.commits.documented));
    await closeChange(another(repo.commits.restructured));
  });

  it("runs the Trust… flow when the Reviewer chooses it", async () => {
    const { asked, ask } = answering("Trust…");
    await standInForTrust({ isTrusted: false, fresh: true, ask });
    await vscode.env.clipboard.writeText("");

    await openChange(another(repo.commits.documented));

    assert.strictEqual(asked.length, 1);
    await eventually(async () =>
      assert.strictEqual(await vscode.env.clipboard.readText(), storage)
    );
    await closeChange(another(repo.commits.documented));
  });

  it("doesn't ask once the review window is trusted", async () => {
    const { asked, ask } = answering(undefined);
    await standInForTrust({
      isTrusted: true,
      isReviewWindow: true,
      fresh: true,
      ask,
    });

    await openChange(another(repo.commits.documented));

    assert.deepStrictEqual(asked, []);
    await closeChange(another(repo.commits.documented));
  });

  it("shows a quiet hint in an untrusted review window, which runs the Trust… flow", async () => {
    await standInForTrust({ isTrusted: false, isReviewWindow: true });

    const hint = await trustHint();
    assert.ok(hint, "a hint shows");
    assert.strictEqual(hint.command, "dearReviewer.trustReviewWindow");
    assert.match(hint.tooltip ?? "", /Restricted Mode/);

    await standInForTrust({ isTrusted: true, isReviewWindow: true });
    assert.strictEqual(await trustHint(), undefined, "none once trusted");
    await standInForTrust({ isTrusted: false, isReviewWindow: false });
    assert.strictEqual(
      await trustHint(),
      undefined,
      "none outside the review window"
    );
  });
});
