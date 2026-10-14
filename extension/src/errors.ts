// Errors, worded for the messages Dear Reviewer shows the Reviewer.

/** An error's message, or whatever else was thrown, as text. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
