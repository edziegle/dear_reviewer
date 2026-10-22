# Start the Assistant's `claude` with your own command

The Assistant runs the `claude` command-line program. Many organizations let Claude Code run only inside a sandbox of their own: a container, a virtual machine, a launcher script or a remote host. With the Claude Command setting, you say how `claude` starts. Dear Reviewer learns nothing about your sandbox.

## The setting

Open your user `settings.json` and set `dearReviewer.claudeCommand` to a list of strings:

```json
"dearReviewer.claudeCommand": ["docker", "exec", "-i", "my-box", "claude"]
```

The first item is the program, a path (a leading `~` is expanded) or a name on the PATH, and Dear Reviewer adds its own arguments after the others and runs the command without a shell.

You can also point it at a script of your own:

```json
"dearReviewer.claudeCommand": ["~/bin/claude-in-sandbox"]
```

Leave the list empty to use the first `claude` on your PATH, or else the first one in `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin` or `~/.claude/local`.

Dear Reviewer ignores this setting in a workspace's `.vscode/settings.json` or `.code-workspace` file. A repository you review can't make Dear Reviewer run a program it chose, so set the command in your user `settings.json`.

Dear Reviewer starts every run through the command: `claude auth status`, which checks your login, and each conversation with the Assistant.

## What your command must do

Dear Reviewer talks to `claude` through its standard input and standard output, so your command must not change what passes through them. It must do five things:

- Pass the arguments, standard input and standard output to `claude` unchanged. Write nothing else to standard output, because a banner or a log line breaks the conversation. Write notes for yourself to standard error.
- Run `claude` in the folder your command was started in. Each conversation has a folder of its own, and `--resume` finds a saved session only from that folder.
- Show `claude` Dear Reviewer's global storage folder at the same path your machine uses. That folder holds the conversation folders, the Change's worktrees and the Assistant folders, and `claude` can't read the Change without it. In a container, mount the folder at the same path.
- Let `claude` write its config folder, by default `~/.claude`. `--resume` needs the saved sessions there, and signing in saves credentials there. If the folder is read-only, or new on every run, the Assistant forgets earlier conversations.
- Set any other environment variables in the command itself. Dear Reviewer passes only the variables `claude` needs to find itself, your login and the network, plus `LC_*`, and never `ANTHROPIC_*` or `CLAUDE_CODE_*`. If your command needs more, such as `DOCKER_HOST`, set them in the script.

## An example script

This script runs `claude` in a container that already has your storage folder mounted at the same path:

```sh
#!/bin/sh
# Start claude in the container "my-box", in the folder Dear Reviewer started
# this script in. -i passes standard input through; there is no terminal.
exec docker exec -i -w "$PWD" my-box claude "$@"
```

Make it executable, then set `dearReviewer.claudeCommand` to its path. A command with arguments, such as the `docker exec` list above, works the same way when it needs no extra steps.

## The git tools often don't start

Dear Reviewer gives `claude` a small server that reads the Change's git history. `claude` starts it with VS Code's own program, at its path on your machine. When `claude` runs in a container or on another machine, that path doesn't exist or can't run there, so the server fails.

Everything else still works. The Assistant reads and searches the Change's files, and the summary, the chat and the Findings are unaffected. It can't look up older history, such as which commit added some code, and it says so instead of guessing.

When the git tools don't start, the Assistant's panel shows a line saying so, with a link to this guide. It shows again for each conversation that starts without them.
