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
The AI that helps the Reviewer: it summarises, answers questions, raises Findings, writes Briefs and adds Agent notes. It never reviews, decides or publishes.
_Avoid_: AI reviewer, bot, copilot

**Comment**:
Something the Reviewer writes about a Change, meant to be published to GitHub or included in a Brief.
_Avoid_: Note, remark

**Agent note**:
The Assistant's short addition, written when the Reviewer asks for it, under their own text in a Comment on a pull request, for an agent that will act on it: the reason behind the Comment and what to do instead. Part of the Comment, published with it once the Reviewer has read it. The Assistant writes none when the Comment already says it all or it can't tell the reason.
_Avoid_: Brief (that's a whole local Review), note on its own, AI comment

**Finding**:
A spot in a Change the Assistant thinks deserves attention. It is never published as it stands; the Reviewer dismisses it or turns it into a Comment.
_Avoid_: AI comment, flag, suggestion (GitHub uses that for proposed code edits)

**Duplicate code**:
Code a Change adds that repeats a block found elsewhere in the Change or the repository, instead of reusing it. Dear Reviewer finds possible duplicate code by rules, and the Assistant judges which is real and raises it as a Finding.
_Avoid_: Copy-paste, clone, pattern (vague, and it blurs into Repeated edit)

**Repeated edit**:
The same change made at three or more sites in a Change, such as one call renamed everywhere it's used. Dear Reviewer finds it by rules and names its **differing sites**, where the change differs from the rest, and its **missed sites**, where the old code survives.
_Avoid_: Duplicate code (a clean sweep is not a smell), sweep, pattern

**Change**:
The code under review: the difference between two points in a repository's history. A GitHub pull request is one source of a Change; a local range of commits is another. Its conversation with the Assistant lasts until its pull request or branch is over, through any number of Reviews and stops.
_Avoid_: Diff (that's the rendering), Change Set, Review Target, PR (only one source)

**Active Change**:
The one Change the review window holds, from opening it until the Reviewer stops reviewing it, opens another, or its pull request or branch is over. Change Files, Findings, the Assistant and the review keys follow it. It stays active while the review window is closed, and the Dashboard shows it.
_Avoid_: Change in front, open Change, Change in progress

**Stop Reviewing**:
Removing a Change from Dear Reviewer: its worktrees and folders go, and the review window closes if it was the last Change. Nothing changes on GitHub, and the pull request stays under Reviewed by you in the Dashboard. After a submitted Review or a copied Brief, the result block calls it Back to Dashboard.
_Avoid_: Close Change (it suggests closing the pull request on GitHub)

**Reading Order**:
The order the Assistant suggests for reading a Change's files, in a few labeled steps, starting where its summary says to start. Its first step is the core of the change: the few files, at most five, that carry the Change's intent. The skim-only files come last, apart from the Assistant's steps. A suggestion the Reviewer can follow or set aside for tree order.
_Avoid_: File order, review plan, story

**Skim-only file**:
A changed file that Dear Reviewer itself judges needs no close reading: a lock file, a file the base marks as generated, a rename with no edits, or a file, moved or not, whose change is formatting only. The Assistant can't make a file skim-only.
_Avoid_: Ignored file, hidden file, trivial file

**Code Flow**:
A picture of how the code a Change touches calls and is called by the code around it, drawn from the language server's call hierarchy: the changed symbols and their neighbours a hop or two out, each marked changed, new, removed (a function of a deleted file, drawn as the base worktree had it) or unchanged. Shown as a call map, as a trace down swimlanes, or as a list for a screen reader. Symbols of test files are left out unless the Reviewer shows them, and the view says how many it left out. Where no language server answers, there is no Code Flow, and the view says so; where the server knows the symbols but gives no calls, because it has no call hierarchy, the view says that instead of drawing calls, and where it timed out it offers Try again.
_Avoid_: Diagram, call graph (that's the whole codebase; a Code Flow is scoped to a Change), data flow (a Code Flow shows calls, not where a value ends up)

**Code Flow walkthrough**:
The Assistant's account of how a Change's code runs, in order, as a numbered outline in the Code Flow tab: the function a run starts in, then the functions it calls, each with its file, what it takes and gives, and a note when the Change altered or added it. A call made only on some runs sits under its caller with the condition. It is built from the Code Flow's real calls: a step names a symbol and a call that the language server gave, and nothing else. The Assistant also supplies the data that crosses each call, such as "verdict, body", which the call map and swimlanes show on the call. A suggestion, as the Reading Order is: the Reviewer reads it or ignores it, and the Assistant draws and edits nothing. It starts when the Reviewer opens the Walkthrough view, and is not offered where the Code Flow has no calls.
_Avoid_: Tour, trace (the swimlanes trace a run by the language server's calls; the walkthrough is the Assistant's account of them), data flow

**Inbox**:
The list of Changes waiting for the Reviewer: open pull requests that await their review, that they authored or reviewed, or whose Team request a teammate's review answered. It spans the repositories they have open in VSCodium, have opened before, or listed, plus local branches ahead of main. The Dashboard shows it.
_Avoid_: Queue

**Ignored**:
A pull request awaiting the Reviewer's review that they have set aside, so it stops asking for their attention. It leaves Waiting on you and its count, and is kept in a collapsed list under it until they restore it. Only on their machine: GitHub isn't told, and the review request stays there.
_Avoid_: Dismissed, hidden, snoozed

**Team request**:
A request on a pull request for a review from a team the Reviewer is on, directly or through a child team, rather than from the Reviewer personally. Any one member's review answers it for the whole team.
_Avoid_: Group request, indirect request

**Dashboard**:
The Dear Reviewer side bar in the Reviewer's own windows, outside the review window: where they stand across their Changes, the one next step, the Active Change, and the Inbox. Its title in the side bar reads Dear Reviewer: Dashboard.
_Avoid_: Home, start page, landing page

**Brief**:
The Reviewer's comments on a local Change, packaged as instructions for an agent to act on. The local counterpart of posting a review to GitHub.
_Avoid_: Fix-up prompt, task list

**Agent note**:
A short paragraph the Assistant writes under the Reviewer's own text in a pending pull request Comment, when the Reviewer asks, for the agent that will act on the Comment: the reason behind it and what to do instead. It starts with the label `**For agents:**`, which Dear Reviewer writes. It is the Reviewer's to read, edit or remove before the Comment is saved, and it is not a Brief, which covers a whole local Review.
_Avoid_: Brief (that is a whole local Review), AI comment
