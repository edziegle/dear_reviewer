// How the overview lists a commit's checks: a summary line, then the
// failed and running checks, which need the Reviewer, and the rest behind
// Show all. Kept apart from `vscode` so the unit tests can run it under
// plain Node.

import type { CheckRunStatus } from "./github/client";

/** The order checks are counted and listed in: what needs the Reviewer first. */
const order: readonly CheckRunStatus[] = [
  "failed",
  "running",
  "passed",
  "skipped",
  "neutral",
];

/**
 * The checks in the order the overview lists them, each status's in
 * GitHub's order; how many lead the list because they failed or are still
 * running; and the summary, such as "1 failed · 2 running · 38 passed".
 */
export function checksInOrder<R extends { status: CheckRunStatus }>(
  runs: readonly R[]
): { runs: R[]; attention: number; summary: string } {
  const sorted = order.flatMap((status) =>
    runs.filter((run) => run.status === status)
  );
  const counts = order.flatMap((status) => {
    const count = runs.filter((run) => run.status === status).length;
    return count ? [`${count} ${status}`] : [];
  });
  return {
    runs: sorted,
    attention: runs.filter(
      (run) => run.status === "failed" || run.status === "running"
    ).length,
    summary: counts.join(" · "),
  };
}
