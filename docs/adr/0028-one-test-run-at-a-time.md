---
status: accepted
date: 2026-10-14
---

# Run one integration test run at a time on a machine

## Context and Problem Statement

Agents work on issues side by side in worktrees, and each runs the integration tests, which launch VSCodium. With more than one run at once, VSCodium's file watcher crashed once and the assistant suite timed out with 10 failures that passed when run alone. Can runs from different worktrees share a machine safely?

Each worktree's run already keeps its own VSCodium user data and extensions folders, its own fixtures, and a fake GitHub on a port the system picks. What runs still share is the machine: its CPU, the file events macOS sends, and the System Events script that keeps test windows in the background. The timeouts and the watcher crash came from that load, not from runs touching each other's files.

## Considered Options

- Let runs overlap, and raise the timeouts
- Let runs overlap, up to a fixed number
- One run at a time, behind a lock file

## Decision Outcome

Chosen option: "One run at a time, behind a lock file", because overlapping runs fail through load, which no isolation removes, and a longer timeout only hides a slow test. `extension/test/run.ts` takes `dear-reviewer-test-run.lock` in the temporary folder before it starts VSCodium, and a later run prints whose run it waits for. The lock holds the run's process ID, so a run that died without releasing it doesn't block the next.

### Consequences

- Good, because a failure is the code's, not another worktree's load.
- Bad, because agents wait for each other's runs; narrowing a run to the suites, files or tests at hand keeps the wait short.
- Note (ADR 0039): a run now makes about half the launches, so the wait for the lock is shorter than when this was decided.
