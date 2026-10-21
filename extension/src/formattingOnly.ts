// Formatting-only files (ADR 0048): whether two versions of a file have the
// same syntax tree under tree-sitter, so a file that was only reformatted
// can be marked skim-only. The mark tells the Reviewer not to read closely,
// so every doubt answers no: a version with a parse error, a different tree,
// a leaf with other text, or anything but whitespace between two leaves.
// Runs in the worker thread (formattingWorker.ts), and under plain Node in
// the unit tests, so it imports no `vscode`.

import { Language, Parser, type Tree, type TreeCursor } from "web-tree-sitter";
import { grammarTable, wasmOf, type GrammarName } from "./formattingGrammars";

/** Thrown when the deadline passes in the middle of a comparison. */
class Canceled extends Error {}

/** Only these count as whitespace between two leaves, so a no-break space doesn't. */
const whitespaceOnly = /^[ \t\n\r\f\v]*$/;

interface Version {
  source: string;
  tree: Tree;
}

/**
 * Loads `web-tree-sitter` and the grammars it's asked for, from the paths
 * `wasmFile` gives for a `.wasm` file name, and compares two versions of a
 * file.
 */
export class FormattingComparer {
  private readonly languages = new Map<GrammarName, Language>();

  private constructor(private readonly wasmFile: (name: string) => string) {}

  static async create(
    wasmFile: (name: string) => string
  ): Promise<FormattingComparer> {
    await Parser.init({ locateFile: (name: string) => wasmFile(name) });
    return new FormattingComparer(wasmFile);
  }

  /** The grammar's language, loaded once. Throws if it can't load. */
  async language(name: GrammarName): Promise<Language> {
    let language = this.languages.get(name);
    if (!language) {
      language = await Language.load(this.wasmFile(wasmOf(name)));
      this.languages.set(name, language);
    }
    return language;
  }

  /**
   * Whether the two versions, in this language, differ in formatting only.
   * The two parses and the comparison have `budgetMs` from when the grammar
   * has loaded. Gives undefined, for no answer, when that passes or anything
   * fails, and false for a version with a syntax error.
   */
  async isFormattingOnly(
    name: GrammarName,
    base: string,
    head: string,
    budgetMs: number
  ): Promise<boolean | undefined> {
    let language: Language;
    try {
      language = await this.language(name);
    } catch {
      return undefined;
    }
    const deadline = Date.now() + budgetMs;
    const parser = new Parser();
    const trees: Tree[] = [];
    try {
      parser.setLanguage(language);
      const versions: Version[] = [];
      for (const source of [base, head]) {
        const tree = parser.parse(source, null, {
          // A callback that returns true cancels the parse, and gives no tree.
          progressCallback: (() => Date.now() > deadline) as () => void,
        });
        if (!tree) return undefined;
        trees.push(tree);
        // True when the tree holds an error or a missing node, which
        // tree-sitter put in to repair broken syntax.
        if (tree.rootNode.hasError) return false;
        versions.push({ source, tree });
      }
      const { gapShape, indentation, directives } = grammarTable[name];
      return sameTrees(versions[0], versions[1], deadline, {
        gapShape: gapShape === true,
        indentation: indentation === true,
        directives: directives === true,
      });
    } catch {
      return undefined;
    } finally {
      for (const tree of trees) tree.delete();
      parser.delete();
    }
  }
}

/** Nodes that hold text, where whitespace is data, such as a string or a heredoc. */
const holdsText =
  /string|char|rune|heredoc|template|scalar|regex|quote|comment|text_block|verbatim|interpolat|substitution/;

/** Strings that only sit side by side, which hold no text of their own between them. */
const joinsStrings = /concatenated|chained/;

/** Nodes whose text goes on past their last leaf, such as the blank lines at the end of a block scalar. */
const trailsText = /block_scalar|heredoc/;

/** Nodes whose text a pragma or a directive hangs on, such as `// @ts-ignore` or `//go:build`. */
const comment = /comment/;

/** A token that closes or separates, which a line break before can't make mean something else. */
const closing = /^[)\]},;]$/;

/** An unnamed token made of letters, such as `return`, `throw` or `abstract`. */
const keyword = /^[a-z_]+$/i;

