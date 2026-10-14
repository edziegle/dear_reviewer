// Context keys, which drive menus, welcome messages and the setup
// walkthrough's checklist.

import * as vscode from "vscode";

export function setContext(key: string, value: unknown): Thenable<unknown> {
  return vscode.commands.executeCommand("setContext", key, value);
}
