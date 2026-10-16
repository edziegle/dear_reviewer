// The refs a Reviewer picks a commit range from, to open it as a Change:
// read from `git for-each-ref`, and offered in the order they're likeliest
// wanted, main first for the base and the checked-out branch first for the
// head.

export interface Ref {
  /** Its short name, such as `main`, `origin/main` or `v1.2.0`. */
  name: string;
  kind: "branch" | "remote" | "tag";
  /** The subject of the commit it points at. */
  subject: string;
}

/** The format `parseRefs` reads, one ref a line. */
export const refFormat = "%(refname)%09%(contents:subject)";

/**
 * The refs in `git for-each-ref --format=<refFormat>` output, in its order,
 * leaving out a remote's symbolic HEAD.
 */
export function parseRefs(output: string): Ref[] {
  return output.split("\n").flatMap((line): Ref[] => {
    const [refname, ...subject] = line.split("\t");
    const ref = (kind: Ref["kind"], name: string): Ref[] => [
      { name, kind, subject: subject.join("\t") },
    ];
    let match = /^refs\/heads\/(.+)$/.exec(refname);
    if (match) return ref("branch", match[1]);
    match = /^refs\/remotes\/(.+)$/.exec(refname);
    if (match && !match[1].endsWith("/HEAD")) return ref("remote", match[1]);
    match = /^refs\/tags\/(.+)$/.exec(refname);
    if (match) return ref("tag", match[1]);
    return [];
  });
}

/** The refs grouped as branches, then remote branches, then tags, each in its order. */
function grouped(refs: readonly Ref[]): Ref[] {
  const kinds: Ref["kind"][] = ["branch", "remote", "tag"];
  return kinds.flatMap((kind) => refs.filter((r) => r.kind === kind));
}

/** The repository's main branch, as its branches name it: `main`, else `master`. */
export function mainOf(refs: readonly Ref[]): string | undefined {
  return ["main", "master"].find((name) =>
    refs.some((r) => r.kind === "branch" && r.name === name)
  );
}

/** The refs to start a Change from: `main` first, if the repository has it. */
export function baseChoices(
  refs: readonly Ref[],
  main: string | undefined
): Ref[] {
  const all = grouped(refs);
  const first = all.filter((r) => r.name === main);
  return [...first, ...all.filter((r) => r.name !== main)];
}

/** The refs to review: the checked-out branch first, then the rest. */
export function headChoices(
  refs: readonly Ref[],
  current: string | undefined
): Ref[] {
  const all = grouped(refs);
  const first = all.filter((r) => r.kind === "branch" && r.name === current);
  return [...first, ...all.filter((r) => !first.includes(r))];
}
