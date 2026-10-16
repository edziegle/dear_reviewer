---
status: superseded by ADR-0035
date: 2026-10-15
---

# Run the integration tests on pull requests only, and the release pull request's on macOS

## Context and Problem Statement

CI ran the integration tests on GitHub's macOS runners, since the Reviewer runs Dear Reviewer on macOS. Those runners are scarce: a pull request's test job could wait half an hour for one, while its other jobs, on Linux, started at once. Where should CI run the tests?

## Considered Options

- macOS only
- Linux only
- Linux for pull requests, macOS for pushes to main
- Linux for pull requests, macOS for the release pull request, nothing on pushes to main

## Decision Outcome

Chosen option: "Linux for pull requests, macOS for the release pull request, nothing on pushes to main", because a pull request gets its result without waiting for a macOS runner, and a release still can't merge untested on the Reviewer's platform. A push to main runs no integration tests: its pull request already ran them, and a run after the merge gates nothing. We first tested every push to main on macOS, which ran the slowest tests a second time for each merge. `mise.toml` pins VSCodium for both platforms. On Linux, `extension/test/run.ts` launches VSCodium itself under `xvfb-run`; only macOS needs `extension/test/backgroundCodium.ts` to keep test windows from taking focus.

### Consequences

- Good, because a pull request's tests start as soon as its other jobs do, and the integration tests run once for each change.
- Bad, because a bug that only shows on macOS, such as one in its file events or its `/private` temporary paths, surfaces on the release pull request, not on the pull request that brought it.
- Bad, because the tests must pass on Linux too, which no developer runs locally.
- Bad, because `release-please` leaves its pull request alone when only commits outside the changelog, such as `test:` or `ci:`, land on main, so its macOS run can test an older main; updating its branch before merging tests the current one.
