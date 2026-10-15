---
status: accepted
date: 2026-10-13
---

# Write ADRs in the MADR format

## Context and Problem Statement

ADRs 0001 and 0002 use a house format: a paragraph that gives the context, the decision and the reason, followed by optional Considered Options and Consequences sections. Nothing in that format says whether a decision still holds or when it was made, and a rejected option gets one line of explanation, so the reasons for and against each option are often omitted. Which format should new ADRs use?

## Considered Options

- Keep the house format
- MADR (Markdown Architectural Decision Records), version 4
- Michael Nygard's format: Title, Status, Context, Decision, Consequences

## Decision Outcome

Chosen option: MADR, because it is a published, widely used format that readers and agents already know, it records status and date in front matter, it lays out the pros and cons of each option, and its minimal template stays short.

New ADRs use the minimal MADR template, plus `status` and `date` front matter. The full template, with decision drivers, pros and cons for each option, and confirmation, is kept for the largest decisions, where that detail is worth the extra length. ADRs 0001 and 0002 stay in the house format.

### Consequences

- Good, because a reader who knows MADR can find the context, the options and the outcome in any new ADR without learning a house layout.
- Good, because a reader can see from the front matter whether a decision still holds and when it was made.
- Bad, because `docs/adr/` now holds two formats, and anyone reading 0001 or 0002 has to recognize the older one.
- Bad, because a minimal MADR ADR is longer than the one-paragraph ADRs the house format allows.
- Bad, because agent skills that write ADRs in another format, such as `domain-modeling`, need a pointer to this ADR, or they will keep using their own format.
