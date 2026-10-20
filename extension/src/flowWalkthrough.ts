// The Code Flow walkthrough: the Assistant's account of how the code of a
// Change runs, in order, as a numbered outline. Kept apart from `vscode` so
// the unit tests can run it under plain Node.
//
// Dear Reviewer trusts nothing in the Assistant's reply (ADR 0042). The
// Assistant is given the Code Flow's calls and cites symbols by a short key
// from that list. A step is kept only when its key names a symbol of the
// calls it was given, and a step under another only when the calls hold that
// call. Names and places come from the Code Flow, never from the reply; a
// note about what the Change did stays only on a symbol the Change touched.

import {
  capNodes,
  NODE_CAP,
  withoutRemoved,
  withoutTests,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
} from "./codeFlow";

/** One function in the run, with the functions it calls under it, in order. */
export interface WalkthroughStep {
  /** The id of its symbol in the Code Flow. */
  symbol: string;
  /** When the call to it happens, if only on some runs. */
  when?: string;
  takes?: string;
  gives?: string;
  /** What the Change did to it, for a symbol the Change touched. */
  note?: string;
  calls: WalkthroughStep[];
}

/** The data that crosses one call, such as "verdict, body". */
export interface DataLabel {
  from: string;
  to: string;
  data: string;
}

export interface Walkthrough {
  steps: WalkthroughStep[];
  labels: DataLabel[];
}

/** A step as the Code Flow tab lists it. */
export interface ShownStep {
  /** Its place in the outline, such as "2.1". */
  number: string;
  id: string;
  name: string;
  path: string;
  line: number;
  status: FlowNode["status"];
  side?: "base";
  when?: string;
  takes?: string;
  gives?: string;
  note?: string;
  calls: ShownStep[];
}

/** Whether the tab has a walkthrough to offer, and where the Assistant is with it. */
export interface ShownWalkthrough {
  /** Whether the Code Flow has calls to walk through; without them the view isn't offered. */
  offered: boolean;
  status: "idle" | "writing" | "ready" | "problem";
  steps: ShownStep[];
}

/** The longest text of each kind kept, the deepest step and the most steps. */
const maxWhen = 80;
const maxData = 120;
const maxNote = 160;
const maxLabel = 40;
const maxDepth = 8;
const maxSteps = 60;

/**
 * The calls the Assistant is given: those between the symbols of the Change
 * and the code around it, without test code and deleted files, nearest the
 * Change first up to the call map's cap. Symbols with no call are left out.
 */
export function walkthroughGraph(full: FlowGraph): FlowGraph {
  const { graph } = capNodes(withoutRemoved(withoutTests(full)), NODE_CAP);
  const inEdges = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
  return {
    nodes: graph.nodes.filter((node) => inEdges.has(node.id)),
    edges: graph.edges.filter((edge) => edge.from !== edge.to),
  };
}

/** The key each symbol of the graph goes by in the prompt and in the reply: s1, s2, and so on. */
export function symbolKeys(graph: FlowGraph): Map<string, FlowNode> {
  return new Map(graph.nodes.map((node, i) => [`s${i + 1}`, node]));
}

/**
 * The walkthrough in the Assistant's reply, kept to the calls in `graph`.
 * Gives nothing if the reply holds no usable step.
 */
export function parseWalkthrough(
  reply: string,
  graph: FlowGraph
): Walkthrough | undefined {
  const parsed = objectIn(reply);
  if (!parsed || !Array.isArray(parsed.steps)) return;
  const byKey = symbolKeys(graph);
  const called = new Set(graph.edges.map((e) => `${e.from}\0${e.to}`));
  let budget = maxSteps;

  const stepOf = (
    raw: unknown,
    parent: string | undefined,
    ancestors: readonly string[]
  ): WalkthroughStep | undefined => {
    if (budget <= 0 || !isObject(raw) || typeof raw.symbol !== "string") return;
    const node = byKey.get(raw.symbol);
    if (!node) return;
    if (parent !== undefined && !called.has(`${parent}\0${node.id}`)) return;
    budget--;
    const lineage = [...ancestors, node.id];
    // A call back to a symbol already on the way is listed, not followed again.
    const calls =
      Array.isArray(raw.calls) &&
      !ancestors.includes(node.id) &&
      lineage.length < maxDepth
        ? raw.calls.flatMap((call) => stepOf(call, node.id, lineage) ?? [])
        : [];
    const note = node.status === "unchanged" ? "" : text(raw.note, maxNote);
    return {
      symbol: node.id,
      ...optional("when", text(raw.when, maxWhen)),
      ...optional("takes", text(raw.takes, maxData)),
      ...optional("gives", text(raw.gives, maxData)),
      ...optional("note", note),
      calls,
    };
  };

  const steps = parsed.steps.flatMap((raw) => stepOf(raw, undefined, []) ?? []);
  if (steps.length === 0) return;
  const seen = new Set<string>();
  const labels: DataLabel[] = [];
  for (const raw of Array.isArray(parsed.data) ? parsed.data : []) {
    if (!isObject(raw) || typeof raw.from !== "string") continue;
    const from = byKey.get(raw.from);
    const to = typeof raw.to === "string" ? byKey.get(raw.to) : undefined;
    const data = text(raw.data, maxLabel);
    if (!from || !to || !data) continue;
    const key = `${from.id}\0${to.id}`;
    if (!called.has(key) || seen.has(key)) continue;
    seen.add(key);
    labels.push({ from: from.id, to: to.id, data });
  }
  return { steps, labels };
}

/** The graph with each call that has a data label showing it. */
export function withDataLabels(
  graph: FlowGraph,
  labels: readonly DataLabel[]
): FlowGraph {
  if (labels.length === 0) return graph;
  const byCall = new Map(labels.map((l) => [`${l.from}\0${l.to}`, l.data]));
  return {
    nodes: graph.nodes,
    edges: graph.edges.map((edge): FlowEdge => {
      const data = byCall.get(`${edge.from}\0${edge.to}`);
      return data === undefined ? edge : { ...edge, data };
    }),
  };
}

/** The steps as the tab lists them, numbered, with names and places from the Code Flow. */
export function shownSteps(
  steps: readonly WalkthroughStep[],
  graph: FlowGraph
): ShownStep[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const number = (list: readonly WalkthroughStep[], prefix: string) =>
    list
      .filter((step) => byId.has(step.symbol))
      .map((step, i): ShownStep => {
        const node = byId.get(step.symbol)!;
        const here = `${prefix}${i + 1}`;
        return {
          number: here,
          id: node.id,
          name: node.name,
          path: node.path,
          line: node.line,
          status: node.status,
          ...(node.side === undefined ? {} : { side: node.side }),
          ...optional("when", step.when),
          ...optional("takes", step.takes),
          ...optional("gives", step.gives),
          ...optional("note", step.note),
          calls: number(step.calls, `${here}.`),
        };
      });
  return number(steps, "");
}

/** The text on one line, cut off with an ellipsis past `max`; empty if it isn't text. */
function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function optional<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

/** The reply's JSON object, even inside a Markdown fence or after prose. */
function objectIn(reply: string): Record<string, unknown> | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) return;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
