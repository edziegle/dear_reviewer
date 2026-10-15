---
status: accepted
date: 2026-10-15
---

# Run pull requests' integration tests on Linux, and main's on macOS

## Context and Problem Statement

CI ran the integration tests on GitHub's macOS runners, since the Reviewer runs Dear Reviewer on macOS. Those runners are scarce: a pull request's test job could wait half an hour for one, while its other jobs, on Linux, started at once. Where should CI run the tests?

## Considered Options

- macOS only
- Linux only
- Linux for pull requests, macOS for pushes to main

## Decision Outcome

Chosen option: "Linux for pull requests, macOS for pushes to main", because a pull request gets its result without waiting for a macOS runner. Every commit on main still runs on the Reviewer's platform, so a release never ships untested there. `mise.toml` pins VSCodium for both platforms. On Linux, `extension/test/run.ts` launches VSCodium itself under `xvfb-run`; only macOS needs `extension/test/backgroundCodium.ts` to keep test windows from taking focus.

### Consequences

- Good, because a pull request's tests start as soon as its other jobs do.
- Bad, because a bug that only shows on macOS, such as one in its file events or its `/private` temporary paths, surfaces on main after the merge, not on the pull request.
- Bad, because the tests must pass on Linux too, which no developer runs locally.
