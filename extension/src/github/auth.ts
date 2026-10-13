// Finds the credentials Dear Reviewer uses to call GitHub: VS Code's GitHub
// sign-in for github.com, then a personal access token kept in the
// extension's secret storage (the OS keychain), saved for one API origin.
// No token ever goes to an API URL that isn't https, except on loopback.

import * as vscode from "vscode";

const TOKEN_KEY_PREFIX = "dearReviewer.githubToken ";
const SCOPES = ["read:user", "repo", "read:org"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

export class InsecureApiUrlError extends Error {
  constructor(apiUrl: string) {
    super(
      `The GitHub API base URL must use https (plain http only on this machine), not ${apiUrl}`
    );
  }
}

/** The API URL's origin, if tokens may be sent to it. */
export function trustedOrigin(apiUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new InsecureApiUrlError(apiUrl);
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) throw new InsecureApiUrlError(apiUrl);
  return url.origin;
}

export class GitHubAuth {
  readonly onDidChange: vscode.Event<void>;

  constructor(private readonly secrets: vscode.SecretStorage) {
    const changed = new vscode.EventEmitter<void>();
    this.onDidChange = changed.event;
    secrets.onDidChange((e) => {
      if (e.key.startsWith(TOKEN_KEY_PREFIX)) changed.fire();
    });
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === "github") changed.fire();
    });
  }

  /**
   * The token for the API at `apiUrl`, or undefined when the Reviewer isn't
   * signed in to it. VS Code's GitHub session only ever goes to
   * https://api.github.com; a personal access token only to the origin it
   * was saved for.
   */
  async token(apiUrl: string): Promise<string | undefined> {
    let origin: string;
    try {
      origin = trustedOrigin(apiUrl);
    } catch {
      return undefined;
    }
    if (origin === "https://api.github.com") {
      const session = await vscode.authentication.getSession("github", SCOPES, {
        silent: true,
      });
      if (session) return session.accessToken;
    }
    return this.secrets.get(TOKEN_KEY_PREFIX + origin);
  }

  /** Signs in with VS Code's GitHub authentication, asking if needed. */
  async signIn(): Promise<void> {
    await vscode.authentication.getSession("github", SCOPES, {
      createIfNone: true,
    });
  }

  /** Saves a personal access token for the API at `apiUrl`. */
  async setToken(apiUrl: string, token: string): Promise<void> {
    await this.secrets.store(TOKEN_KEY_PREFIX + trustedOrigin(apiUrl), token);
  }

  async forgetToken(apiUrl: string): Promise<void> {
    await this.secrets.delete(TOKEN_KEY_PREFIX + new URL(apiUrl).origin);
  }
}
