---
status: accepted
date: 2026-10-20
---

# Mark skim-only files by rules Dear Reviewer checks, never by the Assistant

## Context and Problem Statement

On a Change of dozens of files, the Reading Order (ADR 0022) says what to read, not what to skip. A lock file, a generated file and a file moved with no edits fill the list, and Next unviewed file stops at each one (issue #115). The Reviewer needs to see which files need no close reading, and to see the Change's core first. Who decides that a file is skim-only, and where does the decision stop?

## Considered Options

- The Assistant marks files skim-only in its reply
- Dear Reviewer marks them by rules it checks: a list of lock file names, the `.gitattributes` of the base commit, and byte-for-byte renames
- Dear Reviewer marks them by rules, and reads `.gitattributes` from the head

## Decision Outcome

Chosen option: "Dear Reviewer marks them by rules it checks, from the base commit". Rule 4 of ADR 0042 treats the Assistant's output as untrusted. A skim-only mark tells the Reviewer not to look closely, so a steered Assistant could hide the one file that matters. The mark needs a source that nothing in the Change can steer.

A changed file is skim-only when:

- Its name is in a built-in list of lock files, in any folder: `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `uv.lock`, `poetry.lock`, `Pipfile.lock`, `Gemfile.lock`, `go.sum`, `composer.lock`, `Podfile.lock`, `pubspec.lock`, `mix.lock` or `flake.lock`.
- The `.gitattributes` files of the Change's base commit mark it `linguist-generated`, which `git check-attr --source=<base>` reads from the base's tree alone. The head's `.gitattributes` has no say, because the author of a pull request can edit it to mark their own files.
- It is an added file with the same blob as a file the Change deletes, or that deleted file. Both paths are skim-only. Change Files keeps listing them as two entries, and a move with any edit marks neither.

The Reading Order changes in these ways:

- The prompt lists the skim-only files apart and tells the Assistant to leave them out. Dear Reviewer removes them from every step the reply holds, and puts them in a last step, "Skim-only", after "Other files" and "Since the suggestion". The step is built when the Reading Order is shown, so it is right for a later head too.
- The first step is the core of the change. The prompt asks for the 3 to 5 files that carry the Change's intent. Dear Reviewer keeps at most 5 there, starting with the summary's start file, and the rest follow in a step of their own with the Assistant's label. A Reading Order that falls back to tree order has no core step. This amends ADR 0022.
- Change Files, in either sort mode, and the overview show a skim-only file muted, with its reason. The overview's Skim-only step starts collapsed. A skim-only file opens and is marked viewed as any other file is.
- Next and Previous unviewed file skip skim-only files. The setting `dearReviewer.visitSkimOnlyFiles`, off by default, makes them visit these files, and they visit them when nothing else is left unviewed.
- If git can't say which files are skim-only, none is: a failure never hides a file.

### Consequences

- Good, because a Reviewer sees what to skim on a large Change, and nothing the Assistant says or a pull request contains can mark a file to be skipped.
- Good, because a file that moved with no edits has nothing to read in its diff beyond the move.
- Bad, because a lock file the author tampered with is skipped by default, as GitHub collapses it. The file stays in the list with its reason, and the setting visits it.
- Bad, because a pull request that changes a file the base marks generated, such as hand-written code in a generated folder, shows it as skim-only. The base's owners chose that rule.
- Bad, because a pull request that adds or removes `.gitattributes` rules sees the base's rules until the pull request merges.
