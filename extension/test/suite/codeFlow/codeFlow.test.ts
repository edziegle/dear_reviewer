import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  replyTurn,
  scriptClaude,
  summaryWritten,
  userMessages,
  type FakeClaudeScript,
} from "../assistant";
import {
  codeFlowPanel,
  fakeShellServer,
  showCodeFlow,
  waitForLanguageServer,
  type CodeFlowState,
} from "../codeFlow";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";

/** The Change's title, as Code Flow names its tab. */
function titled(request: { repository: string; base: string; head: string }) {
  return `${path.basename(request.repository)} ${short(request.base)}..${short(request.head)}`;
}

/** Commits what `edit` changes in the repository, and gives the commit. */
function commitAfter(
  repo: ReturnType<typeof buildFixtureRepo>,
  message: string,
  edit: (write: (file: string, text: string) => void) => void
): string {
  edit((file, text) => fs.writeFileSync(path.join(repo.path, file), text));
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", message);
  return repo.git("rev-parse", "HEAD");
}

/**
 * A Change of its own, whose one changed file is a shell script with a
 * function, and whose `main.sh` is left alone. No language server for shell
 * scripts is installed in the test run, so only the fake answers.
 */
function newChange() {
  const repo = buildFixtureRepo("codeFlow");
  const base = commitAfter(repo, "add scripts", (write) => {
    write("lib.sh", "helper() {\n  echo one\n}\n");
    write("main.sh", ". ./lib.sh\n\nhelper\n");
  });
  const head = commitAfter(repo, "change the helper", (write) =>
    write("lib.sh", "helper() {\n  echo two\n}\n")
  );
  const request = { repository: repo.path, base, head };
  return { request, title: titled(request) };
}

/**
 * A Change that changes `helper` in `lib.sh` and `check` in `tests/check.sh`,
 * a file in a tests directory. The fake server has `check` call `helper_ref`,
 * which it puts beside `check.sh`, so that is test code too, and `helper` be
 * called by `run_main`, beside `lib.sh`.
 */
function changeWithTests(onlyTests = false) {
  const repo = buildFixtureRepo("codeFlowTests");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo.path, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.path, file), text);
  };
  const commit = (message: string, edit: () => void) => {
    edit();
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", message);
    return repo.git("rev-parse", "HEAD");
  };
  const base = commit("add scripts", () => {
    write("lib.sh", "helper() {\n  echo one\n}\n");
    write("tests/check.sh", "check() {\n  echo one\n}\n");
  });
  const head = commit("change both", () => {
    if (!onlyTests) write("lib.sh", "helper() {\n  echo two\n}\n");
    write("tests/check.sh", "check() {\n  echo two\n}\n");
  });
  const request = { repository: repo.path, base, head };
  return { request, title: titled(request) };
}

/** A Change that changes two functions of `lib.sh`, `helper` and `other`. */
function changeWithTwoFunctions() {
  const repo = buildFixtureRepo("codeFlowTwo");
  const base = commitAfter(repo, "add script", (write) =>
    write("lib.sh", "helper() {\n  echo one\n}\n\nother() {\n  echo one\n}\n")
  );
  const head = commitAfter(repo, "change both", (write) =>
    write("lib.sh", "helper() {\n  echo two\n}\n\nother() {\n  echo two\n}\n")
  );
  const request = { repository: repo.path, base, head };
  return { request, title: titled(request) };
}

/** A Change that deletes `legacy.sh`, a script with a function that `main.sh` called. */
function deletingChange() {
  const repo = buildFixtureRepo("codeFlowDeleted");
  const base = commitAfter(repo, "add scripts", (write) => {
    write("legacy.sh", "legacy() {\n  echo old\n}\n");
    write("main.sh", ". ./legacy.sh\n\nlegacy\n");
  });
  const head = commitAfter(repo, "drop legacy", () =>
    fs.rmSync(path.join(repo.path, "legacy.sh"))
  );
  const request = { repository: repo.path, base, head };
  return { request, title: titled(request) };
}

