// Asks VS Code's language servers for the symbols and call hierarchy of a
// Change's head worktree, for `gatherFlow`. Calls into code outside the
// Change's worktrees, such as a library, are left out: the Reviewer can't
// jump the diff there.

import * as path from "path";
import * as vscode from "vscode";
import { changedFiles, type Change } from "./changeWorkspace";
import { fileChangeFromDiff, type FileChange } from "./codeFlow";
import type { CallItem, CallLink, FlowSource } from "./codeFlowGather";
import { git } from "./git";

interface Handle {
  uri: vscode.Uri;
  /** Where the symbol's name is, which is where servers prepare a hierarchy. */
  position: vscode.Position;
  /** Set once the language server has prepared the item. */
  item?: vscode.CallHierarchyItem;
}

/** Languages with no calls to draw, which would only earn a "no language server" notice. */
const NOT_CODE = new Set([
  "plaintext",
  "markdown",
  "json",
  "jsonc",
  "yaml",
  "xml",
  "html",
  "css",
  "toml",
  "ini",
  "properties",
  "dotenv",
  "csv",
  "ignore",
  "log",
  "restructuredtext",
]);

const CALLABLE = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

/** The Change's files, with what the diff does to each; a deleted file's symbols are the base worktree's. */
export async function fileChanges(change: Change): Promise<FileChange[]> {
  return Promise.all(
    (await changedFiles(change)).map(async (file) =>
      file.status === "deleted"
        ? {
            path: file.path,
            isNewFile: false,
            isDeletedFile: true,
            addedLines: [],
            modifiedLines: [],
          }
        : fileChangeFromDiff(
            file.path,
            await git(
              change.repository,
              "--literal-pathspecs",
              "diff",
              "--no-color",
              "--no-ext-diff",
              "--no-renames",
              "-U0",
              change.mergeBase,
              change.headSha,
              "--",
              file.path
            ),
            file.status === "added"
          )
    )
  );
}

export function languageServerSource(change: Change): FlowSource {
  const fileUri = (file: string, side?: "base") =>
    vscode.Uri.file(
      path.join(
        side === "base" ? change.baseDir : change.headDir,
        ...file.split("/")
      )
    );

  /** Where a URI is in the Change's worktrees: which side, and its path from the repository root. */
  const placeOf = (
    uri: vscode.Uri
  ): { path: string; side?: "base" } | undefined => {
    for (const [dir, side] of [
      [change.headDir, undefined],
      [change.baseDir, "base" as const],
    ] as const) {
      const relative = path.relative(dir, uri.fsPath);
      if (
        relative &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      ) {
        return { path: relative.split(path.sep).join("/"), side };
      }
    }
    return undefined;
  };

  /** The base side's ids start with "base:", so a file's symbols there don't collide with its head symbols. */
  const idOf = (
    file: { path: string; side?: "base" },
    line: number,
    name: string
  ) => `${file.side === "base" ? "base:" : ""}${file.path}:${line}:${name}`;

  const itemOf = (call: vscode.CallHierarchyItem): CallItem | undefined => {
    const place = placeOf(call.uri);
    if (!place) {
      return undefined;
    }
    const line = call.selectionRange.start.line + 1;
    return {
      id: idOf(place, line, call.name),
      name: call.name,
      path: place.path,
      line: call.range.start.line + 1,
      endLine: call.range.end.line + 1,
      ...(place.side === undefined ? {} : { side: place.side }),
      handle: {
        uri: call.uri,
        position: call.selectionRange.start,
        item: call,
      } satisfies Handle,
    };
  };

  const hierarchyItem = (item: CallItem): vscode.CallHierarchyItem =>
    (item.handle as Handle).item!;

  const links = (
    calls:
      | readonly (
          vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall
        )[]
      | undefined,
    side: "from" | "to"
  ): CallLink[] =>
    (calls ?? []).flatMap((call) => {
      const target = (
        call as unknown as Record<string, vscode.CallHierarchyItem>
      )[side];
      const item = itemOf(target);
      return item ? [{ item, label: target.detail || undefined }] : [];
    });

  return {
    async languageOf(file, side) {
      const { languageId } = await vscode.workspace.openTextDocument(
        fileUri(file, side)
      );
      return NOT_CODE.has(languageId) ? undefined : languageId;
    },
    async symbols(file, side) {
      const uri = fileUri(file, side);
      const found = await vscode.commands.executeCommand<
        (vscode.DocumentSymbol | vscode.SymbolInformation)[]
      >("vscode.executeDocumentSymbolProvider", uri);
      const items: CallItem[] = [];
      const visit = (
        symbol: vscode.DocumentSymbol | vscode.SymbolInformation
      ) => {
        const documentSymbol = "selectionRange" in symbol ? symbol : undefined;
        const range =
          documentSymbol?.range ??
          (symbol as vscode.SymbolInformation).location.range;
        if (CALLABLE.has(symbol.kind)) {
          const position = documentSymbol?.selectionRange.start ?? range.start;
          items.push({
            id: idOf({ path: file, side }, position.line + 1, symbol.name),
            name: symbol.name,
            path: file,
            line: range.start.line + 1,
            endLine: range.end.line + 1,
            ...(side === undefined ? {} : { side }),
            handle: { uri, position } satisfies Handle,
          });
        }
        documentSymbol?.children.forEach(visit);
      };
      (found ?? []).forEach(visit);
      return items;
    },
    async prepare(symbol) {
      const { uri, position } = symbol.handle as Handle;
      const prepared = await vscode.commands.executeCommand<
        vscode.CallHierarchyItem[]
      >("vscode.prepareCallHierarchy", uri, position);
      return (prepared ?? []).flatMap((call) => itemOf(call) ?? []);
    },
    async incoming(item) {
      return links(
        await vscode.commands.executeCommand<
          vscode.CallHierarchyIncomingCall[]
        >("vscode.provideIncomingCalls", hierarchyItem(item)),
        "from"
      );
    },
    async outgoing(item) {
      const calls = await vscode.commands.executeCommand<
        vscode.CallHierarchyOutgoingCall[]
      >("vscode.provideOutgoingCalls", hierarchyItem(item));
      // Servers answer in their own order; swimlanes follow the order of the calls in the code.
      const callSite = (call: vscode.CallHierarchyOutgoingCall) =>
        call.fromRanges[0]?.start ?? new vscode.Position(0, 0);
      return links(
        [...(calls ?? [])].sort((a, b) => callSite(a).compareTo(callSite(b))),
        "to"
      );
    },
  };
}
