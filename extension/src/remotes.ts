// Which remote of a clone is a GitHub repository. Plain Node, so unit tests load it.

import { git } from "./git";

/** The clone's remote whose URL names the repository, or else `origin`. */
export async function remoteFor(
  clone: string,
  repository: string
): Promise<string> {
  const remotes = (await git(clone, "remote")).split("\n").filter(Boolean);
  const wanted = repository.toLowerCase();
  for (const remote of remotes) {
    const url = (await git(clone, "remote", "get-url", remote)).toLowerCase();
    const named = url.replace(/\/+$/, "").replace(/\.git$/, "");
    if (named.endsWith(`/${wanted}`) || named.endsWith(`:${wanted}`))
      return remote;
  }
  if (remotes.includes("origin")) return "origin";
  throw new Error(
    `No remote of ${clone} points at ${repository}, and it has no origin`
  );
}