/** A Change that deletes `gone.py`, a Python function that `user.py` called, for the real language server. */
function deletingPythonChange() {
  const repo = buildFixtureRepo("codeFlowPython");
  const base = commitAfter(repo, "add modules", (write) => {
    write("gone.py", "def gone():\n    return 1\n");
    write(
      "user.py",
      "from gone import gone\n\n\ndef use():\n    return gone()\n"
    );
  });
  const head = commitAfter(repo, "drop gone", () =>
    fs.rmSync(path.join(repo.path, "gone.py"))
  );
  const request = { repository: repo.path, base, head };
  return { request, title: titled(request) };
}

/** Waits for the tab to finish asking the language servers, and gives what it was sent. */
async function settled(title: string): Promise<CodeFlowState> {
  let state: CodeFlowState | undefined;
  await eventually(async () => {
    const panel = await codeFlowPanel(title);
    assert.ok(panel, "the Code Flow tab is open");
    assert.strictEqual(panel.sent.loading, false);
    state = panel.sent;
  });
  return state!;
}

describe("Code Flow", () => {
  const disposables: vscode.Disposable[] = [];
  const open: ReturnType<typeof newChange>[] = [];

  async function start(
    over?: Parameters<typeof fakeShellServer>[0],
    make: typeof newChange = newChange,
    /** What the Change's Assistant answers, scripted before the Change opens. */
    script?: FakeClaudeScript
  ) {
    const change = make();
    open.push(change);
    if (over) {
      disposables.push(fakeShellServer(over));
    }
    if (script) {
      await scriptClaude(change.request, script);
    }
    await openChange(change.request);
    await showCodeFlow(change.request);
    return change;
  }

  afterEach(async () => {
    await waitForLanguageServer(undefined);
    disposables.splice(0).forEach((d) => d.dispose());
    for (const change of open.splice(0)) {
      await closeChange(change.request);
    }
  });

  it("opens beside the code, with the changed function and what it calls", async () => {
    const { title } = await start({ callees: { helper: ["run_main"] } });
    const state = await settled(title);
    assert.deepStrictEqual(
      state.flow.nodes.map((n) => [n.name, n.status]),
      [
        ["helper", "changed"],
        ["run_main", "unchanged"],
      ]
    );
    assert.deepStrictEqual(
      state.flow.edges.map((e) => e.label),
      ["run_main()"]
    );
    assert.deepStrictEqual(state.languages, [
      { language: "shellscript", outcome: "answered" },
    ]);
    assert.ok((await codeFlowPanel(title))!.viewColumn, "the tab is shown");
    // The webview's script ran and drew the state it was sent.
    await eventually(async () =>
      assert.deepStrictEqual(
        (await codeFlowPanel(title))!.rendered,
        (await codeFlowPanel(title))!.sent
      )
    );
  });

  it("shows only the changed symbols at zero hops, and more at two", async () => {
    const { title } = await start({
      callees: { helper: ["run_main"], run_main: ["deeper"] },
    });
    await settled(title);
    const panel = (await codeFlowPanel(title))!;
    panel.receive({ type: "setHops", hops: 0 });
    await eventually(async () => {
      const { flow } = (await codeFlowPanel(title))!.sent;
      // Alone, helper has no call to another drawn symbol, so the map leaves it out for the list.
      assert.deepStrictEqual(flow.nodes, []);
      assert.deepStrictEqual(
        flow.callless.map((n) => n.name),
        ["helper"]
      );
    });
    panel.receive({ type: "setHops", hops: 2 });
    await eventually(async () =>
      assert.ok(
        (await codeFlowPanel(title))!.sent.flow.nodes.length >= 2,
        "a second hop adds symbols"
      )
    );
  });

  it("keeps the canvas where it was, and the focused symbol in view, when the Reviewer selects a symbol", async () => {
    const callees = Array.from({ length: 40 }, (_, i) => `callee_${i}`);
    const { title } = await start({ callees: { helper: callees } });
    const state = await settled(title);
    const panel = (await codeFlowPanel(title))!;
    const last = state.flow.nodes.find((n) => n.name === "callee_39")!;

    // Scroll to the bottom of the tall map and focus the last symbol.
    panel.scrollCanvas(0, 100_000);
    panel.focusNode(last.id);
    let scrolled = 0;
    await eventually(async () => {
      const layout = (await codeFlowPanel(title))!.layout;
      assert.ok(layout?.canvas && layout.canvas.top > 0, "the canvas scrolls");
      assert.strictEqual(layout.focusInView, true);
      scrolled = layout.canvas.top;
    });

    // Selecting sends a whole new state; the canvas stays and the symbol stays in view.
    panel.receive({ type: "select", id: last.id });
    await eventually(async () => {
      const current = (await codeFlowPanel(title))!;
      assert.strictEqual(current.sent.selected, last.id);
      assert.deepStrictEqual(current.rendered, current.sent);
    });
    const layout = (await codeFlowPanel(title))!.layout;
    assert.strictEqual(layout?.canvas?.top, scrolled);
    assert.strictEqual(layout?.focusInView, true);
  });

  it("draws swimlanes for the calls from a changed symbol", async () => {
    const { title } = await start({ callees: { helper: ["run_main"] } });
    await settled(title);
    (await codeFlowPanel(title))!.receive({ type: "setView", view: "lanes" });
    await eventually(async () => {
      const { flow } = (await codeFlowPanel(title))!.sent;
      assert.deepStrictEqual(flow.lanes, ["lib.sh", "main.sh"]);
      assert.deepStrictEqual(
        flow.calls.map((c) => [
          c.from.split(":").pop(),
          c.to.split(":").pop(),
          c.label,
        ]),
        [["helper", "run_main", "run_main()"]]
      );
    });
  });

  it("draws what the cap left out around one symbol, or all of it, and goes back to the cap", async () => {
    const callees = Array.from({ length: 100 }, (_, i) => `callee_${i}`);
    const { title } = await start({ callees: { helper: callees } });
    await settled(title);
    // A graph this big starts at Changed only; the Reviewer asks for one hop.
    (await codeFlowPanel(title))!.receive({ type: "setHops", hops: 1 });
    let state = (await codeFlowPanel(title))!.sent;
    await eventually(async () => {
      state = (await codeFlowPanel(title))!.sent;
      assert.strictEqual(state.hops, 1);
      assert.strictEqual(state.flow.nodes.length, 80);
    });
    const helper = state.flow.nodes.find((n) => n.name === "helper")!;
    const sent = async () => (await codeFlowPanel(title))!.sent;
    assert.deepStrictEqual(
      [state.flow.nodes.length, helper.hidden, state.offers.undrawn],
      [80, 21, 21]
    );
    const panel = (await codeFlowPanel(title))!;
    /** The webview drew the state it was sent, notices and details and all. */
    const drawn = () =>
      eventually(async () => {
        const current = (await codeFlowPanel(title))!;
        assert.deepStrictEqual(current.rendered, current.sent);
      });
    // Its details offer to draw the 21 around it.
    panel.receive({ type: "select", id: helper.id });
    await drawn();

    panel.receive({ type: "setShowAll", show: true });
    await eventually(async () =>
      assert.deepStrictEqual(
        [(await sent()).offers.showingAll, (await sent()).offers.undrawn],
        [101, 0]
      )
    );
    await drawn();
    panel.receive({ type: "setShowAll", show: false });
    await eventually(async () =>
      assert.deepStrictEqual(
        [(await sent()).offers.showingAll, (await sent()).offers.undrawn],
        [undefined, 21]
      )
    );

    panel.receive({ type: "expand", id: helper.id });
    await eventually(async () => {
      const { flow, offers } = await sent();
      assert.strictEqual(flow.nodes.length, 101);
      assert.strictEqual(offers.undrawn, 0);
    });
    await drawn();
  });

  it("says what is true when no call is drawn: a hop to try, or that no symbol calls anything", async () => {
    const { title } = await start({ callees: { helper: ["run_main"] } });
    await settled(title);
    const panel = (await codeFlowPanel(title))!;
    panel.receive({ type: "setHops", hops: 0 });
    await eventually(async () =>
      assert.strictEqual((await codeFlowPanel(title))!.sent.offers.tryHop, true)
    );
    panel.receive({ type: "setHops", hops: 1 });
    await eventually(async () =>
      assert.strictEqual(
        (await codeFlowPanel(title))!.sent.offers.tryHop,
        false
      )
    );

    const { title: quiet } = await start({ callees: {} });
    await settled(quiet);
    (await codeFlowPanel(quiet))!.receive({ type: "setView", view: "lanes" });
    await eventually(async () => {
      const { offers } = (await codeFlowPanel(quiet))!.sent;
      assert.deepStrictEqual(
        [offers.hops, offers.picture, offers.empty],
        [false, false, "No symbol this Change touches calls anything."]
      );
      const current = (await codeFlowPanel(quiet))!;
      assert.deepStrictEqual(current.rendered, current.sent);
    });
  });

  it("selects a symbol without opening it, and shows it in the diff when the Reviewer clicks its name", async () => {
    const { title } = await start({ callees: { helper: ["run_main"] } });
    const state = await settled(title);
    const helper = state.flow.nodes.find((n) => n.name === "helper")!;
    const libDiff = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .map((tab) => tab.input)
        .find(
          (input): input is vscode.TabInputTextDiff =>
            input instanceof vscode.TabInputTextDiff &&
            input.modified.fsPath.endsWith("lib.sh")
        );

    // A click on the symbol's box selects it, and opens nothing.
    (await codeFlowPanel(title))!.receive({ type: "select", id: helper.id });
    await eventually(async () => {
      const current = (await codeFlowPanel(title))!;
      assert.strictEqual(current.sent.selected, helper.id);
      assert.deepStrictEqual(current.rendered, current.sent);
    });
    assert.strictEqual(libDiff(), undefined, "selecting opens no diff");

    // A click on its name shows it in the diff.
    (await codeFlowPanel(title))!.receive({ type: "show", id: helper.id });
    await eventually(() => {
      const input = libDiff();
      assert.ok(input, "lib.sh's diff is open");
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === input.modified.toString()
      );
      assert.strictEqual(editor?.selection.active.line, 0);
    });
    assert.strictEqual((await codeFlowPanel(title))!.sent.selected, helper.id);
    // The diff opens in another editor group than the Code Flow, so both stay in view.
    const diffGroup = vscode.window.tabGroups.all.find((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.fsPath.endsWith("lib.sh")
      )
    );
    assert.notStrictEqual(
      diffGroup?.viewColumn,
      (await codeFlowPanel(title))!.viewColumn
    );
  });

  describe("with test code in the Change", () => {
    const server = {
      callees: { check: ["helper_ref"] },
      callers: { helper: ["run_main"] },
    };
    const names = async (title: string) =>
      (await codeFlowPanel(title))!.sent.flow.nodes.map((n) => n.name).sort();

    it("leaves test symbols out until the Reviewer shows them, and says how many it left out", async () => {
      const { title } = await start(server, changeWithTests);
      const state = await settled(title);
      assert.strictEqual(state.showTests, false);
      assert.deepStrictEqual(await names(title), ["helper", "run_main"]);
      assert.deepStrictEqual(
        state.flow.entries.map((e) => e.name),
        [],
        "the entry-point picker offers no test function, and not helper, which calls nothing"
      );
      assert.strictEqual(state.flow.testsHidden, 2);
      await eventually(async () =>
        assert.deepStrictEqual(
          (await codeFlowPanel(title))!.rendered,
          (await codeFlowPanel(title))!.sent
        )
      );

      (await codeFlowPanel(title))!.receive({
        type: "setShowTests",
        show: true,
      });
      await eventually(async () =>
        assert.deepStrictEqual(await names(title), [
          "check",
          "helper",
          "helper_ref",
          "run_main",
        ])
      );
      assert.strictEqual(
        (await codeFlowPanel(title))!.sent.flow.testsHidden,
        0
      );
      assert.deepStrictEqual(
        (await codeFlowPanel(title))!.sent.flow.entries
          .map((e) => e.name)
          .sort(),
        ["check"]
      );
    });

    it("keeps showing tests across a change of view, and hides them again on request", async () => {
      const { title } = await start(server, changeWithTests);
      await settled(title);
      const panel = (await codeFlowPanel(title))!;
      panel.receive({ type: "setShowTests", show: true });
      panel.receive({ type: "setView", view: "list" });
      await eventually(async () => {
        const { sent } = (await codeFlowPanel(title))!;
        assert.strictEqual(sent.view, "list");
        assert.strictEqual(sent.showTests, true);
        assert.ok(sent.flow.nodes.some((n) => n.name === "check"));
      });
      panel.receive({ type: "setShowTests", show: false });
      await eventually(async () =>
        assert.deepStrictEqual(await names(title), ["helper", "run_main"])
      );
    });

    it("says so, rather than drawing an empty map, when the Change only changes tests", async () => {
      const { title } = await start(server, () => changeWithTests(true));
      const state = await settled(title);
      assert.deepStrictEqual(state.flow.nodes, []);
      assert.deepStrictEqual(state.flow.entries, []);
      assert.strictEqual(state.flow.testsHidden, 2);
      await eventually(async () =>
        assert.deepStrictEqual(
          (await codeFlowPanel(title))!.rendered,
          (await codeFlowPanel(title))!.sent
        )
      );
    });
  });

  it("hides the symbols of a deleted file until the Reviewer shows them, says how many, and keeps the choice across a change of view", async () => {
    const { title } = await start(
      { callers: { legacy: ["run_main"] } },
      deletingChange
    );
    const state = await settled(title);
    assert.strictEqual(state.showRemoved, false);
    assert.deepStrictEqual(state.flow.nodes, []);
    assert.deepStrictEqual(state.flow.entries, []);
    assert.strictEqual(state.flow.removedHidden, 1);
    assert.strictEqual(
      state.offers.empty,
      "Every symbol this Change touches is in a deleted file, which is hidden."
    );
    await eventually(async () =>
      assert.deepStrictEqual(
        (await codeFlowPanel(title))!.rendered,
        (await codeFlowPanel(title))!.sent
      )
    );

    const panel = (await codeFlowPanel(title))!;
    panel.receive({ type: "setShowRemoved", show: true });
    panel.receive({ type: "setView", view: "list" });
    await eventually(async () => {
      const { sent } = (await codeFlowPanel(title))!;
      assert.strictEqual(sent.view, "list");
      assert.strictEqual(sent.showRemoved, true);
      assert.strictEqual(sent.flow.removedHidden, 0);
      assert.ok(sent.flow.nodes.some((n) => n.name === "legacy"));
    });
    panel.receive({ type: "setShowRemoved", show: false });
    await eventually(async () => {
      const { sent } = (await codeFlowPanel(title))!;
      assert.deepStrictEqual(sent.flow.nodes, []);
      assert.strictEqual(sent.flow.removedHidden, 1);
    });
  });

  it("leaves a symbol with no calls out of the map, counts it, and lists it in the list", async () => {
    const { title } = await start(
      { callees: { helper: ["run_main"] } },
      changeWithTwoFunctions
    );
    const state = await settled(title);
    assert.deepStrictEqual(state.flow.nodes.map((n) => n.name).sort(), [
      "helper",
      "run_main",
    ]);
    assert.deepStrictEqual(
      state.flow.callless.map((n) => n.name),
      ["other"]
    );
    assert.strictEqual(state.offers.callless, 1);
    await eventually(async () =>
      assert.deepStrictEqual(
        (await codeFlowPanel(title))!.rendered,
        (await codeFlowPanel(title))!.sent
      )
    );

    (await codeFlowPanel(title))!.receive({ type: "setView", view: "list" });
    await eventually(async () => {
      const { sent } = (await codeFlowPanel(title))!;
      assert.strictEqual(sent.view, "list");
      assert.strictEqual(sent.offers.callless, 0);
      assert.deepStrictEqual(
        [...sent.flow.nodes, ...sent.flow.callless].map((n) => n.name).sort(),
        ["helper", "other", "run_main"]
      );
    });
  });

  it("starts at Changed only when one hop out is more than the map draws, until the Reviewer chooses", async () => {
    const callees = Array.from({ length: 90 }, (_, i) => `callee_${i}`);
    const { title } = await start({ callees: { helper: callees } });
    const state = await settled(title);
    assert.strictEqual(state.hops, 0);

    const panel = (await codeFlowPanel(title))!;
    panel.receive({ type: "setHops", hops: 1 });
    await eventually(async () =>
      assert.strictEqual((await codeFlowPanel(title))!.sent.hops, 1)
    );
    // Asking again keeps the Reviewer's choice.
    panel.receive({ type: "retry" });
    await eventually(async () => {
      const { sent } = (await codeFlowPanel(title))!;
      assert.strictEqual(sent.loading, false);
      assert.strictEqual(sent.hops, 1);
    });
  });

  it("says there is no language server when none answers for the language", async () => {
    const { title } = await start();
    const state = await settled(title);
    assert.deepStrictEqual(state.flow.nodes, []);
    assert.deepStrictEqual(state.languages, [
      { language: "shellscript", outcome: "none" },
    ]);
  });

  it("says the language server gave no calls when it knows symbols but has no call hierarchy", async () => {
    const { title } = await start({ withoutHierarchy: true });
    const state = await settled(title);
    assert.deepStrictEqual(state.languages, [
      { language: "shellscript", outcome: "noCalls" },
    ]);
  });

  it("stops waiting for a language server that never answers", async () => {
    await waitForLanguageServer(200);
    const { title } = await start({ slow: true });
    const state = await settled(title);
    assert.deepStrictEqual(state.languages, [
      { language: "shellscript", outcome: "silent" },
    ]);
  });

  it("draws the functions of a deleted file as removed, with who called them before the Change", async () => {
    const { title } = await start(
      { callers: { legacy: ["run_main"] } },
      deletingChange
    );
    await settled(title);
    (await codeFlowPanel(title))!.receive({
      type: "setShowRemoved",
      show: true,
    });
    await eventually(async () =>
      assert.strictEqual((await codeFlowPanel(title))!.sent.showRemoved, true)
    );
    const state = await settled(title);
    assert.deepStrictEqual(
      state.flow.nodes.map((n) => [n.name, n.status, n.side]),
      [
        ["legacy", "removed", "base"],
        ["run_main", "unchanged", "base"],
      ]
    );
    assert.deepStrictEqual(
      state.flow.edges.map((e) => [
        e.from.split(":").pop(),
        e.to.split(":").pop(),
      ]),
      [["run_main", "legacy"]]
    );
    assert.deepStrictEqual(state.languages, [
      { language: "shellscript", outcome: "answered" },
    ]);
  });

  it("opens a removed function in the base worktree, where the file still is", async () => {
    const { title } = await start({}, deletingChange);
    // The symbols of a deleted file are known, drawn or not.
    const state = await settled(title);
    const legacy = state.known.find((n) => n.name === "legacy")!;
    (await codeFlowPanel(title))!.receive({ type: "show", id: legacy.id });
    await eventually(() => {
      const editor = vscode.window.visibleTextEditors.find((e) =>
        e.document.uri.fsPath.endsWith("legacy.sh")
      );
      assert.ok(editor, "legacy.sh is open");
      assert.ok(editor.document.getText().includes("legacy()"));
    });
  });

  it("asks a real language server about the base worktree", async function () {
    this.timeout(180_000);
    await waitForLanguageServer(8_000);
    const { title } = await start(undefined, deletingPythonChange);
    (await codeFlowPanel(title))!.receive({
      type: "setShowRemoved",
      show: true,
    });
    // The server starts lazily and indexes before it answers, so ask again until it does.
    await eventually(async () => {
      const panel = (await codeFlowPanel(title))!;
      const { sent } = panel;
      const seen = sent.flow.nodes.map((n) => [n.name, n.status, n.side]);
      const found =
        !sent.loading &&
        seen.some(
          (n) => n[0] === "gone" && n[1] === "removed" && n[2] === "base"
        ) &&
        seen.some(
          (n) => n[0] === "use" && n[1] === "unchanged" && n[2] === "base"
        );
      if (!sent.loading && !found) {
        panel.receive({ type: "retry" });
      }
      assert.ok(
        found,
        `base-side call hierarchy answered: ${JSON.stringify(seen)}`
      );
    }, 150_000);
  });
  describe("walkthrough", () => {
    /** The Assistant's requests for a walkthrough, in the conversation of the Change. */
    async function walkthroughRequests(request: {
      repository: string;
      base: string;
      head: string;
    }) {
      return (await assistantRuns(request))
        .flatMap(userMessages)
        .filter((m) => m.includes("Walk the Reviewer through"));
    }

    /** The key the prompt gives a symbol of the Code Flow, by its place in what the tab gathered. */
    const keyOf = (state: CodeFlowState, name: string) =>
      `s${state.known.findIndex((n) => n.name === name) + 1}`;

    const walkthrough = (
      state: CodeFlowState,
      over: Record<string, unknown> = {}
    ) =>
      JSON.stringify({
        steps: [
          {
            symbol: keyOf(state, "helper"),
            takes: "nothing",
            gives: "a line",
            note: "prints two now",
            calls: [
              {
                symbol: keyOf(state, "run_main"),
                when: "it is called",
                takes: "a line",
                note: "a change the Assistant made up",
              },
              { symbol: "s99", takes: "a call nobody has" },
            ],
          },
          { symbol: "s98", takes: "a symbol nobody has" },
        ],
        data: [
          {
            from: keyOf(state, "helper"),
            to: keyOf(state, "run_main"),
            data: "a line",
          },
        ],
        ...over,
      });

    it("walks through the calls in order, keeps to the calls it was given, and shows the data on the call map and swimlanes", async () => {
      const { request, title } = await start(
        { callees: { helper: ["run_main"] } },
        newChange,
        { turns: [replyTurn("A summary.")] }
      );
      const state = await settled(title);
      assert.strictEqual(state.walkthrough.offered, true);
      assert.strictEqual(state.walkthrough.status, "idle");
      await summaryWritten(title);
      await scriptClaude(request, {
        turns: [replyTurn(walkthrough(state))],
      });

      const panel = (await codeFlowPanel(title))!;
      panel.receive({ type: "setView", view: "walkthrough" });

      await eventually(async () =>
        assert.strictEqual(
          (await codeFlowPanel(title))!.sent.walkthrough.status,
          "ready"
        )
      );
      const sent = (await codeFlowPanel(title))!.sent;
      assert.strictEqual(sent.view, "walkthrough");
      // Only steps of symbols and calls the Code Flow has: the made-up ones are gone, and so is a note on a symbol the Change left alone.
      assert.deepStrictEqual(sent.walkthrough.steps, [
        {
          number: "1",
          id: sent.known.find((n) => n.name === "helper")!.id,
          name: "helper",
          path: "lib.sh",
          line: 1,
          status: "changed",
          takes: "nothing",
          gives: "a line",
          note: "prints two now",
          calls: [
            {
              number: "1.1",
              id: sent.known.find((n) => n.name === "run_main")!.id,
              name: "run_main",
              path: "main.sh",
              line: 3,
              status: "unchanged",
              when: "it is called",
              takes: "a line",
              calls: [],
            },
          ],
        },
      ]);
      await eventually(async () => {
        const current = (await codeFlowPanel(title))!;
        assert.deepStrictEqual(current.rendered, current.sent);
      });

      // It was asked once, with the calls and the symbols' places.
      const [request1] = await walkthroughRequests(request);
      assert.ok(request1.includes("helper (lib.sh:1) changed"), request1);
      assert.ok(request1.includes("run_main (main.sh:3) unchanged"), request1);
      assert.ok(
        request1.includes(
          `${keyOf(sent, "helper")} -> ${keyOf(sent, "run_main")}  run_main()`
        ),
        request1
      );

      // The data shows on the call in the call map and in the swimlanes.
      panel.receive({ type: "setView", view: "map" });
      await eventually(async () => {
        const { view, flow } = (await codeFlowPanel(title))!.sent;
        assert.strictEqual(view, "map");
        assert.deepStrictEqual(
          flow.edges.map((e) => [e.label, e.data]),
          [["run_main()", "a line"]]
        );
      });
      panel.receive({ type: "setView", view: "lanes" });
      await eventually(async () => {
        const { view, flow } = (await codeFlowPanel(title))!.sent;
        assert.strictEqual(view, "lanes");
        assert.deepStrictEqual(
          flow.calls.map((c) => [c.label, c.data]),
          [["run_main()", "a line"]]
        );
      });

      // Coming back to the walkthrough doesn't ask again.
      panel.receive({ type: "setView", view: "walkthrough" });
      await eventually(async () =>
        assert.strictEqual(
          (await codeFlowPanel(title))!.sent.view,
          "walkthrough"
        )
      );
      assert.strictEqual(
        (await codeFlowPanel(title))!.sent.walkthrough.steps.length,
        1
      );
      assert.strictEqual((await walkthroughRequests(request)).length, 1);
    });

    it("is not offered when the Change has no calls to walk through", async () => {
      // No language server answers for shell scripts here.
      const { request, title } = await start(undefined, newChange, {
        turns: [replyTurn("A summary.")],
      });
      const state = await settled(title);
      assert.deepStrictEqual(state.flow.edges, []);
      assert.strictEqual(state.walkthrough.offered, false);

      const panel = (await codeFlowPanel(title))!;
      panel.receive({ type: "setView", view: "walkthrough" });
      // Another message, which the tab answers after the first.
      panel.receive({ type: "setView", view: "list" });
      await eventually(async () =>
        assert.strictEqual((await codeFlowPanel(title))!.sent.view, "list")
      );
      panel.receive({ type: "setView", view: "walkthrough" });
      panel.receive({ type: "setHops", hops: 0 });
      await eventually(async () => {
        const current = (await codeFlowPanel(title))!.sent;
        assert.strictEqual(current.hops, 0);
        assert.strictEqual(current.view, "list");
        assert.strictEqual(current.walkthrough.status, "idle");
      });
      await summaryWritten(title);
      assert.deepStrictEqual(await walkthroughRequests(request), []);
    });

    it("offers to try again when the Assistant's reply holds no walkthrough, and shows the next one", async () => {
      const { request, title } = await start(
        { callees: { helper: ["run_main"] } },
        newChange,
        { turns: [replyTurn("A summary.")] }
      );
      const state = await settled(title);
      await summaryWritten(title);
      await scriptClaude(request, {
        turns: [
          replyTurn("I would rather not."),
          replyTurn(walkthrough(state)),
        ],
      });

      const panel = (await codeFlowPanel(title))!;
      panel.receive({ type: "setView", view: "walkthrough" });
      await eventually(async () =>
        assert.strictEqual(
          (await codeFlowPanel(title))!.sent.walkthrough.status,
          "problem"
        )
      );
      assert.deepStrictEqual(
        (await codeFlowPanel(title))!.sent.walkthrough.steps,
        []
      );
      await eventually(async () => {
        const current = (await codeFlowPanel(title))!;
        assert.deepStrictEqual(current.rendered, current.sent);
      });

      panel.receive({ type: "writeWalkthrough" });
      await eventually(async () => {
        const current = (await codeFlowPanel(title))!.sent.walkthrough;
        assert.strictEqual(current.status, "ready");
        assert.deepStrictEqual(
          current.steps.map((s) => s.name),
          ["helper"]
        );
      });
      assert.strictEqual((await walkthroughRequests(request)).length, 2);
    });
  });
});
