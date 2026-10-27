---
status: accepted
date: 2026-10-27
---

# Give Dependency updates facts from rules, a Recommendation on request, and a Dashboard list of their own

## Context and Problem Statement

Dependabot opens many small pull requests, and a Reviewer gets the same review for each of them as for a person's pull request (issue #219). They fill Waiting on you, and each one asks for a close reading that a patch update of a development dependency rarely needs. The Reviewer wants a quick read on whether to approve or close one, and wants them out of the way of the pull requests that people are waiting on.

Two earlier decisions stand in the way. The Assistant never reviews or decides, and a mark that tells the Reviewer they can look less closely comes from rules, never from the Assistant (ADR 0045), because a Change's text can steer the Assistant (ADR 0042). A Dependabot pull request's description is release notes from upstream, which anyone who publishes the package writes. And Waiting on you stays in one order, longest wait first, so its first row is the Dashboard's next step (`.out-of-scope/sort-or-bulk-ignore-waiting-on-you.md`). How does Dear Reviewer handle these pull requests without breaking either?

## Considered Options

- Facts from rules only, with no word from the Assistant
- An Assistant verdict, given on request, with nothing to check it against
- Facts from rules in the overview, a Recommendation from the Assistant on request beside them, and a Dashboard list of their own
- No help on a single pull request, and only a different order or grouping in Waiting on you

## Decision Outcome

Chosen option: facts from rules, a Recommendation on request beside them, and a list of their own. The facts can't be steered, so a steered Recommendation shows up against them. The list keeps the Next Step Rule, because no list changes its order.

- **What a Dependency update is.** A pull request that `dependabot[bot]` opened and that requests the Reviewer's review, personally or through a Team request. GitHub sets the author, and nobody can open a pull request as that bot. Other dependency bots, such as Renovate, aren't recognised: Renovate keeps its metadata in the editable description, and when self-hosted it runs under any account name.
- **Facts from rules.** A Dependency update's overview always shows these, with no Assistant:
  - Each updated dependency, with its versions, its update type (patch, minor or major), and whether it is direct or indirect, for production or for development. These are read from the `updated-dependencies:` block of commits that `dependabot[bot]` authored and GitHub verified. Anyone who can push to the branch can write a commit message, so other commits are not read. A grouped update lists each dependency, and the pull request's update type is the largest. Where the block has no update type, it comes from the versions the commit names. Where neither gives one, the facts say it is unknown.
  - Whether only manifest and lock files changed, over every commit, whoever made it.
  - Commits that anyone other than `dependabot[bot]` authored, with their authors.
  - The check status.
- **The Recommendation.** **Ask for a Recommendation**, in the overview and the command palette, runs only when the Reviewer asks, as Ask for Findings does (ADR 0017). It asks in the Change's conversation, with the pull request's text fenced as data (ADR 0042, rule 1). Dear Reviewer reads the reply strictly: one of approve, close or read it closely, with reasons, or nothing is kept. Read it closely is there so that the Assistant doesn't have to guess on a major update or one it can't judge. The Recommendation shows under the facts, and belongs to the head it was given for. When the head moves, it shows as out of date.
- **No action follows from it.** Finish review preselects nothing, and Dear Reviewer doesn't close pull requests. A steered approve stays one more thing to read, never a click away from GitHub.
- **A list of their own.** The Dashboard lists Dependency updates under Waiting on you, longest wait first, with their own count and each row's update type. They leave Waiting on you and its count. The next step goes to one only when Waiting on you is empty. Ignore and Restore work on them as on Waiting on you.

The Glossary's Assistant entry changes to allow this one opinion: it gives a Recommendation on a Dependency update, and still never reviews, decides or publishes.

### Consequences

- Good, because a Reviewer can tell a patch update that touches only a lock file from a major update with a commit in `src/` that Dependabot didn't make, without asking anything.
- Good, because nothing in a pull request's text can change the facts, and a commit message forged by someone else is not read.
- Good, because Waiting on you holds only the pull requests people are waiting on, in the order the Next Step Rule needs.
- Bad, because the Recommendation is the Assistant's opinion of a whole pull request, the first one Dear Reviewer offers. A steered one says approve, and only the facts beside it and the Reviewer's reading stand against it.
- Bad, because a repository that routes Dependabot to nobody keeps its Dependency updates off the Dashboard.
- Bad, because pull requests from Renovate still get the full review in Waiting on you.
- Bad, because Dependabot's commit format is its own, and a change to it leaves facts unknown until Dear Reviewer follows it.
