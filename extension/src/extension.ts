import * as vscode from "vscode";
import { ChangeRequest, ChangeWorkspace } from "./changeWorkspace";

export function activate(context: vscode.ExtensionContext) {
  const changes = new ChangeWorkspace(context.globalStorageUri.fsPath);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dearReviewer.openChange",
      async (request?: ChangeRequest) => {
        if (!request) return;
        await changes.open(request);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.closeChange",
      async (request?: ChangeRequest) => {
        if (!request) return;
        await changes.close(request);
      }
    )
  );
}

export function deactivate() {}
