// Unit tests for the runner's pure helpers. They need no VSCodium:
// mise run test-unit runPlan

import * as assert from "assert";
import {
  codiumInstall,
  failureLines,
  groupLaunches,
  outcomes,
  planLaunches,
  testWindowPids,
  unlaunchedPhases,
} from "./runPlan";

const phases = [
  "inbox",
  "review",
  "review/afterReload",
  "lifecycle",
  "lifecycle/afterReload",
];

describe("Which launches a test run makes", () => {
  it("launches every phase with all its files when nothing is selected", () => {
    assert.deepStrictEqual(planLaunches(phases, {}), [
      { phase: "inbox" },
      { phase: "review" },
      { phase: "review/afterReload" },
      { phase: "lifecycle" },
      { phase: "lifecycle/afterReload" },
    ]);
  });

  it("launches every phase of the suites named, and only those", () => {
    assert.deepStrictEqual(planLaunches(phases, { suites: ["review"] }), [
      { phase: "review" },
      { phase: "review/afterReload" },
    ]);
  });

  it("loads only the files named in the phase that holds them", () => {
    assert.deepStrictEqual(
      planLaunches(phases, { files: ["inbox/settings", "inbox/security"] }),
      [{ phase: "inbox", files: ["settings", "security"] }]
    );
  });

  it("runs the phases before a named file whole, and skips those after", () => {
    assert.deepStrictEqual(
      planLaunches(phases, { files: ["review/comments"] }),
      [{ phase: "review", files: ["comments"] }]
    );
    assert.deepStrictEqual(
      planLaunches(phases, { files: ["review/afterReload/pendingReview"] }),
      [
        { phase: "review" },
        { phase: "review/afterReload", files: ["pendingReview"] },
      ]
    );
    assert.deepStrictEqual(
      planLaunches(phases, {
        files: ["review/comments", "review/afterReload/pendingReview"],
      }),
      [
        { phase: "review" },
        { phase: "review/afterReload", files: ["pendingReview"] },
      ]
    );
  });

  it("takes a file by its path from the repository, extension or suite folder", () => {
    for (const file of [
      "extension/test/suite/inbox/settings.test.ts",
      "test/suite/inbox/settings.test.ts",
      "inbox/settings.test.ts",
      "inbox/settings.test.js",
    ])
      assert.deepStrictEqual(planLaunches(phases, { files: [file] }), [
        { phase: "inbox", files: ["settings"] },
      ]);
  });

  it("refuses a suite or a file folder the run doesn't have", () => {
    assert.throws(() => planLaunches(phases, { suites: ["inbx"] }), /inbx/);
    assert.throws(
      () => planLaunches(phases, { suites: ["review/afterReload"] }),
      /review\/afterReload/
    );
    assert.throws(
      () => planLaunches(phases, { files: ["review/afterReloads/x"] }),
      /review\/afterReloads/
    );
    assert.throws(() => planLaunches(phases, { files: ["review"] }), /review/);
  });
});

describe("Which processes belong to a run's test windows", () => {
  const codium = "/Applications/VSCodium.app/Contents/MacOS/VSCodium";
  const ps = [
    `  101 ${codium} /tmp/w/multi-root.code-workspace --extensions-dir /x --user-data-dir /tmp/dr-abc/user-data --disable-gpu`,
    `  102 ${codium} --user-data-dir=/tmp/dr-abc/user-data --type=renderer`,
    `  103 ${codium}`,
    `  104 ${codium} --user-data-dir /tmp/dr-abc/user-data-2 --disable-gpu`,
    `  105 ${codium} --user-data-dir /tmp/dr-def/user-data`,
    `  106 /bin/zsh`,
    ``,
  ].join("\n");

  it("are the ones started with the run's user data, and no others", () => {
    assert.deepStrictEqual(
      testWindowPids(ps, "/tmp/dr-abc/user-data"),
      [101, 102]
    );
  });
});

describe("Where the test run finds VSCodium", () => {
  it("opens the app mise unpacked on macOS", () => {
    assert.deepStrictEqual(codiumInstall("darwin", "/mise/vscodium"), {
      app: "/mise/vscodium/VSCodium.app",
      executable: "/mise/vscodium/VSCodium.app/Contents/MacOS/VSCodium",
      cli: "/mise/vscodium/VSCodium.app/Contents/Resources/app/bin/codium",
    });
  });

  it("falls back to the one in /Applications on macOS", () => {
    assert.strictEqual(
      codiumInstall("darwin").app,
      "/Applications/VSCodium.app"
    );
  });

  it("runs the binary mise unpacked on Linux, with no app to open", () => {
    assert.deepStrictEqual(codiumInstall("linux", "/mise/vscodium"), {
      executable: "/mise/vscodium/codium",
      cli: "/mise/vscodium/bin/codium",
    });
  });

  it("falls back to the package's install on Linux", () => {
    assert.strictEqual(
      codiumInstall("linux").executable,
      "/usr/share/codium/codium"
    );
  });

  it("refuses other platforms", () => {
    assert.throws(() => codiumInstall("win32"), /win32/);
  });
});

