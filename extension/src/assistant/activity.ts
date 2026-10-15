// What the Assistant is doing while it works on a reply, in words for the
// Reviewer: each tool it calls becomes a step, such as "Reading util.py",
// with paths relative to the Change's worktrees, or "Reading commit abc123"
// for a git tool (ADR 0030).

import * as path from "path";
import type { Change } from "../openChanges";
import type { ToolUse } from "./claude";
import { gitServerName } from "./gitTools";

export interface Step {
  /** Such as "Reading". */
  doing: string;
  /** Such as a path relative to the worktree, or a search pattern. */
  subject?: string;
}

export function describeToolUse(change: Change, use: ToolUse): Step {
  const text = (key: string) =>
    typeof use.input[key] === "string" ? (use.input[key] as string) : undefined;
  if (use.name === "Read") {
    const file = text("file_path");
    if (!file) return { doing: "Reading a file" };
    const head = inside(change.headDir, file);
    if (head !== undefined) return { doing: "Reading", subject: head };
    const base = inside(change.baseDir, file);
    if (base !== undefined)
      return { doing: "Reading the base side of", subject: base };
    return { doing: "Reading", subject: file };
  }
  if (use.name === "Grep")
    return { doing: "Searching for", subject: text("pattern") };
  if (use.name === "Glob")
    return { doing: "Finding files matching", subject: text("pattern") };
  const gitTool = use.name.startsWith(`mcp__${gitServerName}__`)
    ? use.name.slice(`mcp__${gitServerName}__`.length)
    : undefined;
  const file = text("path");
  const lines =
    typeof use.input.startLine === "number" &&
    typeof use.input.endLine === "number"
      ? `:${use.input.startLine}-${use.input.endLine}`
      : "";
  if (gitTool === "log")
    return file
      ? { doing: "Reading the history of", subject: `${file}${lines}` }
      : { doing: "Reading the commits", subject: text("range") };
  if (gitTool === "show")
    return { doing: "Reading commit", subject: text("revision") };
  if (gitTool === "blame")
    return {
      doing: "Reading who last changed",
      subject: `${file ?? "a file"}${lines}`,
    };
  if (gitTool === "diff")
    return {
      doing: "Comparing",
      subject: `${text("from") ?? "base"}..${text("to") ?? "head"}${file ? ` in ${file}` : ""}`,
    };
  return { doing: `Using ${use.name}` };
}

/** The file's path relative to the folder, with forward slashes, if it is inside it. */
function inside(dir: string, file: string): string | undefined {
  const relative = path.relative(dir, path.resolve(dir, file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return undefined;
  return relative.split(path.sep).join("/");
}
