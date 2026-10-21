# A severity for each Comment

Dear Reviewer doesn't offer a severity, such as nit, optional or blocking, for a Comment, and we don't plan to add one. A Reviewer who wants one types it at the start of the Comment, as in `nit: rename this`.

## Why this is out of scope

A typed prefix already gets everywhere a built-in severity would:

- On a pull request, the Comment goes to GitHub as written, so the author sees `nit:` just as a picker would have put it there. GitHub has no severity of its own, so a picker could only write the same text.
- In a Brief, the prompt gives the Assistant each Comment's text word for word and tells it to keep the Reviewer's intent, so the agent gets the severity too.
- In the Submit step, the list of pending Comments shows each one's first line, so the Reviewer can see which are `blocking:` before they submit.

That leaves little for a built-in severity to add. A picker saves typing a few characters, but it puts one more control on every Comment, even for Reviewers who never use one. Its labels would also be a convention of Dear Reviewer's, pushed on teams that already use their own labels or none. A count of each severity in the Submit step would repeat what its list of Comments shows. A blocking Comment that chose the verdict would break the Submit step's rule that no verdict is chosen until the Reviewer chooses one (ADR 0033).

If a Brief ever treats a `nit:` Comment as one the agent must act on, that's a bug in the Brief's prompt, and the fix is to ask the Assistant to keep each Comment's stated severity.

## Prior requests

- #116: "Let the Reviewer label a Comment's severity (nit, optional, blocking)"
