---
status: accepted
date: 2026-10-14
---

# Keep a local Change's Comments in the extension's storage, and end its Review with a Brief from the Assistant

## Context and Problem Statement

The Reviewer comments on a local Change, such as an agent's branch, as on a pull request (spec #33), but no pull request holds the Comments, and nobody on GitHub reads them. The Review ends when the Assistant turns the Comments into a Brief, which the Reviewer reads, edits and copies to the clipboard for an agent (#35–#37). The next Review then shows what changed since (#38). ADR 0015 left local Changes without a last Review to compare with until Briefs exist. Where are a local Change's Comments kept, what is the Brief, and how does it record the commit it covered?

## Considered Options

- The extension's storage, keyed by the Change's conversation name, behind the same pending-review interface and comment controller as a pull request's, with the Brief written by the Change's Assistant conversation into a Markdown file
- The same storage keyed by the Change id
- Git notes or a file in the Reviewer's clone

## Decision Outcome

Chosen option: the extension's storage, keyed by the conversation name, because that name outlasts the branch's new commits (ADR 0009), so the record of the last Brief is still there when the agent's next commits give the Change a new id. Keying by Change id would lose it at the first new commit. Git notes or a file in the clone would write into the Reviewer's repository, which Dear Reviewer otherwise only reads, apart from adding worktrees.

- A local Change's Comments go through the same pending-review interface as a pull request's, chosen by the Change's source, and show through Dear Reviewer's one comment controller. They are offered on the same lines, those the diff shows with three lines of context, and the Reviewer edits and deletes them as a pull request's pending Comments. They take no replies and aren't resolved, since every one is the Reviewer's own.
- `local-reviews.json` in the extension's storage keeps, for each conversation name, the threads of the Review under way and the head commit the last Brief covered. Each thread keeps its side, path, lines and the commit of that side's file. A thread written on another commit of its side, such as before the branch moved, shows as Outdated, as ADR 0014 shows a pull request's.
- Write Brief asks the Change's Assistant for a Brief, in the Change's own conversation, so the Brief can draw on what the Reviewer and the Assistant already discussed. The prompt gives each Comment with its `path:line` reference, its side and the lines of code under it, and asks for instructions an agent can act on, with `path:line` references at the head commit. The Assistant panel shows only a note that the Brief was written.
- The Brief is written to a Markdown file in the extension's storage, under `briefs/`, and opens in the editor (ADR 0012). Copy Brief, in the editor's title bar, copies the document's text, with any edits not yet saved, to the clipboard.
- Writing the Brief ends the Review: its Comments leave the storage and the gutter, and the Change's head is kept as the last reviewed commit. If the Assistant fails, the Review goes on and its Comments stay.
- The last reviewed commit of a local Change is the one its last Brief covered, while the repository still has that commit. With it, the Inbox marks a local branch with new commits since, Show Changes Since My Last Review works on local Changes, and the Assistant explains what changed since, as ADR 0015 has them for pull requests.
- Closing a local Change keeps its Comments and its last Brief, as it keeps its conversation, because the Reviewer might reopen the branch.

### Consequences

- Good, because the Reviewer comments on a pull request and a local Change the same way, with one set of commands and one comment controller.
- Good, because the agent's next commits on a branch keep the record of the last Brief, so the next Review starts from what changed since.
- Good, because the Brief is an ordinary file in an editor, which the Reviewer can read, edit, save and reopen.
- Bad, because local Comments and Briefs stay on the machine that wrote them, and Briefs and local Reviews stay in the extension's storage until the Reviewer clears it, since a local Change never ends on its own (ADR 0013).
- Bad, because a Brief uses a Claude turn in the Change's conversation, and a long conversation makes that turn larger.
- Bad, because a Brief's Comments leave the gutter, so the next Review shows what the Reviewer said only in the Brief file.
- Bad, because a range that isn't a branch has a conversation name made of its commits, so its next Review at a new head is a new Change with no last Brief.
