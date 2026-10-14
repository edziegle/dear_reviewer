// Drives Dear Reviewer the way the Reviewer does, and reads back what the
// Reviewer would see.

import * as cp from "child_process";
import * as vscode from "vscode";

export interface ChangeRequest {
  repository: string;
  base: string;
  head: string;
  /** Set when the Change comes from this pull request. */
  pullRequest?: { repository: string; number: number };
}

export function openChange(request: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.openChange", request);
}

interface LinkApi {
  openLinksWith(open?: (url: string) => void): void;
}

async function linkApi(): Promise<LinkApi> {
  const extension = vscode.extensions.getExtension<LinkApi>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return extension.activate();
}

/**
 * Catches the links Dear Reviewer opens, from any of its panels, instead of
 * handing them to the browser, until `releaseLinks`.
 */
export async function catchLinks(): Promise<string[]> {
  const opened: string[] = [];
  (await linkApi()).openLinksWith((url) => opened.push(url));
  return opened;
}

export async function releaseLinks(): Promise<void> {
  (await linkApi()).openLinksWith(undefined);
}

export function closeChange(request: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.closeChange", request);
}

export function workspaceFolders(): { name: string; path: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    path: folder.uri.fsPath,
  }));
}

export function foldersAddedSince(before: { path: string }[]) {
  return workspaceFolders().filter(
    (folder) => !before.some((old) => old.path === folder.path)
  );
}

export function gitIn(cwd: string, ...args: string[]): string {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The repository's worktrees, as git reports them. */
export function worktreesOf(
  repository: string
): { path: string; detached: boolean }[] {
  return gitIn(repository, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((block) => block.split("\n"))
    .map((lines) => ({
      path: lines[0].replace(/^worktree /, ""),
      detached: lines.includes("detached"),
    }));
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function activeTabLabel(): string | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.label;
}

export interface DiffEntry {
  original?: string;
  modified?: string;
}

/**
 * The files in the multi-file diff, in the order shown. The tab API leaves out
 * files with a missing side, so this reads the diff's visible editors instead:
 * they come in (original, modified) pairs, and a missing side is an empty
 * in-memory editor.
 */
export function multiDiffFiles(): DiffEntry[] {
  const sides = vscode.window.visibleTextEditors.map((editor) => {
    const uri = editor.document.uri;
    return uri.scheme === "file" ? uri.fsPath : undefined;
  });
  const files: DiffEntry[] = [];
  for (let i = 0; i + 1 < sides.length; i += 2) {
    files.push({ original: sides[i], modified: sides[i + 1] });
  }
  return files;
}

export interface DiffSide {
  /** The file's path, for a file on disk. */
  file?: string;
  /** The URI's scheme, for a side that isn't a file on disk. */
  scheme?: string;
  text: string;
}

/**
 * Both sides of each file in the multi-file diff, in the order shown, with
 * their text, including sides that aren't files on disk. A missing side is
 * an empty editor that isn't a file.
 */
export function multiDiffSides(): { original: DiffSide; modified: DiffSide }[] {
  const sides = vscode.window.visibleTextEditors.map(({ document }) => ({
    ...(document.uri.scheme === "file"
      ? { file: document.uri.fsPath }
      : { scheme: document.uri.scheme }),
    text: document.getText(),
  }));
  const files: { original: DiffSide; modified: DiffSide }[] = [];
  for (let i = 0; i + 1 < sides.length; i += 2) {
    files.push({ original: sides[i], modified: sides[i + 1] });
  }
  return files;
}

export async function eventually(
  check: () => void | Promise<void>,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Asks the language server where a symbol is defined, waiting for it to start. */
export async function definitionOf(
  file: string,
  line: number,
  character: number
): Promise<string[]> {
  const uri = vscode.Uri.file(file);
  await vscode.workspace.openTextDocument(uri);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const found = await vscode.commands.executeCommand<
      (vscode.Location | vscode.LocationLink)[]
    >(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(line, character)
    );
    if (found?.length) {
      return found.map((d) => ("targetUri" in d ? d.targetUri : d.uri).fsPath);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return [];
}

/**
 * Asks the language server for the usages of a symbol, declaration included,
 * and gives the files they are in, each once and sorted.
 */
export async function usagesOf(
  file: string,
  line: number,
  character: number
): Promise<string[]> {
  const uri = vscode.Uri.file(file);
  await vscode.workspace.openTextDocument(uri);
  const found = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeReferenceProvider",
    uri,
    new vscode.Position(line, character)
  );
  return [...new Set((found ?? []).map((usage) => usage.uri.fsPath))].sort();
}
