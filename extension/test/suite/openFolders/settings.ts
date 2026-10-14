// Saves the user settings the openFolders suite changes, and puts back what
// it found.

import * as vscode from "vscode";

const keys = ["githubApiUrl", "repositories", "localClones"];

export function keepUserSettings(): void {
  const found = new Map<string, unknown>();
  before(() => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of keys) found.set(key, config.inspect(key)?.globalValue);
  });
  after(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of keys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });
}

/** No repositories or clones in the user's settings: only what's open or remembered. */
export async function noRepositorySettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration("dearReviewer");
  const global = vscode.ConfigurationTarget.Global;
  await config.update("repositories", [], global);
  await config.update("localClones", {}, global);
}
