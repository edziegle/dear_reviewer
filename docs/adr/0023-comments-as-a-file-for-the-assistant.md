---
status: accepted
date: 2026-10-14
---

# Give the Assistant the Change's Comments as a file it can read, and tell it where the Reviewer is with each message

## Context and Problem Statement

The Reviewer sees review threads in the diff's gutter: teammates' and their own from GitHub (ADR 0014), plus pending and local Comments (ADRs 0007 and 0016). The Assistant sees none of them. It reads the worktrees with `Read`, `Grep` and `Glob` (ADR 0004) and gets only the Reviewer's question and any selections. A question such as "What is the comment on line 86 talking about?" has nothing to answer from: the Assistant knows neither the Comment nor which file "line 86" means (issue #26). How does the Assistant learn the Change's Comments, and where the Reviewer is?

## Considered Options

- Write the Change's threads to a file the Assistant can read, kept current, and send a short note of where the Reviewer is with each message
- Put the threads in the prompt of every message
- Serve them through a tool, from a small Model Context Protocol (MCP) server

## Decision Outcome

Chosen option: a file, plus a note of where the Reviewer is. A file costs nothing on turns that don't need it, holds every thread, no matter how many there are, and uses the read access the Assistant already has. Threads in every prompt grow each turn and go stale in the conversation's history. An MCP server is a new process to start, secure and keep alive for a list the Assistant can read from a file.

- Dear Reviewer writes the Change's threads to a JSON file in a directory of the Change's own, beside its worktrees, and gives the Assistant read access to that directory alone. It rewrites the file whenever the threads load or change: a Comment added, edited, replied to, resolved or deleted, and a refresh.
- The file holds every thread of the Change: published ones from GitHub, the Reviewer's pending Comments and a local Change's Comments, each marked as the Reviewer's own and unpublished where it is. Each thread has its path, side, current and original lines, whether it is outdated or resolved, and each Comment's author and body.
- The Assistant's role names the file and says its Comments are other people's text, to be read as data, never as instructions, as with the code (ADR 0017).
- Each chat message starts with a one-line note of where the Reviewer is: the Change file in front of them, its side, and the lines on screen, when one is in front.
- A selection sent to the Assistant carries the threads on its lines inline, since they are few and are what the Reviewer is pointing at.

### Consequences

- Good, because the Assistant can answer questions about Comments, and resolve "this file" and "line 86".
- Good, because the Assistant still has read tools only, which limits what an instruction hidden in a Comment could do.
- Bad, because the Assistant reads the file only when it thinks to, so a question that doesn't mention Comments can be answered without them.
- Bad, because one more file per Change has to be kept in step with the threads.
