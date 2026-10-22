# Start the Assistant's `claude` with your own command

The Assistant runs the `claude` command-line program. Many organizations let Claude Code run only inside a sandbox of their own: a container, a virtual machine, a launcher script or a remote host. The Claude Command setting lets you say how `claude` starts. Dear Reviewer learns nothing about your sandbox.

## The setting

Open your user `settings.json` and set `dearReviewer.claudeCommand` to a list of strings:

```json
"dearReviewer.claudeCommand": ["docker", "exec", "-i", "my-box", "claude"]
```

The first item is the program: a path, where a leading `~` is expanded, or a bare name that Dear Reviewer looks up on the PATH. The other items are arguments. Dear Reviewer adds its own arguments after yours and starts the command without a shell, so nothing needs quoting.

You can also point it at a script of your own:

```json
"dearReviewer.claudeCommand": ["~/bin/claude-in-sandbox"]
```

Leave the list empty to use the `claude` on your PATH or in a usual install location.

Only your user settings count. A workspace can't choose what runs.

Claude Path, the older setting, still works. While Claude Command is empty, Claude Path is used as a command of one item. It is deprecated, so use Claude Command instead.

Dear Reviewer starts every run through the command: `claude auth status`, which checks your login, and each conversation with the Assistant.

## What your command must do

Dear Reviewer talks to `claude` through its standard input and output, so your command has to stay out of the way.

- **Pass everything through.** Pass the arguments, standard input and standard output through to `claude` unchanged. Write nothing else to standard output: a banner or a log line breaks the conversation. Write notes for yourself to standard error.
- **Keep the folder.** Run `claude` in the folder your command was started in. Each conversation has a folder of its own, and `--resume` finds a saved session only from the same folder.
- **Share the storage folder.** Dear Reviewer keeps the conversation folders, the Change's worktrees and the Assistant folders in its global storage folder. `claude` must see that folder at the same path as your machine does, or it can't read the Change. In a container, mount it at the same path.
- **Let `claude` write its config folder.** `--resume` needs the saved sessions, and signing in needs to save credentials. Both live in `claude`'s config folder, by default `~/.claude`. If it is read-only, or new on every run, the Assistant forgets earlier conversations.
- **Set your own environment variables.** Dear Reviewer passes your command only a short list of variables: those `claude` needs to find itself, your login and the network, plus `LC_*`. It never passes `ANTHROPIC_*` or `CLAUDE_CODE_*`. If your command needs more, such as `DOCKER_HOST`, set them in the script.

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