/** The parts of a Python statement that begin a line of their own, as well as a block's statements. */
const lineStarting =
  /^(else|elif|except|finally|case)_clause$|^except_group_clause$/;

const lineBreak = /[\r\n]/;

/** How many line breaks a gap holds, counting a CRLF as one. */
function breaks(gap: string): number {
  return gap.match(/\r\n|\r|\n/g)?.length ?? 0;
}

/** 0 for nothing between two leaves, 1 for whitespace on a line, 2 for a line break. */
function gapShape(gap: string): number {
  return gap === "" ? 0 : lineBreak.test(gap) ? 2 : 1;
}

interface Ancestor {
  type: string;
  start: number;
}

/** What the walk knows of the leaf before the gap it is looking at. */
interface Before {
  keyword: boolean;
  comment: boolean;
  /** Whether it sits in a node whose text goes on past it, so the gap after it is text. */
  trailsText: boolean;
}

/**
 * Whether the leaf, at `start`, is the first thing in a statement that has a
 * line of its own in Python, which is where its indentation counts.
 */
function startsLine(ancestors: readonly Ancestor[], leaf: Ancestor): boolean {
  const chain = [...ancestors, leaf];
  for (let i = chain.length - 1; i >= 0 && chain[i].start === leaf.start; i--) {
    const parent = chain[i - 1]?.type;
    if (parent === "block" || parent === "module") return true;
    if (lineStarting.test(chain[i].type)) return true;
  }
  return false;
}

/**
 * Whether the indentations of the two versions of a Python file's statements
 * stand for each other, one for one, so that a block that was moved in or out
 * is not read as formatting, and nothing the tree can't see, such as a
 * dedent to a level no block has or a tab among spaces, gets through.
 */
class Indentations {
  private readonly forward = new Map<string, string>();
  private readonly backward = new Map<string, string>();

  agree(base: string, head: string): boolean {
    if (base !== head && (base.includes("\t") || head.includes("\t")))
      return false;
    if ((this.forward.get(base) ?? head) !== head) return false;
    if ((this.backward.get(head) ?? base) !== base) return false;
    this.forward.set(base, head);
    this.backward.set(head, base);
    return true;
  }
}

/** The rules a grammar adds to the whitespace checks. */
interface Rules {
  gapShape: boolean;
  indentation: boolean;
  directives: boolean;
}

/**
 * Whether the trees have the same nodes in the same order, with the same
 * field names and the same text in each leaf, and only whitespace between
 * leaves. Walks both at once, so the first difference ends it.
 *
 * Whitespace between two leaves can still be data, or a line break a grammar
 * doesn't model, so where the two versions' whitespace differs it has to pass
 * more checks:
 * - Before the first leaf it is the same, since a shebang, a coding cookie
 *   and an `@charset` count only where they stand.
 * - It isn't inside a node that holds text, or inside an interpolation, since
 *   a grammar can leave whitespace-only text out of its leaves, and the
 *   expression of an f-string `{a=}` is output as written.
 * - The whitespace after a block scalar or heredoc is the same, since it can
 *   hold blank lines that are part of the text.
 * - Next to a comment it holds as many line breaks, since a pragma such as
 *   `// @ts-ignore` or `//go:build` counts for the line or the blank line
 *   after it, and moves to another line with a line break.
 * - A line break after a keyword, or before `=>`, is in both versions or in
 *   neither, since `return\nx` and `abstract\nclass` mean something else in
 *   many languages, and `(a)\n=> a` is not valid. A line break before a
 *   closing bracket or a separator can't change anything.
 * - With `gapShape`, for a grammar that reads a line break as a space or `[a`
 *   as `[ a`, nothing, whitespace on a line and a line break each stay what
 *   they were, and the head has no carriage return where the base differs,
 *   which a shell reads as part of a word.
 * - With `directives`, a token that starts with `#` still has a line break
 *   before it, since a preprocessor directive begins its line.
 * - With `indentation`, the indentations of a Python file's statements
 *   stand for each other one for one, and no tab is among them if they
 *   changed.
 */
