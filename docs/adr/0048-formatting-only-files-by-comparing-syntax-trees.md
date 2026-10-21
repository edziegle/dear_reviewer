---
status: accepted
date: 2026-10-21
---

# Mark formatting-only files skim-only by comparing their syntax trees

## Context and Problem Statement

A formatter run, a re-indent or a reflow can touch dozens of files in a Change without changing what the code does, and agents do this often (issue #166, and #164 before it). ADR 0045 marks lock files, generated files and exact renames skim-only, but a file whose change is formatting only gets no mark. A skim-only mark tells the Reviewer not to read closely, so a wrong one hides a real change (threat model, path 13). How can Dear Reviewer tell that a change is formatting only, soundly?

## Considered Options

- `git diff` ignoring whitespace (`-w`, or `--ignore-cr-at-eol --ignore-space-at-eol --ignore-blank-lines`), with tiers of languages
- Running the repository's own formatter on both versions and comparing
- Parsing both versions with tree-sitter and comparing their syntax trees

## Decision Outcome

Chosen option: comparing syntax trees with tree-sitter. The whitespace options of git ignore whitespace inside strings, template literals and heredocs, where it's data: a blank line added to a SQL string would vanish, in every tier. The repository's formatter is configured by files in the Change, such as `prettier.config.js`, so running it would run the pull request's code. ADR 0045 ignores the head's `.gitattributes` for the same reason.

A modified file is skim-only, with the reason "Formatting only", when these all hold:

- Both versions parse with no error or missing node. Tree-sitter repairs broken syntax, and a repaired tree proves nothing.
- The two trees have the same shape: the same node types in the same order, and the text of every leaf identical. A whole tree catches meaning that lives in layout: `return\nx` and `return x` in JavaScript have the same tokens and different trees, and in Python, indenting a statement less to move it out of a block changes the tree.
- Only whitespace sits between two leaves, in both versions.

Where the whitespace between two leaves differs in the two versions, it has to pass more checks, since whitespace can carry meaning that a grammar doesn't keep in a leaf. Unit tests and a review found each of these, with grammars that parsed `' '` and `'\t'`, or `VAR=1 cmd` and `VAR= 1 cmd`, to the same tree:

- Before the first leaf it is the same, since a shebang, a coding cookie and `@charset` count only where they stand.
- It isn't inside a node that holds text, or inside an interpolation: a string, character, heredoc, template, scalar, regular expression or comment. There it has to be the same, byte for byte, since a grammar can leave whitespace-only text out of its leaves, and Python prints the expression of `f"{a=}"` as written.
- The whitespace after a block scalar or a heredoc is the same, since it can hold blank lines that are part of the text.
- Next to a comment it holds as many line breaks. A comment that instructs a tool, such as `// @ts-ignore`, `# noqa` or `//go:build`, counts for the line or the blank line after it, and moved to another line it is a different instruction.
- A line break after a keyword, or before `=>`, is in both versions or in neither, except before a closing bracket or a separator. `return\nx`, `throw\nx` and `abstract\nclass` mean something else in many languages, and `(a)\n=> a` is not valid, and not every grammar models that.
- For Bash and Kotlin, each gap stays what it was: nothing, whitespace on a line, or a line break, and the head gains no carriage return, which a shell reads as part of a word. Their grammars read `[a` as `[ a`, and Kotlin's reads `1\n+ 2` as `1 + 2`, though a line break ends a statement there.
- For C, C++ and C#, a token that starts with `#` still has a line break before it, since a directive begins its line.
- For C and C++, inside the arguments of a call, whitespace inside an argument stays whitespace or nothing. A macro that turns its argument into a string with `#` gives `a+b` and `a + b` as they were written, and the grammar can't tell such a macro from a function.
- For Go, a line break after a name, a literal or a closing bracket is in both versions or in neither, since Go ends a statement there. The grammar reads `if x\n{` and a call wrapped with no trailing comma as the same tree as the lines Go accepts.
- For Python, the indentations of the statements stand for each other one for one, and no tab is among them if they changed. A statement that moves on or off a line of its own, such as the body of `if x: a`, gets no mark. The grammar accepts a line that returns to an indentation no block has, and a tab among spaces, which Python refuses.

Anything else is a real change, including an edited comment, another quote style, an added trailing comma or added parentheses. A formatter run that does any of these gets no mark, and that failure is safe.

An added file and a deleted file that the rename detection of git pairs are both skim-only, with the reason "Moved, formatting only", when the same rule holds across the pair. Git only proposes the pair, and the tree rule decides, so the diff asks for pairs at 20% similarity: reformatting changes most lines, and the usual 50% would miss many moves. A file counts only if it is an ordinary file with the same mode on both sides, so a change of mode, a symbolic link and a submodule are never formatting only.

The mark is for whole files, from the Change's base to its head. Formatting-only hunks inside a file with real changes, and commits that only reformat, get no mark of their own.

- **Grammars.** `web-tree-sitter` runs a fixed set of WASM grammars bundled with the extension, copied at build time from pinned grammar packages: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C, C++, C#, Ruby, Bash, JSON, YAML, CSS and Kotlin. HTML, PHP and Markdown are left out, because whitespace between their tokens can be output: in `<pre>`, between inline elements, in PHP's inline HTML, or as a Markdown line break. Swift is left out because its grammar ships no WASM build. A file in any other language gets no mark. A grammar ships only with unit tests showing that its whitespace-sensitive constructs aren't marked. Grammars are never fetched at review time.
- **Limits.** Each version up to 1 MB and valid UTF-8, since bytes that aren't would decode to the same replacement character whatever they were. 500 ms per file for both parses and the comparison, counted once the grammar has loaded, and 15 seconds per Change. Parsing runs on a worker thread, and its marks arrive when they're ready. A worker that stops answering is ended 10 seconds after a file's time, and one that fails three times in a row is left alone for a minute and then tried again. Results are cached per pair of blobs, and only an answer is cached: not a file's time running out, nor a blob a partial clone doesn't have yet. A file too large, a parse that is canceled or fails, or a budget that runs out gives no mark.

Everything else follows ADR 0045, which this ADR amends with a fourth reason. The file stays listed, muted, with its reason. It sits in the Reading Order's Skim-only step. Next unviewed file skips it unless `dearReviewer.visitSkimOnlyFiles` is on. If anything fails, the file is not marked.

### Consequences

- Good, because a Change buried in reformatted files shows its real edits, and whitespace that carries meaning, in strings, blocks or layout, keeps a file unmarked.
- Good, because the Change's own code and configuration are never run.
- Bad, because the extension grows by about 2 MB packed and 22 MB unpacked, and it has 16 grammars to keep compatible with the ABI of the tree-sitter runtime.
- Bad, because every grammar can read some whitespace in a way its language doesn't, so a grammar's tests are the soundness argument, and a new one is a new chance to hide a change.
- Bad, because many formatter runs change quotes, commas or comments, and those files get no mark.
- Bad, because a Change in HTML, PHP, Markdown, Swift or any language outside the set gets no formatting-only marks.
- Bad, because marks arrive after the Change opens, so Next unviewed file can stop at a file that turns skim-only a moment later.
