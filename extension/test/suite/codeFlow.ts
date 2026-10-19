// Drives the Code Flow tab the way the Reviewer does, and reads back what
// the Reviewer would see: the state the extension sent the webview and the
// state it rendered. A fake language server stands in for the Reviewer's
// own: it finds `name() {` lines as symbols, and answers call hierarchy
// requests from a table. Its traps: it serves shell scripts only, because the
// test run installs a real Python language server that would answer too; and
// the callee and caller items it makes sit in `main.sh` beside the file asked
// about, line 3, whether or not that file has a function there.

import * as vscode from "vscode";
import type { ChangeRequest } from "./reviewer";

export interface ShownNode {
  id: string;
  name: string;
  path: string;
  line: number;
  status: "changed" | "new" | "removed" | "unchanged";
  /** Set for a symbol as the base worktree has it. */
  side?: "base";
  column: number;
  row: number;
  hidden: number;
}

export interface CodeFlowState {
  loading: boolean;
  hops: 0 | 1 | 2;
  view: "map" | "lanes" | "list";
  showTests: boolean;
  flow: {
    nodes: ShownNode[];
    edges: { from: string; to: string; label?: string }[];
    entries: { id: string; name: string; label: string }[];
    testsHidden: number;
    undrawn: number;
    overCap: boolean;
    entry?: string;
    lanes: string[];
    calls: {
      from: string;
      to: string;
      label?: string;
      fromLane: number;
      toLane: number;
    }[];
  };
  offers: {
    hops: boolean;
    undrawn: number;
    showingAll?: number;
    tryHop: boolean;
    picture: boolean;
    empty?: string;
  };
  known: {
    id: string;
    name: string;
    path: string;
    line: number;
    status: string;
    side?: "base";
  }[];
  selected?: string;
  languages: {
    language: string;
    outcome: "answered" | "silent" | "noCalls" | "none";
  }[];
  problem?: string;
}

/** How the Code Flow tab said it is laid out, after its last render. */
export interface Layout {
  canvas: { left: number; top: number } | null;
  focusInView: boolean | null;
}

export type FromCodeFlow =
  | { type: "setHops"; hops: number }
  | { type: "setView"; view: string }
  | { type: "select"; id: string }
  | { type: "openDiff"; id: string }
  | { type: "setEntry"; id: string }
  | { type: "expand"; id: string }
  | { type: "setShowAll"; show: boolean }
  | { type: "setShowTests"; show: boolean }
  | { type: "retry" }
  | { type: "findExtensions"; language: string };

interface CodeFlowApi {
  panels(): {
    title: string;
    viewColumn?: vscode.ViewColumn;
    sent: CodeFlowState;
    rendered?: CodeFlowState;
    layout?: Layout;
    scrollCanvas(left: number, top: number): void;
    focusNode(id: string): void;
    receive(message: FromCodeFlow): void;
  }[];
  setWaitMs(ms: number | undefined): void;
}

async function codeFlowApi(): Promise<CodeFlowApi> {
  const extension = vscode.extensions.getExtension<{ codeFlow: CodeFlowApi }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).codeFlow;
}

export function showCodeFlow(change?: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showCodeFlow", change);
}

/** The Code Flow tab of the Change with this title, if it is open. */
export async function codeFlowPanel(title: string) {
  return (await codeFlowApi())
    .panels()
    .find((p) => p.title === `Code Flow · ${title}`);
}

/** How long Code Flow waits for a language server, so the slow-server tests needn't wait long. */
export async function waitForLanguageServer(ms: number | undefined) {
  (await codeFlowApi()).setWaitMs(ms);
}

export interface FakeServer {
  /** What each function calls, by name: its callees, as the server says. */
  callees?: Record<string, string[]>;
  /** What calls each function, by name. */
  callers?: Record<string, string[]>;
  /** Finds symbols but never answers a call hierarchy request. */
  slow?: boolean;
  /** Finds symbols but answers no call hierarchy request with anything. */
  withoutHierarchy?: boolean;
}

/** Stands in for the Reviewer's shell script language server until the disposable is disposed. */
export function fakeShellServer(server: FakeServer = {}): vscode.Disposable {
  const selector: vscode.DocumentSelector = {
    language: "shellscript",
    scheme: "file",
  };
  const defs = (document: vscode.TextDocument) => {
    const found: { name: string; start: number; end: number }[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const name = /^(\w+)\(\) \{/.exec(document.lineAt(line).text)?.[1];
      if (name) {
        found.push({ name, start: line, end: document.lineCount - 1 });
      }
    }
    found.forEach((def, i) => {
      if (found[i + 1]) {
        def.end = found[i + 1].start - 1;
      }
    });
    return found;
  };
  const itemFor = (
    uri: vscode.Uri,
    name: string,
    line: number,
    detail = ""
  ) => {
    const range = new vscode.Range(line, 0, line, 20);
    const item = new vscode.CallHierarchyItem(
      vscode.SymbolKind.Function,
      name,
      detail,
      uri,
      range,
      range
    );
    return item;
  };
  const beside = (uri: vscode.Uri) => vscode.Uri.joinPath(uri, "..", "main.sh");
  const never = () => new Promise<never>(() => undefined);

  return vscode.Disposable.from(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (document) =>
        defs(document).map((def) => {
          const range = new vscode.Range(def.start, 0, def.end, 0);
          return new vscode.DocumentSymbol(
            def.name,
            "",
            vscode.SymbolKind.Function,
            range,
            new vscode.Range(def.start, 4, def.start, 4 + def.name.length)
          );
        }),
    }),
    vscode.languages.registerCallHierarchyProvider(selector, {
      prepareCallHierarchy: async (document, position) => {
        if (server.slow) {
          return never();
        }
        if (server.withoutHierarchy) {
          return [];
        }
        const def = defs(document).find((d) => d.start === position.line);
        return def ? [itemFor(document.uri, def.name, def.start)] : [];
      },
      provideCallHierarchyIncomingCalls: (item) =>
        (server.callers?.[item.name] ?? []).map(
          (name) =>
            new vscode.CallHierarchyIncomingCall(
              itemFor(beside(item.uri), name, 2, `${name}()`),
              [item.range]
            )
        ),
      provideCallHierarchyOutgoingCalls: (item) =>
        (server.callees?.[item.name] ?? []).map(
          (name) =>
            new vscode.CallHierarchyOutgoingCall(
              itemFor(beside(item.uri), name, 2, `${name}()`),
              [item.range]
            )
        ),
    })
  );
}
