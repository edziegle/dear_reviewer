// Syntax highlighting for a Change's files depends on the language
// extensions the Reviewer has installed, since the files open in ordinary
// editors (ADR 0012). VSCodium mostly lacks VS Code's suggestions of an
// extension for a file type, so the overview notices which file extensions
// no installed language covers and offers to search the Extensions view for
// each, once, without pressure (as ADR 0021 asks). Dear Reviewer keeps no
// mapping from file types to extensions and never installs one itself.

import * as vscode from "vscode";
import {
  type CheckedFile,
  type LanguageContribution,
  unhighlighted,
} from "./unhighlighted";

/** Keeps the Reviewer's installed languages, associations and dismissals in view. */
export class LanguageOffer implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when what counts as unhighlighted may have changed. */
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];
  private search: (query: string) => unknown = searchExtensions;

  constructor(private readonly memory: vscode.Memento) {
    this.subscriptions = [
      this.changed,
      vscode.extensions.onDidChange(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("files.associations")) this.changed.fire();
      }),
    ];
  }

  /** The file extensions among these files that no installed language covers, and that weren't dismissed. */
  unhighlighted(files: readonly CheckedFile[]): string[] {
    const languages = vscode.extensions.all.flatMap(
      (extension) =>
        (extension.packageJSON?.contributes?.languages as
          LanguageContribution[] | undefined) ?? []
    );
    const associations =
      vscode.workspace
        .getConfiguration("files")
        .get<Record<string, string>>("associations") ?? {};
    return unhighlighted(files, languages, associations, this.dismissed());
  }

  /** Opens the Extensions view with a search for the file extension, without its dot. */
  find(extension: string): void {
    this.search(extension.replace(/^\./, ""));
  }

  /** Never offers these file extensions again, in any Change. */
  async dismiss(extensions: readonly string[]): Promise<void> {
    const all = new Set([...this.dismissed(), ...extensions]);
    await this.memory.update(dismissedKey, [...all]);
    this.changed.fire();
  }

  /** Hands the Extensions view's search to `search` instead, or back with none; for the tests. */
  searchWith(search?: (query: string) => void): void {
    this.search = search ?? searchExtensions;
  }

  private dismissed(): Set<string> {
    return new Set(this.memory.get<string[]>(dismissedKey) ?? []);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

function searchExtensions(query: string): Thenable<unknown> {
  return vscode.commands.executeCommand("workbench.extensions.search", query);
}

const dismissedKey = "dearReviewer.dismissedFileExtensions";
