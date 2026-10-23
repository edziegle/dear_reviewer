# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Dear Reviewer is a VS Code extension (ADR 0001), developed and tested in VSCodium. Its own UI is VS Code tree views, VS Code's comments API, gutter decorations, and webviews for the timeline and the Assistant chat. The webviews are the only web surfaces, and they render inside the editor.

## Users

Developers who review code: teammates' GitHub pull requests, and code their own AI agents wrote. The first user is the author, a tech lead on a large polyglot monorepo at work (Python, OpenTofu, TypeScript, JavaScript, YAML, Bash) with home projects in Python and Rust, who spends most of the day reviewing. Design decisions should hold for any developer in that situation.

Terms follow `GLOSSARY.md`: the human is the Reviewer, the AI is the Assistant, the code under review is a Change.

## Product Purpose

Dear Reviewer is a workbench for a Reviewer. Changes come from GitHub pull requests across several repositories, gathered in an Inbox, and from local commit ranges such as an agent's branch. Opening a Change creates base and head worktrees, so both sides of the diff are real files and go to definition, find usages and browsing work on both versions with the language servers the Reviewer already has. Several Changes can be open at once.

Success means a Reviewer gets JetBrains-quality review workflow with real code navigation, and AI help paid for by the Claude login they already have rather than a per-quota AI product.

## Positioning

Real navigation on both sides of every diff, for pull requests and local Changes alike, with an Assistant that runs on the Reviewer's own `claude` CLI and stays out of the Reviewer's judgement. The official GitHub Pull Requests extension is tied to Copilot and gives local Changes no review workflow; JetBrains has the workflow but no reliable navigation in review and quota-priced AI.

## Operating Context

- The Reviewer works inside VS Code or VSCodium all day, in long sessions, one Change at a time, in a review window Dear Reviewer manages (ADR 0002).
- A Review is one pass over a Change, ending with a verdict submitted to GitHub or a Brief copied for an agent. A Change can have several Reviews as new commits arrive.
- The JetBrains review workflow is the explicit reference: a timeline with checks and avatars, a pull-request files view, Comments in the diff gutter, a pending review submitted with a verdict, and viewed-file tracking kept in sync with github.com.

## Capabilities and Constraints

- Inbox: pull requests awaiting the Reviewer's review or authored by them, across configured repositories, plus local branches ahead of main.
- Changes open as base and head worktrees; Change Files view with viewed tracking.
- The Assistant runs as one long-lived `claude` process per Change with read-only tools (ADR 0004). It summarises a Change on open, explains what changed since the last Review, chats per Change, raises Findings only when asked, and turns the Reviewer's Comments on a local Change into a Brief. It never writes the Reviewer's Comments, never publishes, never runs commands or edits files.
- A Finding is never published; the Reviewer dismisses it or turns it into a Comment.
- Out of scope today: GitLab and other forges, team dashboards, the Assistant drafting Comments, and sending a Brief straight into an agent session. Each release is listed on Open VSX (ADR 0043) and the VS Code Marketplace (ADR 0044).

## Brand Commitments

- The name is Dear Reviewer. The icon is `extension/media/dear-reviewer.svg`.
- The UI follows the active VS Code theme, including light, dark and high-contrast themes, so it looks native to the editor.

## Evidence on Hand

- The spec (GitHub issue #1), ADRs in `docs/adr/`, and research in `docs/research/`.
- The base-nav spike (removed from the tree, still in git history) showed go to definition resolving inside each side's own worktree.
- No users, testimonials, metrics or screenshots exist yet. Do not invent them.

## Product Principles

1. Eliminate the tedium in code review, not the code review. The Assistant is present and visible, but the Reviewer's reading, judgement and Comments are the main flow (issue #17).
2. The Reviewer decides and publishes; the Assistant suggests and explains.
3. Navigation on both sides of the diff comes first. A feature that breaks real code navigation is the wrong feature.
4. Feel native to the editor, and be as fast as it. The Change's code is only ever read in the real editor. Around it, use VS Code's own views where they serve the Reviewer well, and a webview where native UI would hide a feature or make it hard to use. A webview takes the theme's colors and the editor's density, works fully from the keyboard and with a screen reader, and shows and updates as fast as a native view, on a large Change too.

## Accessibility & Inclusion

- Every review action is reachable from the keyboard and the command palette.
- Webviews meet a stated accessibility standard. WCAG 2.2 AA is the working target until the user names another.
- Webviews follow the active VS Code theme, including high-contrast themes.
