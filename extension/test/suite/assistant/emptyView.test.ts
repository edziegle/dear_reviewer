import * as assert from "assert";
import * as vscode from "vscode";
import {
  closeAssistant,
  openAssistantFromEmptyView,
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

  it("runs Show Assistant from its Open Assistant button", async () => {
    const shown: string[] = [];
    const original = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = (message: string) => {
      shown.push(message);
      return Promise.resolve(undefined);
    };
    try {
      await openAssistantFromEmptyView();
      await eventually(async () =>
        assert.deepStrictEqual(shown, ["No Change is in front in this window."])
      );
    } finally {
      (vscode.window as any).showInformationMessage = original;
    }
  });
});
