# Dear Reviewer

A workbench for a person reviewing a code change, with AI help woven through the review without taking it over.

## Language

**Reviewer**:
The human examining a change and deciding what to say about it. Always a person, never the AI.
_Avoid_: User (too broad), AI reviewer

**Review**:
One pass by a Reviewer over a Change, ending when they submit a verdict or copy a Brief for an agent. A Change can have more than one Review as new commits arrive.
_Avoid_: Code review session, audit, round

**Assistant**:
The AI that helps the Reviewer: it summarises, answers questions, raises Findings and writes Briefs. It never reviews, decides or publishes.
_Avoid_: AI reviewer, bot, copilot

**Comment**:
Something the Reviewer writes about a Change, meant to be published to GitHub or included in a Brief.
_Avoid_: Note, remark

**Finding**:
A spot in a Change the Assistant thinks deserves attention. It is never published as it stands; the Reviewer dismisses it or turns it into a Comment.
_Avoid_: AI comment, flag, suggestion (GitHub uses that for proposed code edits)

**Change**:
The code under review: the difference between two points in a repository's history. A GitHub pull request is one source of a Change; a local range of commits is another. A Change stays open across Reviews until it is merged or closed, and its conversation with the Assistant lasts while the Change does.
_Avoid_: Diff (that's the rendering), Change Set, Review Target, PR (only one source)

**Change in front**:
The open Change the Reviewer opened or came back to last, which a window's side bar shows: Change Files, Findings and the review keys follow it. The other open Changes wait behind it, as the Reviewer left them, until the Reviewer shows one again.
_Avoid_: Active Change, current Change

**Reading Order**:
The order the Assistant suggests for reading a Change's files, in a few labeled steps, starting where its summary says to start. A suggestion the Reviewer can follow or set aside for tree order.
_Avoid_: File order, review plan, story

**Inbox**:
The list of Changes waiting for the Reviewer: open pull requests that await their review or that they authored or reviewed, across the repositories they have open in VSCodium, have opened before, or listed, plus local branches ahead of main. The Dashboard shows it.
_Avoid_: Queue

**Team request**:
A request on a pull request for a review from a team the Reviewer is on, rather than from the Reviewer personally. Any one member's review answers it for the whole team.
_Avoid_: Group request, indirect request

**Dashboard**:
The Dear Reviewer side bar in the Reviewer's own windows, outside the review window: where they stand across their Changes, the one next step, the Changes in progress, and the Inbox. Its title in the side bar reads Dear Reviewer: Dashboard.
_Avoid_: Home, start page, landing page

**Brief**:
The Reviewer's comments on a local Change, packaged as instructions for an agent to act on. The local counterpart of posting a review to GitHub.
_Avoid_: Fix-up prompt, task list
