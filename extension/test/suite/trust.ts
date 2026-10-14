// Stands in for workspace trust, which the test run turns off, and for
// showing Workspace Trust.

import * as vscode from "vscode";

export interface TrustApi {
  forTests(stand: {
    isTrusted: boolean;
    isReviewWindow?: boolean;
    showWorkspaceTrust?: () => void;
  }): Promise<void>;
  /** The status-bar hint, while it shows. */
  hint(): { text: string; tooltip?: string; command?: string } | undefined;
}

async function trustApi(): Promise<TrustApi> {
  const extension = vscode.extensions.getExtension<{ trust: TrustApi }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).trust;
}

/** Stands in for the window's trust, and with `showWorkspaceTrust`, for showing Workspace Trust. */
export async function standInForTrust(
  stand: Parameters<TrustApi["forTests"]>[0]
): Promise<void> {
  await (await trustApi()).forTests(stand);
}

/** The status-bar hint, while it shows. */
export async function trustHint(): Promise<ReturnType<TrustApi["hint"]>> {
  return (await trustApi()).hint();
}
