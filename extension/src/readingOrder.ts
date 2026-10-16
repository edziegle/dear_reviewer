// The Reading Order (ADR 0022): the order the Assistant suggests for reading
// a Change's files, in a few labelled steps, starting where its summary says
// to start. Dear Reviewer trusts nothing in the Assistant's reply: it keeps
// only the Change's own files, once each, cuts long labels and reasons, puts
// the start file first and any file left out in a last step. A Reading Order
// belongs to the head it was written for; after new commits, the files they
// changed move to a last step of their own.

import {
  filesChangedBetween,
  type Change,
  type ChangedFile,
} from "./changeWorkspace";

export interface ReadingStep {
  label: string;
  /** Paths relative to the repository root, each with a few words on why it comes there. */
  files: { path: string; why?: string }[];
}

export interface ReadingOrder {
  /** The head commit it was written for. */
  headSha: string;
  steps: ReadingStep[];
}

/** A Change's Reading Order, if it has one, and whether the Assistant is writing one. */
export interface ReadingOrderState {
  writing: boolean;
  /** Whether the last try to write one failed or gave nothing usable. */
  problem?: boolean;
  order?: ReadingOrder;
}

/** A Reading Order as the overview lists it. */
export interface ShownReadingOrder {
  /** Whether the Assistant is writing it. */
  writing: boolean;
  /** Whether the Change has new commits since it was written. */
  outOfDate: boolean;
  /** Whether the Assistant's last try to write one gave nothing the Reviewer can use. */
  problem?: boolean;
  steps: {
    label: string;
    files: { path: string; why?: string; viewed: boolean }[];
  }[];
}

/** The longest label or reason kept, and the most steps. */
const maxChars = 80;
const maxSteps = 20;

/** The last step, of the files the Assistant left out. */
const otherFiles = "Other files";

/**
 * The steps of the Assistant's reply, kept to the Change's files, given in
 * tree order, starting with `start` if the summary named one. Gives nothing
 * if the reply holds no usable order.
 */
export function parseReadingOrder(
  reply: string,
  files: string[],
  start?: string
): ReadingStep[] | undefined {
  const raw = stepsIn(reply);
  if (!raw) return;
  const changed = new Set(files);
  const taken = new Set<string>();
  let steps: ReadingStep[] = [];
  for (const step of raw.slice(0, maxSteps)) {
    if (!isObject(step) || !Array.isArray(step.files)) continue;
    const kept: ReadingStep["files"] = [];
    for (const file of step.files) {
      if (!isObject(file) || typeof file.path !== "string") continue;
      if (!changed.has(file.path) || taken.has(file.path)) continue;
      taken.add(file.path);
      const why = typeof file.why === "string" ? shortened(file.why) : "";
      kept.push({ path: file.path, ...(why && { why }) });
    }
    if (kept.length === 0) continue;
    const label = typeof step.label === "string" ? shortened(step.label) : "";
    steps.push({ label: label || `Step ${steps.length + 1}`, files: kept });
  }
  if (steps.length === 0) return;
  if (start && changed.has(start)) {
    const entry = steps
      .flatMap((step) => step.files)
      .find((file) => file.path === start) ?? { path: start };
    taken.add(start);
    steps = steps
      .map((step) => ({
        ...step,
        files: step.files.filter((file) => file.path !== start),
      }))
      .filter((step) => step.files.length > 0);
    if (steps.length === 0) steps.push({ label: "Start here", files: [] });
    steps[0].files.unshift(entry);
  }
  const left = files.filter((file) => !taken.has(file));
  if (left.length > 0)
    steps.push({
      label: otherFiles,
      files: left.map((file) => ({ path: file })),
    });
  return steps;
}

/**
 * The Reading Order's steps at the Change's head, for its files in tree
 * order: once the head has moved, the files changed since, and any the order
 * lacks, go in a last step.
 */
export async function stepsAt(
  change: Change,
  order: ReadingOrder,
  files: ChangedFile[]
): Promise<{ steps: ReadingStep[]; outOfDate: boolean }> {
  const outOfDate = order.headSha !== change.headSha;
  const since = outOfDate
    ? await changedSince(change.repository, order.headSha, change.headSha)
    : new Set<string>();
  const paths = new Set(files.map((f) => f.path));
  const placed = new Set<string>();
  const steps = order.steps
    .map((step) => ({
      ...step,
      files: step.files.filter((file) => {
        if (!paths.has(file.path) || since.has(file.path)) return false;
        placed.add(file.path);
        return true;
      }),
    }))
    .filter((step) => step.files.length > 0);
  const rest = files.filter((f) => !placed.has(f.path));
  if (rest.length > 0)
    steps.push({
      label: outOfDate ? "Since the suggestion" : otherFiles,
      files: rest.map((f) => ({ path: f.path })),
    });
  return { steps, outOfDate };
}

const sinceCache = new Map<string, Promise<Set<string>>>();

/** The files changed between two commits, by path; none if git can't tell. */
function changedSince(
  repository: string,
  from: string,
  to: string
): Promise<Set<string>> {
  const key = [repository, from, to].join("\0");
  let found = sinceCache.get(key);
  if (!found) {
    found = filesChangedBetween(repository, from, to).then(
      (files) => new Set(files.map((f) => f.path)),
      () => {
        sinceCache.delete(key);
        return new Set<string>();
      }
    );
    sinceCache.set(key, found);
  }
  return found;
}

/** The list of steps in a reply's JSON object, even inside a Markdown fence or after prose. */
function stepsIn(reply: string): unknown[] | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) return;
  try {
    const steps = (
      JSON.parse(reply.slice(start, end + 1)) as { steps?: unknown }
    )?.steps;
    return Array.isArray(steps) ? steps : undefined;
  } catch {
    return;
  }
}

/** The text on one line, cut off with an ellipsis past `maxChars`. */
function shortened(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
