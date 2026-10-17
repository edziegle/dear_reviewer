---
status: accepted
date: 2026-10-16
---

# Refresh a pull request's Change when the window regains focus

Amends [ADR 0013](0013-end-changes-that-are-over.md): focus is one more moment the window catches up with GitHub.

## Context and Problem Statement

A Reviewer who comes back to a review after the pull request moved on GitHub saw none of it. New commits, new review threads and a changed state showed only after the Reviewer pressed Refresh, or closed the Change and opened the pull request again. A Reviewer who didn't know to do that reviewed an out-of-date Change without being told. When does Dear Reviewer check an open pull request against GitHub, and what does it do with what it finds?

## Considered Options

- Check on a timer
- Check when the window regains focus, and when asked with Fetch Updates
- Leave it to the Reviewer: show a "pull request has changed" note and let them refresh

## Decision Outcome

Chosen option: check when the window regains focus, and when asked with Fetch Updates. Regaining focus is the moment of coming back to a review, so it is when the Reviewer wants the Change to be current. ADR 0013 chose events over a timer so that idle windows don't query GitHub all day, and that holds here: a window nobody looks at sends nothing. Showing a note instead of updating would make the Reviewer do by hand what Dear Reviewer can do for them.

- When the window regains focus, Dear Reviewer asks GitHub, for each pull request Change the window shows, for its state and head commit: one request. The setting `dearReviewer.autoRefreshChanges`, on by default, turns this off. A failed check says nothing and leaves the Change as it was.
- A Change at the same head loads its review threads again, so new threads and new replies show. This is skipped while a Comment is being written, since loading again would lose it.
- A new head swaps the Change in place, as opening the pull request again does (ADR 0020): the older head's Change closes, and the new one opens with its overview. The file the Reviewer was on opens again. The overview says which commits arrived, and the "new commits since your Review" state shows as it does for any new head.
- A pull request that is no longer open is left to ADR 0013's tidying, which closes its Change.
- Checks for one Change never overlap, and an automatic check within five seconds of the last is skipped, so a burst of focus changes sends one request. An automatic check turned away because one is running is remembered, once no matter how many were, and runs when the running one ends, so threads that arrived meanwhile aren't missed until the next focus. The five-second rule doesn't apply to it: it exists to catch what arrived while the check ran, even if that ended soon, and a burst still owes only one.
- Fetch Updates, in the Change Files title bar and the palette, does the same when asked, with the setting on or off. It says what it found, such as "1 new commit", and says when it couldn't ask GitHub. It skips only the overlap rule.
- Pending Comments live in the Reviewer's pending review on GitHub, so a swap doesn't touch them. They are loaded again for the new head. One on a line the new commits removed or moved is placed where GitHub places it: on the moved line, or, when the line is gone, as an outdated thread.
- Viewed state for a pull request lives on GitHub, which shows a file as unviewed once a later commit changes it. A file the new commits didn't touch stays viewed. Dear Reviewer adds nothing of its own.

### Consequences

- Good, because a Reviewer who comes back to a review sees the pull request as it is now, without knowing to refresh.
- Good, because an idle window sends no requests, and a failed check costs the Reviewer nothing.
- Bad, because each focus change on a window that shows pull request Changes sends one request per Change, at most once every five seconds.
- Bad, because the swap closes the older head's Change, so anything the Reviewer did in its worktrees is gone, and the Assistant carries on the pull request's conversation (ADR 0009) with a head it summarized earlier.
- Bad, because a pull request that changes on GitHub while the window stays focused is not noticed until focus returns or the Reviewer runs Fetch Updates.
