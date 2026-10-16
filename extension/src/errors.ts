// Errors, worded for the messages Dear Reviewer shows the Reviewer.

/** An error's message, or whatever else was thrown, as text. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The codes Node gives when a host can't be reached at all. */
const unreachableCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Whether the error is that the network or the host couldn't be reached, as `fetch` reports it. */
export function isUnreachable(err: unknown): boolean {
  const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause;
  return typeof cause?.code === "string" && unreachableCodes.has(cause.code);
}

/** What the Reviewer is told when the review threads of a Change (by name) didn't load. */
export function reviewThreadsProblem(name: string, err: unknown): string {
  return isUnreachable(err)
    ? `Couldn't reach GitHub to load the review threads of ${name}. Check the connection, then retry.`
    : `Couldn't load the review threads of ${name}: ${messageOf(err)}`;
}
