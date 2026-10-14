// Stands in for workspace trust, which the test run turns off, and for the
// Reviewer's answer to whether to trust the review window's folder.

import * as vscode from "vscode";

export interface TrustApi {
  forTests(stand: {
    isTrusted: boolean;
    isReviewWindow?: boolean;
    /** Forgets the Reviewer's earlier answer, as a fresh install would. */
    fresh?: boolean;
    ask?: (
      message: string,
      ...buttons: string[]
    ) => Thenable<string | undefined>;
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

/** Answers the question with this button, or dismisses it, and records each one asked. */
export function answering(answer: string | undefined) {
  const asked: { message: string; buttons: string[] }[] = [];
  const ask = async (message: string, ...buttons: string[]) => {
    asked.push({ message, buttons });
    return answer;
  };
  return { asked, ask };
}

/** Stands in for the window's trust, and with `ask`, for the Reviewer's answer to the question. */
export async function standInForTrust(
  stand: Parameters<TrustApi["forTests"]>[0]
): Promise<void> {
  await (await trustApi()).forTests(stand);
}

/** The status-bar hint, while it shows. */
export async function trustHint(): Promise<ReturnType<TrustApi["hint"]>> {
  return (await trustApi()).hint();
}
