---
status: accepted
date: 2026-10-21
---

# Rules find Duplicate code and Repeated edits, and the Assistant judges them

## Context and Problem Statement

Agent-written Changes repeat themselves. They copy a block into a third place instead of reusing it, or sweep one edit across dozens of files and miss or vary a site (issue #165). Neither shows in a file-by-file diff. Duplicate-code checks are noisy, because imports, boilerplate and test setup repeat by nature. An Assistant asked to find duplication misses what it never reads, since a Change's diff is capped and the originals often sit outside it. Who finds the repetition, and who decides that it matters?

## Considered Options

- The Assistant finds and judges duplication, as Findings, with no help
- A deterministic check finds and reports duplication on its own
- A deterministic check finds candidates, and the Assistant judges them

## Decision Outcome

Chosen option: a deterministic check finds candidates, and the Assistant judges them. Rules are thorough and cheap: they read the whole repository, which no prompt can hold. The Assistant judges by meaning: it can tell a copied function from shared boilerplate, and a mistake from an intended difference. Each covers the other's weakness, so the check can be generous and needs no tuning to stay quiet.

- **Duplicate code.** Dear Reviewer indexes every tracked file at the head, leaving out skim-only files (ADR 0045), binary files and files over a size cap, within a time budget. It compares windows of lines, normalized the same way for every language: blank and comment-only lines dropped, whitespace stripped, and identifiers, numbers and strings replaced by placeholders. Added code that matches 6 or more normalized lines found elsewhere is a candidate. Up to 20 candidates, largest first, go into the Findings prompt (ADR 0017), fenced as other people's text. The Assistant raises a Finding only for the ones it judges real, naming the original's `path:line`, and can raise duplicates the check missed. If the budget runs out, the check covers the Change alone, and the prompt says so.
- **Repeated edits.** Dear Reviewer groups the Change's hunks by their normalized removed lines. A group of at least 3 sites with real content is a Repeated edit when more than half its sites made the same change as written. Sites that only share a shape, such as three tests that each got a new title, are no Repeated edit. Its differing sites made another change than the majority. Its missed sites, found through the same index, still hold the removed lines at the head. The overview always shows Repeated edits with links to each site, with no Assistant turn, because these are facts. When the Reviewer asks for Findings, differing sites and missed sites go into the prompt as candidates, and the Assistant raises a Finding where one looks like a mistake.

Neither one hides a file, groups files, or changes what Next unviewed file visits. A steered Assistant can at worst leave a real duplicate unraised, and the Repeated edits in the overview don't depend on it.

### Consequences

- Good, because the originals of a copy are found wherever they are in the repository, and a sweep's missed sites are found at all.
- Good, because the Assistant filters the noise, so no thresholds need tuning per language or repository.
- Good, because the check works on every language and needs no parser, so it doesn't wait on a syntax-tree layer.
- Bad, because indexing the repository costs time on every Change, bounded by the budget, and a large repository can fall back to the Change alone.
- Bad, because Duplicate code shows only when the Reviewer asks for Findings, and is only as good as the Assistant's judgment.
- Bad, because normalized lines miss a copy whose statements were reordered or split across other lines.

## What is built

The rules live in `extension/src/repetition.ts`, which imports neither `vscode` nor git, and the parts that read git and the head worktree in `extension/src/repetitions.ts`.

- **Normalizing.** A line drops when it is blank or only a comment: `//`, `/* */`, a `#` or `--` that starts a word, or a `*` that starts the line. A `/*` opens a block comment only at the start of a line or after a space, bracket, comma, semicolon or `=`, and only if a closing `*/` follows within 2000 lines, so a glob such as `dist/*` hides nothing. A trailing comment drops too. Each name becomes `I`, each number `N` and each string `S`; punctuation stays, so `f(a)` and `f(a(b))` differ. A line has content when it holds any of the three.
- **The index.** The first overview of a head starts it, in the background, and a request for Findings waits for it. It reads `git ls-files` in the head worktree and leaves out skim-only files (ADR 0045: for files the Change doesn't touch, lock files and the base's `linguist-generated`), links, binary files and files over 200,000 bytes. It stops after 10 seconds and is then partial, and it gives the extension host a turn after each file. A request for Findings waits at most 5 seconds for an index still building, then goes on with the Change's own files and says the check was partial. It keeps hashes of normalized lines and of windows of 6, not text, and the last three heads only.
- **Repeated edits.** The hunks of `git diff -U0`, skim-only files left out, group by their normalized removed lines. A group is an edit at 3 or more hunks when its removed lines have content and more than half its hunks made the same change. A hunk's change is what a diff of its removed tokens against its added tokens, comments dropped, took away and put in, with names, strings and numbers as written: `-foo(a) +bar(a)` and `-foo(b) +bar(b)` make one change, and `-"a" +"b"` and `-"c" +"d"` two. A name the hunk both removed and added is its own, moved or kept, and counts by where it first is in the removed lines, which have one shape across the group: `-x.close() +close(x)` and `-y.close() +close(y)` make one change, as do two argument swaps of different names. The diff takes the earliest of equally long alignments, so the same lines always give the same change. A hunk that only deletes lines is its removed tokens, with names as written and numbers and strings as placeholders: `-drop(1)` and `-drop(2)` make one change, and deleting `import {x} from "y"` and `import {z} from "w"` two. The most common change is the majority's, and a hunk with another is a differing site. A group whose most common change is at half its hunks or fewer is dropped, and gives the overview and the Findings prompt nothing. A missed site is a place the index holds with those removed lines in a row, outside every hunk's added lines. A missed site must also hold every name that all the sites' removed lines share, read from the file as written, so a renamed call finds the callers that kept the old name, and not every call of the same shape. An edit whose sites share no name has no missed sites. At most 20 missed sites are listed, and the count stops at 500. The search reads at most 2000 look-alike places for each edit, and one that stops there counts as partial, as an index that ran out of time does.
- **Duplicate code.** A window of 6 added lines is a candidate when it has content on at least 3 lines and at least 3 different lines, so a run of the same line or a stack of closing braces is not. It matches windows of the index and of the Change's own files at the head. Of two blocks the Change added, the later is the candidate and the earlier its original. A block keeps up to 3 places.
- **Where it shows.** The overview lists Repeated edits under the Reading Order, open when an edit has a differing or a missed site. While the index builds, or after it ran out of time, it says missed sites aren't fully checked. The Findings prompt gets the two fenced sections when there are candidates, and says when the index was partial.
