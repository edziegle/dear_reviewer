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
