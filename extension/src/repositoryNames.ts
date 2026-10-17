// How a GitHub repository is named: by `owner/name`, in a remote URL, on a
// host. Plain Node, so unit tests load it.

/** `owner/name` as GitHub allows it, so it can't carry extra search qualifiers. */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isRepositoryName(name: string): boolean {
  return REPOSITORY.test(name) && !name.split("/").some((p) => /^\.+$/.test(p));
}

/**
 * The host GitHub serves repositories from, for the API at `apiUrl`:
 * github.com for api.github.com, and the server's own host for GitHub
 * Enterprise Server (`https://<host>/api/v3`).
 */
export function gitHubHost(apiUrl: string): string {
  let host: string;
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return "github.com";
  }
  return host === "api.github.com" ? "github.com" : host;
}

/** `owner/name` if the remote URL is a repository on the GitHub host. */
export function gitHubRepository(
  url: string,
  host: string
): string | undefined {
  let urlHost: string;
  let repoPath: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    [, urlHost, repoPath] = scp;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) return;
    urlHost = parsed.hostname;
    repoPath = parsed.pathname;
  }
  if (urlHost.toLowerCase() !== host) return;
  const name = repoPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return isRepositoryName(name) ? name : undefined;
}

/** Whether the remote URL ends in owner/name, with or without `.git`, on any host. */
export function namesRepository(url: string, repository: string): boolean {
  const named = url
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const wanted = repository.toLowerCase();
  return named.endsWith(`/${wanted}`) || named.endsWith(`:${wanted}`);
}
