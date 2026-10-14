# Build Dear Reviewer as a VS Code extension

The main reason for Dear Reviewer is real code navigation (go to definition, find usages, browsing any file) while reviewing, in a work monorepo of Python, TypeScript/JavaScript, OpenTofu, YAML and Bash, and home projects in Python and Rust. VS Code gets that navigation from language servers the Reviewer already has installed, as long as both sides of a diff are real files in app-managed worktrees. A standalone native macOS app would have to embed an editor and run a language server for every one of those languages itself. So despite native macOS experience, we build a VS Code extension, separate from the official GitHub Pull Requests extension.

## Considered Options

- **PyCharm plugin**: rejected. JetBrains PR diffs show both sides as in-memory revisions resolved against the local index, and full navigation exists only in Review Mode for the pull request on the current branch. A plugin can't fix that, because real navigation needs the IDE to index that version of the code. See `docs/research/review-code-navigation.md`.
- **Standalone native macOS app**: rejected for now. Language-server management for six or more languages, on both versions of the code, would be the largest and riskiest part of the project. "Open this line in an IDE" gives navigation but breaks the review flow this tool exists to fix.
- **Hybrid** (a native app for the Inbox, timeline and Assistant, handing diffs and navigation to an IDE): the fallback if base-side navigation in VS Code proves unworkable.
- **Building on, or forking, the official GitHub Pull Requests extension**: rejected. Its workflow is tied to Copilot, it lacks the JetBrains-style review experience we want, and depending on its internals would tie us to its roadmap.

## Consequences

- Navigation on the old (base) version depends on opening the base side of each diff from a real worktree. The spike in `spikes/base-nav/` showed this working on 2026-10-12, in VSCodium 1.135 with basedpyright, on a two-file Python repo: go to definition on each side resolved inside that side's own worktree. It is still unchecked on the work monorepo, in other languages, and for indexing cost.
- Two worktrees per open Change in a large monorepo may cost significant disk space and language-server indexing time.
- Review UI such as the timeline is built from webviews, not native views. ADR 0012 limits this: the Change's code appears only in VS Code's editors, never in a webview, and a new webview needs a reason no native view fits.