describe("Which suites share a launch", () => {
  const groups = [
    { name: "multi-root", phases: ["multiRoot", "pullRequest", "timeline"] },
    { name: "inbox", phases: ["inbox"] },
    { name: "reload", phases: ["review", "lifecycle"] },
    {
      name: "after reload",
      phases: ["review/afterReload", "lifecycle/afterReload"],
    },
  ];
  const all = groups.flatMap((g) => g.phases);

  it("packs the phases of a full run into one launch for each group", () => {
    const launches = groupLaunches(planLaunches(all, {}), groups);
    assert.deepStrictEqual(
      launches.map((l) => [l.name, l.phases.map((p) => p.phase)]),
      [
        ["multi-root", ["multiRoot", "pullRequest", "timeline"]],
        ["inbox", ["inbox"]],
        ["reload", ["review", "lifecycle"]],
        ["after reload", ["review/afterReload", "lifecycle/afterReload"]],
      ]
    );
  });

  it("leaves out the groups nothing selected", () => {
    const launches = groupLaunches(
      planLaunches(all, { suites: ["timeline", "review"] }),
      groups
    );
    assert.deepStrictEqual(
      launches.map((l) => [l.name, l.phases.map((p) => p.phase)]),
      [
        ["multi-root", ["timeline"]],
        ["reload", ["review"]],
        ["after reload", ["review/afterReload"]],
      ]
    );
  });

  it("keeps the files a phase was narrowed to", () => {
    const [launch] = groupLaunches(
      planLaunches(all, { files: ["pullRequest/autoRefresh"] }),
      groups
    );
    assert.deepStrictEqual(launch.phases, [
      { phase: "pullRequest", files: ["autoRefresh"] },
    ]);
  });

  it("refuses a phase no group holds", () => {
    assert.throws(() => groupLaunches([{ phase: "lost" }], groups), /lost/);
  });
});

describe("Whether every suite is launched", () => {
  it("names the phases with test files that no group holds", () => {
    assert.deepStrictEqual(
      unlaunchedPhases(
        ["inbox", "review", "review/afterReload", "fresh"],
        [
          { name: "a", phases: ["inbox", "review"] },
          { name: "b", phases: ["review/afterReload"] },
        ]
      ),
      ["fresh"]
    );
  });

  it("names nothing when every phase is held", () => {
    assert.deepStrictEqual(
      unlaunchedPhases(["inbox"], [{ name: "a", phases: ["inbox"] }]),
      []
    );
  });
});

describe("What happened to each suite of a launch", () => {
  const expected = ["a", "b", "c", "d"];

  it("passes and fails each suite by its own tests", () => {
    assert.deepStrictEqual(
      outcomes(expected, {
        done: [
          { phase: "a", failed: [] },
          { phase: "b", failed: ["b one", "b two"] },
          { phase: "c", failed: [] },
          { phase: "d", failed: [] },
        ],
      }),
      [
        { phase: "a", status: "passed", failed: [] },
        { phase: "b", status: "failed", failed: ["b one", "b two"] },
        { phase: "c", status: "passed", failed: [] },
        { phase: "d", status: "passed", failed: [] },
      ]
    );
  });

  it("fails the suite that crashed the host and the ones never reached", () => {
    assert.deepStrictEqual(
      outcomes(expected, { done: [{ phase: "a", failed: [] }], running: "b" }),
      [
        { phase: "a", status: "passed", failed: [] },
        { phase: "b", status: "crashed", failed: [] },
        { phase: "c", status: "not run", failed: [] },
        { phase: "d", status: "not run", failed: [] },
      ]
    );
  });

  it("marks every suite not run when the launch left no progress", () => {
    assert.deepStrictEqual(
      outcomes(["a", "b"], undefined).map((o) => o.status),
      ["not run", "not run"]
    );
  });

  it("lists a launch that failed outside its phases", () => {
    assert.deepStrictEqual(
      failureLines([{ launch: "inbox", status: "failed", failed: ["boom"] }]),
      ["launch inbox:", "  boom"]
    );
  });

  it("lists the failures of a run grouped by suite", () => {
    assert.deepStrictEqual(
      failureLines(
        outcomes(expected, {
          done: [
            { phase: "a", failed: [] },
            { phase: "b", failed: ["b one"] },
          ],
          running: "c",
        })
      ),
      ["b:", "  b one", "c: crashed the extension host", "d: not run"]
    );
  });
});
