// The Code Flow tabs, one for each Change: gathers a Change's calls from the
// language servers, keeps what the Reviewer chose to see (the view, the hops,
// the symbol selected), and jumps the diff to a symbol. The gathering asks
// for two hops once; the hop control only changes how much of that shows.

import * as path from "path";
import * as vscode from "vscode";
import {
  changedFiles,
  changeName,
  fileSides,
  type Change,
} from "./changeWorkspace";
import { flowOffers, shownFlow } from "./codeFlow";
import { gatherFlow, type GatheredFlow } from "./codeFlowGather";
import {
  CodeFlowPanel,
  type CodeFlowState,
  type FlowView,
  type FromCodeFlow,
} from "./codeFlowPanel";
import { fileChanges, languageServerSource } from "./codeFlowSource";
import { messageOf } from "./errors";

/** How long each question to a language server may take before it counts as not answering. */
const DEFAULT_WAIT_MS = 8_000;

const NO_GRAPH: GatheredFlow = {
  graph: { nodes: [], edges: [] },
  languages: [],
};

/** What the Code Flow tab shows, and how the Reviewer set it. */
interface FlowSettings {
  gathered: GatheredFlow;
  loading: boolean;
  problem?: string;
  hops: 0 | 1 | 2;
  view: FlowView;
  showAll: boolean;
  /** Whether the symbols of test files are drawn. */
  showTests: boolean;
  /** Symbols whose every neighbour the Reviewer asked to draw. */
  expanded: Set<string>;
  entry?: string;
  selected?: string;
}

interface Flow extends FlowSettings {
  change: Change;
  panel: CodeFlowPanel;
  /** Counts the gatherings, so one that a retry overtook doesn't show. */
  run: number;
}

/** A new tab, before its first gathering; each takes its own `expanded`. */
const STARTING: Omit<FlowSettings, "expanded"> = {
  gathered: NO_GRAPH,
  loading: true,
  hops: 1,
  view: "map",
  showAll: false,
  showTests: false,
};

export class CodeFlows implements vscode.Disposable {
  private readonly byChange = new Map<string, Flow>();
  /** Tabs being opened, so asking twice at once opens one. */
  private readonly opening = new Map<string, Promise<void>>();
  private waitMs = DEFAULT_WAIT_MS;

  /** `codeColumn` is where the Change's diffs open. */
  constructor(
    private readonly codeColumn: (change: Change) => Promise<vscode.ViewColumn>
  ) {}

  /** Opens the Change's Code Flow beside its code, or shows the one that's open. */
  async show(change: Change): Promise<void> {
    const open = this.byChange.get(change.id);
    if (open) {
      open.panel.reveal();
      return;
    }
    let starting = this.opening.get(change.id);
    if (!starting) {
      starting = this.open(change).finally(() =>
        this.opening.delete(change.id)
      );
      this.opening.set(change.id, starting);
    }
    return starting;
  }

  private async open(change: Change): Promise<void> {
    // Beside the code, not in its editor group, so the diff stays in view.
    const column =
      (await this.codeColumn(change)) === vscode.ViewColumn.One
        ? vscode.ViewColumn.Two
        : vscode.ViewColumn.One;
    const flow: Flow = {
      change,
      ...STARTING,
      expanded: new Set(),
      run: 0,
      panel: new CodeFlowPanel(
        this.stateOf({ ...STARTING, expanded: new Set() }),
        `Code Flow · ${changeName(change)}`,
        column,
        (action) => void this.act(flow, action)
      ),
    };
    this.byChange.set(change.id, flow);
    flow.panel.onDidDispose(() => this.byChange.delete(change.id));
    await this.gather(flow);
  }

  /** Lets go of the Change's tab, as its Change closes. */
  close(change: Change): void {
    this.byChange.get(change.id)?.panel.dispose();
  }

  panels(): { title: string; panel: CodeFlowPanel }[] {
    return [...this.byChange.values()].map((flow) => ({
      title: flow.panel.title,
      panel: flow.panel,
    }));
  }

  /** For the tests, which can't wait for a real language server's patience. */
  setWaitMs(ms: number | undefined): void {
    this.waitMs = ms ?? DEFAULT_WAIT_MS;
  }

