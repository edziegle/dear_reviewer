// Builds the Code Flow of a Change from what language servers say. The
// servers are reached through `FlowSource`, so this runs under plain Node in
// the unit tests; `codeFlowSource.ts` is the one that asks VS Code.
//
// VS Code can't say whether a call hierarchy provider exists: it gives an
// empty answer both when there is none and when the server has nothing yet.
// So a language's outcome is judged from what comes back within the wait:
// a call hierarchy for a changed symbol means the server answered, a call
// that never returned means it didn't answer in time, symbols with an empty
// call hierarchy for every changed symbol mean it gives no calls (trying
// again would give the same empty answer), and nothing at all for the file
// means the Reviewer has no language server for it.

import {
  symbolStatus,
  type FileChange,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
} from "./codeFlow";

/** A function or method, with its lines counted from 1. */
export interface CallItem {
  id: string;
  name: string;
  /** Relative to the repository root, with forward slashes. */
  path: string;
  line: number;
  endLine: number;
  /** Set for a symbol of the base worktree. */
  side?: "base";
  /** What the source needs to ask about the item again. */
  handle: unknown;
}

export interface CallLink {
  item: CallItem;
  /** The call or signature the language server gave for the call. */
  label?: string;
}

export interface FlowSource {
  /** The language of the file, or nothing for a file that isn't code, which Code Flow leaves out. */
  languageOf(
    path: string,
    side?: "base"
  ): string | undefined | Promise<string | undefined>;
  /** The functions and methods of a file, in the base worktree for a deleted one. */
  symbols(path: string, side?: "base"): Promise<CallItem[]>;
  /** The call hierarchy items for a symbol; none when no server answers. */
  prepare(symbol: CallItem): Promise<CallItem[]>;
  incoming(item: CallItem): Promise<CallLink[]>;
  outgoing(item: CallItem): Promise<CallLink[]>;
}

/**
 * "silent": a request timed out, so trying again may help. "noCalls": the
 * symbols came back but no changed symbol got a call hierarchy, which the
 * server probably doesn't support, so trying again can't help.
 */
export type LanguageOutcome = "answered" | "silent" | "noCalls" | "none";

export interface GatheredFlow {
  graph: FlowGraph;
  /** What each language of the Change's files came to, in order of first file. */
  languages: { language: string; outcome: LanguageOutcome }[];
}

const TIMED_OUT = Symbol("timed out");

/** The promise's value, nothing if it fails, or `TIMED_OUT` if it takes longer than `ms`. */
function within<T>(
  ms: number,
  promise: Promise<T>
): Promise<T | typeof TIMED_OUT | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

function nodeOf(item: CallItem, status: FlowNode["status"]): FlowNode {
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    line: item.line,
    status,
    ...(item.side === undefined ? {} : { side: item.side }),
  };
}

export async function gatherFlow(
  source: FlowSource,
  changes: readonly FileChange[],
  { hops, waitMs }: { hops: number; waitMs: number }
): Promise<GatheredFlow> {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const languageOrder: string[] = [];
  const sawSymbols = new Set<string>();
  const timedOut = new Set<string>();
  const noCalls = new Set<string>();
  const answered = new Set<string>();

  // Every file is asked at once, so servers that never answer cost one wait, not one each.
  const files = await Promise.all(
    changes.map(async (change) => {
      const side = change.isDeletedFile ? "base" : undefined;
      let language: string | undefined;
      try {
        language = await source.languageOf(change.path, side);
      } catch {
        return undefined;
      }
      if (language === undefined) {
        return undefined;
      }
      return {
        change,
        language,
        symbols: await within(waitMs, source.symbols(change.path, side)),
      };
    })
  );

  const seeds: { item: CallItem; language: string }[] = [];
  for (const file of files) {
    if (!file) {
      continue;
    }
    const { change, language, symbols } = file;
    if (!languageOrder.includes(language)) {
      languageOrder.push(language);
    }
    if (symbols === TIMED_OUT) {
      timedOut.add(language);
      continue;
    }
    if (!Array.isArray(symbols) || symbols.length === 0) {
      continue;
    }
    sawSymbols.add(language);
    for (const symbol of symbols) {
      const status = change.isDeletedFile
        ? "removed"
        : symbolStatus(
            {
              path: symbol.path,
              startLine: symbol.line,
              endLine: symbol.endLine,
            },
            [change]
          );
      if (status !== "unchanged") {
        nodes.set(symbol.id, nodeOf(symbol, status));
        seeds.push({ item: symbol, language });
      }
    }
  }

  const prepared = await Promise.all(
    seeds.map(async ({ item, language }) => ({
      seed: item,
      language,
      items: await within(waitMs, source.prepare(item)),
    }))
  );
  let frontier: CallItem[] = [];
  for (const { seed, language, items } of prepared) {
    if (items === TIMED_OUT) {
      timedOut.add(language);
    } else if (Array.isArray(items) && items.length > 0) {
      answered.add(language);
      // The server may name the symbol differently than the symbol list did.
      frontier.push({ ...items[0], id: seed.id });
    } else {
      noCalls.add(language);
    }
  }

  for (let hop = 1; hop <= hops && frontier.length > 0; hop++) {
    const results = await Promise.all(
      frontier.map(async (item) => ({
        item,
        incoming: await within(waitMs, source.incoming(item)),
        outgoing: await within(waitMs, source.outgoing(item)),
      }))
    );
    const next: CallItem[] = [];
    for (const { item, incoming, outgoing } of results) {
      const links: [CallLink, "in" | "out"][] = [
        ...(Array.isArray(incoming) ? incoming : []).map(
          (link) => [link, "in"] as [CallLink, "in" | "out"]
        ),
        ...(Array.isArray(outgoing) ? outgoing : []).map(
          (link) => [link, "out"] as [CallLink, "in" | "out"]
        ),
      ];
      for (const [link, direction] of links) {
        if (!nodes.has(link.item.id)) {
          nodes.set(
            link.item.id,
            nodeOf(link.item, neighbourStatus(link.item, changes))
          );
          next.push(link.item);
        }
        const [from, to] =
          direction === "in"
            ? [link.item.id, item.id]
            : [item.id, link.item.id];
        edges.set(`${from}\0${to}`, {
          from,
          to,
          ...(link.label === undefined ? {} : { label: link.label }),
        });
      }
    }
    frontier = next;
  }

  return {
    graph: { nodes: [...nodes.values()], edges: [...edges.values()] },
    languages: languageOrder.map((language) => ({
      language,
      outcome: outcomeOf(language),
    })),
  };

  /** A language answered if a changed symbol had a call hierarchy, or if its symbols were all unreached by the diff. */
  function outcomeOf(language: string): LanguageOutcome {
    if (answered.has(language)) {
      return "answered";
    }
    if (timedOut.has(language)) {
      return "silent";
    }
    if (noCalls.has(language)) {
      return "noCalls";
    }
    return sawSymbols.has(language) ? "answered" : "none";
  }
}

function neighbourStatus(
  item: CallItem,
  changes: readonly FileChange[]
): FlowNode["status"] {
  // The diff's lines are the head's, so they say nothing of a symbol before the Change.
  if (item.side === "base") {
    return "unchanged";
  }
  return symbolStatus(
    { path: item.path, startLine: item.line, endLine: item.endLine },
    changes
  );
}
