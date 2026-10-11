# pi-harness-filetree

A file tree on the right side of [pi](https://pi.dev), like Claude Code's filetree mod.

- Project files (git-tracked + untracked; ignored files hidden), branch in the header
- Git status colours: modified (yellow), new (green), deleted (red), with `+added -removed` lines
- All colors come from your pi theme and follow `/themes` switches live; folders get whichever theme color stands out most from file text and the git colors
- Live activity: the row of the file pi is reading or writing gets a pulsing background, in the theme's accent color for reads and its warning color for writes, and stays lit for a moment after, so quick reads are visible too. `•` marks files it touched this session. Covers pi's file tools and file paths in `bash` / `powershell` commands (`cat`, `sed -i`, `> file`, `Get-Content`, ...)
- Folders open automatically along changed or touched files; open or close any folder yourself and it stays that way. Closed folders show what changed inside (`?:1 M:2 D:1`)
- Follows the active file; scroll or move in the tree and it stops following until your next message
- Header: project and branch. Footer: what pi is doing now (`● editing src/a.ts`) and change totals

## Install

```bash
pi install git:github.com/deanx3/PI-Harness-filetree
```

Restart pi. The tree shows on terminals at least 120 columns wide. `/filetree` hides or shows it.

## Using it

| Do | Mouse (fullscreen mode) | Keyboard |
|---|---|---|
| Focus the tree (for the keyboard) | | `alt+e` or `/filetree focus` |
| Move | wheel to scroll | `↑` `↓`, `pageUp` `pageDown` |
| Open / close a folder | click it | `→` / `←`, or `enter` |
| Ask about a file (`@path` into the prompt) | double-click it | `enter` |
| Back to the prompt | clicking never moves focus: just type | `esc`, or just start typing |

Mouse needs pi's fullscreen mode, which is the default (`tuiMode` in `/settings`). In regular mode the terminal keeps the mouse for scrollback, so use the keyboard.

Works the same on Linux, macOS and Windows (Windows Terminal, PowerShell, Git Bash): only plain Unicode glyphs, no Nerd Font or emoji, and `alt+e` instead of `ctrl+shift` keys, which need the kitty keyboard protocol. On macOS Terminal.app, `alt` needs "Use Option as Meta key" (Settings → Profiles → Keyboard); `/filetree focus` works everywhere.

## Notes

- File paths in shell commands are matched word by word, not parsed: globs (`src/*.ts`) and `$vars` aren't highlighted. Git status still picks up their changes after each turn.
- The tree is an overlay: it sits on top of the right edge of the chat. Hide it with `/filetree` when you need the full width.
- Don't combine with `pi-sidebar`: both draw on the right edge.

## Test

```bash
npm install && npm test
```
