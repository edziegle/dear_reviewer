import * as assert from "assert";
import * as vscode from "vscode";
import {
  closeAssistant,
  openFromEmptyView,
  renderedEmptyView,
} from "../assistant";
import { eventually } from "../reviewer";

describe("The Assistant's view with no Change open", () => {
  after(() => closeAssistant());

  it("shows the empty state, with no conversation", async () => {
    await vscode.commands.executeCommand("dearReviewer.assistant.focus");
    await eventually(async () =>
      assert.deepStrictEqual(await renderedEmptyView(), {
        name: "",
        range: "",
        busy: false,
        messages: [],
      })
    );
  });

  it("runs Open Pull Request or Branch… from its button", async () => {
    const offered: string[] = [];
    const window = vscode.window as any;
    const { showInformationMessage, showQuickPick } = window;
    // With something waiting, the command offers it; with nothing, it says so.
    window.showInformationMessage = (message: string) => {
      offered.push(message);
      return Promise.resolve(undefined);
    };
    window.showQuickPick = (_items: unknown, options: { title: string }) => {
      offered.push(options.title);
      return Promise.resolve(undefined);
    };
    try {
      await openFromEmptyView();
      await eventually(async () =>
        assert.match(
          offered.join("\n"),
          /^(Open Pull Request or Branch|No pull requests or branches are waiting\.)/
        )
      );
    } finally {
      window.showInformationMessage = showInformationMessage;
      window.showQuickPick = showQuickPick;
    }
  });
});
