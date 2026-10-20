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
import { flowOffers, initialHops, shownFlow, type FlowGraph } from "./codeFlow";
import { gatherFlow, type GatheredFlow } from "./codeFlowGather";
import {
  CodeFlowPanel,
  type CodeFlowState,
  type FlowView,
  type FromCodeFlow,
} from "./codeFlowPanel";
import { fileChanges, languageServerSource } from "./codeFlowSource";
import { messageOf } from "./errors";
import {
  parseWalkthrough,
  shownSteps,
  walkthroughGraph,
  withDataLabels,
  type ShownWalkthrough,
  type Walkthrough,
} from "./flowWalkthrough";

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
  /** Whether the symbols of deleted files are drawn. */
  showRemoved: boolean;
  /** Whether the Reviewer chose the hops, which ends the start at Changed only for a big graph. */
  hopsChosen: boolean;
  /** Symbols whose every neighbour the Reviewer asked to draw. */
  expanded: Set<string>;
  entry?: string;
  selected?: string;
  walkthrough: WalkthroughRun;
}

/** The Assistant's walkthrough of the gathered calls, and where it is with it. */
interface WalkthroughRun {
  status: ShownWalkthrough["status"];
  written?: Walkthrough;
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
  showRemoved: false,
  hopsChosen: false,
  walkthrough: { status: "idle" },
};

export class CodeFlows implements vscode.Disposable {
  private readonly byChange = new Map<string, Flow>();
  /** Tabs being opened, so asking twice at once opens one. */
  private readonly opening = new Map<string, Promise<void>>();
  private waitMs = DEFAULT_WAIT_MS;

  /**
   * `codeColumn` is where the Change's diffs open. `walkThrough` has the
   * Assistant walk through the calls it is given, and gives its reply.
   */
  constructor(
    private readonly codeColumn: (change: Change) => Promise<vscode.ViewColumn>,
    private readonly walkThrough: (
      change: Change,
      calls: FlowGraph
    ) => Promise<string>
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
      flow.walkthrough = { status: "idle" };
      // A big graph starts at Changed only; the Reviewer's own choice wins once made.
      if (!flow.hopsChosen) {
        flow.hops = initialHops(gathered.graph);
      }
    } catch (err) {
      if (run !== flow.run) {
        return;
      }
      flow.gathered = NO_GRAPH;
      flow.walkthrough = { status: "idle" };
      flow.problem = `Code Flow could not be gathered: ${messageOf(err)}`;
    }
    flow.loading = false;
    this.send(flow);
    if (flow.view === "walkthrough") {
      await this.writeWalkthrough(flow);
    }
  }

  /**
   * Has the Assistant walk through the calls the tab gathered. What it
   * wrote is kept to those calls (see `parseWalkthrough`); a reply with
   * nothing usable in it, or no reply, is a problem the Reviewer can try
   * again.
   */
  private async writeWalkthrough(flow: Flow): Promise<void> {
    const given = walkthroughGraph(flow.gathered.graph);
    if (given.edges.length === 0 || flow.walkthrough.status === "writing") {
      return;
    }
    const run = flow.run;
    flow.walkthrough = { status: "writing" };
    this.send(flow);
    let written: Walkthrough | undefined;
    try {
      written = parseWalkthrough(
        await this.walkThrough(flow.change, given),
        given
      );
    } catch {
      written = undefined;
    }
    if (run !== flow.run) {
      return;
    }
    flow.walkthrough = written
      ? { status: "ready", written }
      : { status: "problem" };
    this.send(flow);
  }

  private async act(flow: Flow, action: FromCodeFlow): Promise<void> {
    switch (action.type) {
      case "setHops":
        flow.hops = action.hops as 0 | 1 | 2;
        flow.hopsChosen = true;
        break;
      case "setView":
        if (action.view !== "walkthrough") {
          flow.view = action.view as FlowView;
          break;
        }
        // Without calls to walk through, the view stays as it was.
        if (this.walkthroughOffered(flow)) {
          flow.view = "walkthrough";
          if (flow.walkthrough.status === "idle") {
            await this.writeWalkthrough(flow);
            return;
          }
        }
        break;
      case "writeWalkthrough":
        if (flow.walkthrough.status === "problem") {
          await this.writeWalkthrough(flow);
        }
        return;
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
      case "setShowRemoved":
        flow.showRemoved = action.show;
        break;
      case "select":
        flow.selected = action.id;
        break;
      case "show":
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

  /** Whether the gathered Code Flow has calls to walk through. */
  private walkthroughOffered(flow: FlowSettings): boolean {
    return walkthroughGraph(flow.gathered.graph).edges.length > 0;
  }

  private send(flow: Flow): void {
    flow.panel.update(this.stateOf(flow));
  }

  private stateOf(flow: FlowSettings): CodeFlowState {
    const offered = this.walkthroughOffered(flow);
    const { walkthrough } = flow;
    // Data labels show on the calls once the Assistant has written them.
    const graph = withDataLabels(
      flow.gathered.graph,
      walkthrough.written?.labels ?? []
    );
    const shown = shownFlow(graph, {
      hops: flow.hops,
      showAll: flow.showAll,
      showTests: flow.showTests,
      showRemoved: flow.showRemoved,
      expanded: [...flow.expanded],
      entry: flow.entry,
    });
    return {
      loading: flow.loading,
      hops: flow.hops,
      view: flow.view === "walkthrough" && !offered ? "map" : flow.view,
      showTests: flow.showTests,
      showRemoved: flow.showRemoved,
      flow: shown,
      walkthrough: {
        offered,
        status: offered ? walkthrough.status : "idle",
        steps: walkthrough.written
          ? shownSteps(walkthrough.written.steps, flow.gathered.graph)
          : [],
      },
      offers: flowOffers({
        // The walkthrough is no picture; the offers behind it are the call map's.
        view: flow.view === "walkthrough" ? "map" : flow.view,
        flow: shown,
        hops: flow.hops,
        showAll: flow.showAll,
        showTests: flow.showTests,
        showRemoved: flow.showRemoved,
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
