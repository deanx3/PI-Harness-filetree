# pi-harness-filetree

A file tree on the right side of [pi](https://pi.dev), like Claude Code's filetree mod.

- Project files (git-tracked + untracked; ignored files hidden), branch in the header
- Git status colours: modified (yellow), new (green), deleted (red), with `+added -removed` lines
- Live activity: `●` on the file pi is reading (accent) or editing (orange) right now, `·` on files it touched this session
- Folders open automatically along changed or touched files; everything else stays collapsed
- Keeps the active file in view when the tree is taller than the terminal
- Header: project and branch. Footer: what pi is doing now (`● editing src/a.ts`) and change totals

## Install

```bash
pi install git:github.com/deanx3/PI-Harness-filetree
```

Restart pi. The tree shows on terminals at least 120 columns wide. `/filetree` hides or shows it.

## Notes

- Files touched by `bash` commands aren't highlighted (only `read`, `grep`, `find`, `ls`, `edit`, `write`); git status still picks up their changes after each turn.
- The tree is an overlay: it sits on top of the right edge of the chat. Hide it with `/filetree` when you need the full width.
- Don't combine with `pi-sidebar`: both draw on the right edge.

## Test

```bash
npm install && npm test
```
