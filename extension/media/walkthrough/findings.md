# Findings

A Finding is a spot the Assistant thinks deserves your attention: a bug, a missed edge case, a security problem or code that misleads. The Assistant raises Findings only when you choose **Ask for Findings**, and at most twenty, the most important first.

Each Finding marks its lines in the gutter of the diff: the Assistant's reading cat on its first line, and a bar down its lines. It is also listed in the **Findings** view, under **Change Files**.

Hover a Finding's lines to read it, then choose **Convert to Comment** to make it your own, or **Dismiss**. Both are in Quick Fix too, as **Finding: Convert to Comment** and **Finding: Dismiss**: put the cursor on the Finding's lines and press Ctrl+. (⌘. on a Mac). A Finding is never published: only Comments are.

| Key                | Command          |
| ------------------ | ---------------- |
| Ctrl+Alt+R I       | Ask for Findings |
| Ctrl+Alt+R F       | Next Finding     |
| Ctrl+Alt+R Shift+F | Previous Finding |

On a Mac, press ⌃⌥R in place of Ctrl+Alt+R.