function sameTrees(
  a: Version,
  b: Version,
  deadline: number,
  rules: Rules
): boolean {
  const ca = a.tree.walk();
  const cb = b.tree.walk();
  try {
    let endA = 0;
    let endB = 0;
    let steps = 0;
    // The ancestors of the node the cursors are at.
    const ancestors: Ancestor[] = [];
    // The node that holds the whitespace before the next leaf, once known.
    let owner = "";
    let afterLeaf = false;
    let before: Before | undefined;
    const indentations = new Indentations();
    const between = (version: Version, from: number, to: number) =>
      from <= to ? version.source.slice(from, to) : undefined;
    for (;;) {
      if (++steps % 1024 === 0 && Date.now() > deadline) throw new Canceled();
      if (!sameNode(ca, cb)) return false;
      if (afterLeaf) {
        // The first node after a leaf is a child of the node holding the gap.
        owner = ancestors[ancestors.length - 1]?.type ?? "";
        afterLeaf = false;
      }
      const type = ca.nodeType;
      const start = ca.startIndex;
      const downA = ca.gotoFirstChild();
      if (downA !== cb.gotoFirstChild()) return false;
      if (downA) {
        ancestors.push({ type, start });
        continue;
      }
      const gapA = between(a, endA, ca.startIndex);
      const gapB = between(b, endB, cb.startIndex);
      if (
        gapA === undefined ||
        gapB === undefined ||
        !whitespaceOnly.test(gapA) ||
        !whitespaceOnly.test(gapB) ||
        a.source.slice(ca.startIndex, ca.endIndex) !==
          b.source.slice(cb.startIndex, cb.endIndex)
      )
        return false;
      const inComment =
        comment.test(type) || ancestors.some((x) => comment.test(x.type));
      if (gapA !== gapB) {
        if (!before) return false;
        if (
          before.trailsText ||
          (holdsText.test(owner) && !joinsStrings.test(owner)) ||
          ancestors.some((x) => x.type === "interpolation")
        )
          return false;
        if ((before.comment || inComment) && breaks(gapA) !== breaks(gapB))
          return false;
        const lineBreakChanged = lineBreak.test(gapA) !== lineBreak.test(gapB);
        if (
          lineBreakChanged &&
          ((before.keyword && !closing.test(type)) || type === "=>")
        )
          return false;
        if (
          rules.gapShape &&
          (gapShape(gapA) !== gapShape(gapB) || gapB.includes("\r"))
        )
          return false;
        if (
          rules.directives &&
          type.startsWith("#") &&
          !(lineBreak.test(gapA) && lineBreak.test(gapB))
        )
          return false;
      }
      if (
        rules.indentation &&
        !inComment &&
        startsLine(ancestors, { type, start }) &&
        (before === undefined || lineBreak.test(gapA)) &&
        !indentations.agree(
          gapA.slice(gapA.lastIndexOf("\n") + 1),
          gapB.slice(gapB.lastIndexOf("\n") + 1)
        )
      )
        return false;
      endA = ca.endIndex;
      endB = cb.endIndex;
      afterLeaf = true;
      before = {
        keyword: !ca.nodeIsNamed && keyword.test(type),
        comment: inComment,
        trailsText: ancestors.some((x) => trailsText.test(x.type)),
      };
      // Next in order: a sibling, or the next sibling of the closest ancestor with one.
      while (!ca.gotoNextSibling()) {
        if (cb.gotoNextSibling()) return false;
        const upA = ca.gotoParent();
        if (upA !== cb.gotoParent()) return false;
        if (!upA)
          return (
            whitespaceOnly.test(a.source.slice(endA)) &&
            whitespaceOnly.test(b.source.slice(endB))
          );
        ancestors.pop();
      }
      if (!cb.gotoNextSibling()) return false;
    }
  } finally {
    ca.delete();
    cb.delete();
  }
}

function sameNode(a: TreeCursor, b: TreeCursor): boolean {
  return (
    a.nodeType === b.nodeType &&
    a.nodeIsNamed === b.nodeIsNamed &&
    a.currentFieldName === b.currentFieldName &&
    !a.nodeIsMissing &&
    !b.nodeIsMissing &&
    a.nodeType !== "ERROR"
  );
}
