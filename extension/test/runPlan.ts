import * as path from "path";

export interface Selection {
  suites?: string[];
  /** Test files as `<phase>/<name>`, like `review/afterReload/pendingReview`. */
  files?: string[];
}

export interface Launch {
  phase: string;
  /** The names of the files to load; all of the phase's files when absent. */
  files?: string[];
}

export const suiteOf = (phase: string) => phase.split("/")[0];

function splitFile(file: string): { phase: string; name: string } {
  const relative = file
    .replace(/^(extension\/)?test\/suite\//, "")
    .replace(/(\.test)?\.[jt]s$/, "");
  const slash = relative.lastIndexOf("/");
  if (slash < 0) throw new Error(`Name ${file} as <suite>/<file>`);
  return { phase: relative.slice(0, slash), name: relative.slice(slash + 1) };
}

/**
 * The launches a run makes, in order. Files narrow their suite: the phases
 * before the last phase with a file named run whole, because later phases
 * pick up where they left off; that phase loads only the files named in it;
 * and the phases after it don't run.
 */
export function planLaunches(phases: string[], selection: Selection): Launch[] {
  const files = (selection.files ?? []).map(splitFile);
  const suites = selection.suites ?? [];
  for (const suite of suites)
    if (!phases.map(suiteOf).includes(suite))
      throw new Error(`There is no suite ${suite}`);
  for (const { phase } of files)
    if (!phases.includes(phase))
      throw new Error(`There is no test/suite/${phase} phase`);
  const selected = new Set([...suites, ...files.map((f) => suiteOf(f.phase))]);
  const launches: Launch[] = [];
  for (const phase of phases) {
    const suite = suiteOf(phase);
    if (selected.size > 0 && !selected.has(suite)) continue;
    const inSuite = files.filter((f) => suiteOf(f.phase) === suite);
    const inPhase = inSuite.filter((f) => f.phase === phase).map((f) => f.name);
    const setsUpALaterFile = inSuite.some(
      (f) => phases.indexOf(f.phase) > phases.indexOf(phase)
    );
    if (inSuite.length === 0 || setsUpALaterFile) launches.push({ phase });
    else if (inPhase.length > 0) launches.push({ phase, files: inPhase });
  }
  return launches;
}

/** What a group is called and the phases it runs, as a launch plan lists them. */
export interface GroupPlan {
  name: string;
  phases: string[];
}

export type LaunchGroup<G extends GroupPlan = GroupPlan> = Omit<G, "phases"> & {
  /** The phases this launch runs one after another, in order. */
  phases: Launch[];
};

/**
 * Packs the planned phases into the launches that run them: each group is one
 * VSCodium start, and a group nothing selected makes no launch. Groups keep
 * their order, and a group's phases keep the plan's.
 */
export function groupLaunches<G extends GroupPlan>(
  planned: Launch[],
  groups: G[]
): LaunchGroup<G>[] {
  for (const { phase } of planned)
    if (!groups.some((g) => g.phases.includes(phase)))
      throw new Error(`No launch group holds the ${phase} phase`);
  return groups
    .map((group) => ({
      ...group,
      phases: planned.filter((p) => group.phases.includes(p.phase)),
    }))
    .filter((g) => g.phases.length > 0);
}

/** The phases that have test files, which no group launches, so a new suite can't be skipped unnoticed. */
export function unlaunchedPhases(
  withTests: string[],
  groups: GroupPlan[]
): string[] {
  const launched = new Set(groups.flatMap((g) => g.phases));
  return withTests.filter((phase) => !launched.has(phase));
}

/** What a launch has done so far, which it writes after each phase. */
export interface Progress {
  done: { phase: string; failed: string[] }[];
  /** The phase in progress, which a crash leaves behind. */
  running?: string;
}

export interface PhaseOutcome {
  phase: string;
  status: "passed" | "failed" | "crashed" | "not run";
  failed: string[];
}

/** A launch that failed outside its phases, such as VSCodium failing to start. */
export interface LaunchFailure {
  launch: string;
  status: "failed";
  failed: string[];
}

export type Outcome = PhaseOutcome | LaunchFailure;

/**
 * How each phase of a launch ended. A phase that never finished fails: the
 * one running when the extension host died crashed it, and the rest never ran.
 */
export function outcomes(
  expected: string[],
  progress: Progress | undefined
): PhaseOutcome[] {
  return expected.map((phase) => {
    const done = progress?.done.find((d) => d.phase === phase);
    if (done)
      return {
        phase,
        status: done.failed.length > 0 ? "failed" : "passed",
        failed: done.failed,
      };
    return {
      phase,
      status: progress?.running === phase ? "crashed" : "not run",
      failed: [],
    };
  });
}

/** The lines that report the phases that failed, grouped by phase. */
export function failureLines(all: Outcome[]): string[] {
  return all.flatMap((o) => {
    if ("launch" in o)
      return [`launch ${o.launch}:`, ...o.failed.map((t) => `  ${t}`)];
    if (o.status === "passed") return [];
    if (o.status === "crashed")
      return [`${o.phase}: crashed the extension host`];
    if (o.status === "not run") return [`${o.phase}: not run`];
    return [`${o.phase}:`, ...o.failed.map((t) => `  ${t}`)];
  });
}

/**
 * The processes in `ps -axo pid=,args=` output that run with `userDataDir` as
 * their user data, which only a test window of this checkout does.
 */
export function testWindowPids(ps: string, userDataDir: string): number[] {
  const pids: number[] = [];
  for (const line of ps.split("\n")) {
    const [, pid, args] = line.match(/^\s*(\d+) (.*)$/) ?? [];
    if (!args) continue;
    const padded = ` ${args} `;
    if (
      padded.includes(` --user-data-dir ${userDataDir} `) ||
      padded.includes(` --user-data-dir=${userDataDir} `)
    )
      pids.push(Number(pid));
  }
  return pids;
}

export interface CodiumInstall {
  /** The app `open -a` launches on macOS; absent elsewhere. */
  app?: string;
  /** The binary whose processes are the test windows. */
  executable: string;
  /** The command line tool that installs extensions. */
  cli: string;
}

/**
 * Where a VSCodium install keeps what a test run needs. `dir` is the folder
 * mise unpacked VSCodium into; without it, the install a package puts in place.
 */
export function codiumInstall(
  platform: NodeJS.Platform,
  dir?: string
): CodiumInstall {
  if (platform === "darwin") {
    const app = dir
      ? path.join(dir, "VSCodium.app")
      : "/Applications/VSCodium.app";
    return {
      app,
      executable: path.join(app, "Contents", "MacOS", "VSCodium"),
      cli: path.join(app, "Contents", "Resources", "app", "bin", "codium"),
    };
  }
  if (platform === "linux") {
    const root = dir ?? "/usr/share/codium";
    return {
      executable: path.join(root, "codium"),
      cli: path.join(root, "bin", "codium"),
    };
  }
  throw new Error(`The tests run on macOS and Linux, not ${platform}`);
}
