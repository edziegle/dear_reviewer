import * as assert from "assert";
import * as vscode from "vscode";
import { standInForTrust, trustHint } from "../trust";

// The review window's folders live in Dear Reviewer's storage, which the
// editor doesn't trust until the Reviewer says so. The test run turns
// workspace trust off, so every window here is trusted; the tests stand in
// for the window's trust and for showing Workspace Trust.

describe("Trusting the review window", () => {
  after(async () => {
    await standInForTrust({ isTrusted: true, isReviewWindow: false });
  });

  it("shows Workspace Trust in the review window, with no path to paste", async () => {
    let shown = 0;
    await standInForTrust({
      isTrusted: false,
      isReviewWindow: true,
      showWorkspaceTrust: () => shown++,
    });
    await vscode.env.clipboard.writeText("");

    await vscode.commands.executeCommand("dearReviewer.trustReviewWindow");

    assert.strictEqual(shown, 1);
    assert.strictEqual(await vscode.env.clipboard.readText(), "");
  });

  it("shows a quiet hint in an untrusted review window, which shows Workspace Trust", async () => {
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
