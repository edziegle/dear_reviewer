// Finds the credentials Dear Reviewer uses to call GitHub: VS Code's GitHub
// sign-in for github.com, then a personal access token kept in the
// extension's secret storage (the OS keychain).

import * as vscode from "vscode";

const TOKEN_KEY = "dearReviewer.githubToken";
const SCOPES = ["read:user", "repo", "read:org"];

export class GitHubAuth {
  readonly onDidChange: vscode.Event<void>;

  constructor(private readonly secrets: vscode.SecretStorage) {
    const changed = new vscode.EventEmitter<void>();
    this.onDidChange = changed.event;
    secrets.onDidChange((e) => {
      if (e.key === TOKEN_KEY) changed.fire();
    });
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === "github") changed.fire();
    });
  }

  /**
   * The token for the API at `apiUrl`, or undefined when the Reviewer isn't
   * signed in. VS Code's GitHub session is only ever sent to github.com.
   */
  async token(apiUrl: string): Promise<string | undefined> {
    if (isGitHubDotCom(apiUrl)) {
      const session = await vscode.authentication.getSession("github", SCOPES, {
        silent: true,
      });
      if (session) return session.accessToken;
    }
    return this.secrets.get(TOKEN_KEY);
  }

  /** Signs in with VS Code's GitHub authentication, asking if needed. */
  async signIn(): Promise<void> {
    await vscode.authentication.getSession("github", SCOPES, {
      createIfNone: true,
    });
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(TOKEN_KEY, token);
  }

  async forgetToken(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
  }
}

function isGitHubDotCom(apiUrl: string): boolean {
  try {
    return new URL(apiUrl).hostname === "api.github.com";
  } catch {
    return false;
  }
}
