---
status: accepted
date: 2026-10-16
---

# Run the integration tests on Linux only

## Context and Problem Statement

ADR 0029 ran the release pull request's integration tests on macOS, so a release couldn't merge untested on the Reviewer's platform. Over the releases from 0.1.1 to 0.3.0, that job failed six times. None showed a bug that only macOS has: they were test races, a step that failed before any test ran, and a stall in the `assistant` suite, where nine tests each waited out a 120-second timeout and the job ran for 28 minutes. The same suite passes in under a minute on a developer's Mac. Should the release pull request keep a macOS run?

## Considered Options

- Linux for pull requests, macOS for the release pull request
- Linux only

## Decision Outcome

Chosen option: "Linux only", because the macOS run has caught no macOS-only bug, and it has cost slow, flaky releases. The integration job also gets a 15-minute timeout, since a run takes about 6 minutes, so a stalled run fails fast.

### Consequences

- Good, because a release pull request's tests run as fast and as reliably as any other pull request's.
- Bad, because a bug that only shows on macOS, such as one in its file events or its `/private` temporary paths, reaches a release unseen. The Reviewer finds it by using the extension, and `mise run test-integration` runs on macOS locally.
