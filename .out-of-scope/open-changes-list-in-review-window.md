# A list of the Changes open in the review window

The review window doesn't list the Changes it still has open behind the one in front, and we don't plan to add such a list.

## Why this is out of scope

The review window shows one Change at a time (ADR 0020, ADR 0032). The other open Changes wait behind it, and the Dashboard's In progress section already lists them from the Reviewer's own window. A second list in the review window would repeat that one to fix a problem the Reviewer didn't have: nobody was bothered that Changes stay open.

The pain that prompted the request was something else. With GitHub unreachable, the window loaded review threads for every open Change in the background, and each failure raised its own error toast, naming pull requests the Reviewer wasn't looking at. That is a problem with background errors, not with open Changes being invisible, and it is handled in #67.

## Prior requests

- #68: "Show which Changes a review window holds"
