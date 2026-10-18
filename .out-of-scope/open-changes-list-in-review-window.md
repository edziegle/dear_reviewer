# A list of the Changes open in the review window

The review window doesn't list its Changes, and we don't plan to add such a list.

## Why this is out of scope

The review window holds one Change, the Active Change (ADR 0040), so there is nothing to list. The Dashboard shows the Active Change from the Reviewer's own window.

The request came from a review window that held six Changes while the Reviewer believed one was open. ADR 0040 fixes that at the cause: opening another Change stops reviewing the Active Change, rather than hiding it behind the new one. A list would have made a state the Reviewer didn't want easier to see.

The pain that first prompted the request was something else. With GitHub unreachable, the window loaded review threads for every open Change in the background, and each failure raised its own error toast, naming pull requests the Reviewer wasn't looking at. That was a problem with background errors, handled in #67.

## Prior requests

- #68: "Show which Changes a review window holds"