  dispose(): void {
    for (const flow of [...this.byChange.values()]) {
      flow.panel.dispose();
    }
  }

  private async gather(flow: Flow): Promise<void> {
    const run = ++flow.run;
    flow.loading = true;
    flow.problem = undefined;
    this.send(flow);
    try {
      const gathered = await gatherFlow(
        languageServerSource(flow.change),
        await fileChanges(flow.change),
        { hops: 2, waitMs: this.waitMs }
      );
      if (run !== flow.run) {
        return;
      }
      flow.gathered = gathered;
    } catch (err) {
      if (run !== flow.run) {
        return;
      }
      flow.gathered = NO_GRAPH;
      flow.problem = `Code Flow could not be gathered: ${messageOf(err)}`;
    }
    flow.loading = false;
    this.send(flow);
  }

  private async act(flow: Flow, action: FromCodeFlow): Promise<void> {
    switch (action.type) {
      case "setHops":
        flow.hops = action.hops as 0 | 1 | 2;
        break;
      case "setView":
        flow.view = action.view as FlowView;
        break;
      case "setEntry":
        flow.entry = action.id;
        break;
      case "setShowAll":
        flow.showAll = action.show;
        break;
      case "expand":
        flow.expanded.add(action.id);
        break;
      case "setShowTests":
        flow.showTests = action.show;
        break;
      case "select":
        flow.selected = action.id;
        this.send(flow);
        await this.openDiff(flow, action.id, true);
        return;
      case "openDiff":
        flow.selected = action.id;
        this.send(flow);
        await this.openDiff(flow, action.id, false);
        return;
      case "retry":
        await this.gather(flow);
        return;
      case "findExtensions":
        await vscode.commands.executeCommand(
          "workbench.extensions.search",
          action.language
        );
        return;
      default:
        return;
    }
    this.send(flow);
  }

  /** Jumps to the symbol: its diff if the Change touches the file, else the file at the head. */
  private async openDiff(
    flow: Flow,
    id: string,
    preserveFocus: boolean
  ): Promise<void> {
    const node = flow.gathered.graph.nodes.find((n) => n.id === id);
    if (!node) {
      return;
    }
    const viewColumn = await this.codeColumn(flow.change);
    const selection = new vscode.Range(node.line - 1, 0, node.line - 1, 0);
    if (node.side === "base") {
      // A deleted file, or the code before the Change: the base worktree's file.
      await vscode.window.showTextDocument(
        vscode.Uri.file(
          path.join(flow.change.baseDir, ...node.path.split("/"))
        ),
        { viewColumn, preserveFocus, selection }
      );
      return;
    }
    const file = (await changedFiles(flow.change)).find(
      (f) => f.path === node.path
    );
    if (file) {
      const { original, modified } = fileSides(flow.change, file);
      if (original && modified) {
        await vscode.commands.executeCommand(
          "vscode.diff",
          original,
          modified,
          `${path.basename(node.path)} (Change)`,
          { viewColumn, preserveFocus, selection }
        );
        return;
      }
    }
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(flow.change.headDir, ...node.path.split("/"))),
      { viewColumn, preserveFocus, selection }
    );
  }

  private send(flow: Flow): void {
    flow.panel.update(this.stateOf(flow));
  }

  private stateOf(flow: FlowSettings): CodeFlowState {
    const shown = shownFlow(flow.gathered.graph, {
      hops: flow.hops,
      showAll: flow.showAll,
      showTests: flow.showTests,
      expanded: [...flow.expanded],
      entry: flow.entry,
    });
    return {
      loading: flow.loading,
      hops: flow.hops,
      view: flow.view,
      showTests: flow.showTests,
      flow: shown,
      offers: flowOffers({
        view: flow.view,
        flow: shown,
        hops: flow.hops,
        showAll: flow.showAll,
        showTests: flow.showTests,
        languages: flow.gathered.languages,
        problem: flow.problem !== undefined,
      }),
      known: flow.gathered.graph.nodes,
      selected: flow.selected,
      languages: flow.gathered.languages,
      ...(flow.problem === undefined ? {} : { problem: flow.problem }),
    };
  }
}
