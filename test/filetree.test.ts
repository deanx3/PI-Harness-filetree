import assert from "node:assert";
import { act, bashFiles, newState, render, view, type State } from "../extensions/filetree.ts";
const theme: any = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => `[${t}]`, bold: (t: string) => t };
const s: State = {
  ...newState(),
  files: ["README.md", "src/a.ts", "src/deep/b.ts", "docs/x.md"],
  git: new Map([["src/a.ts", "M"], ["new.ts", "??"]]),
  delta: new Map([["src/a.ts", "+3 -1"]]),
  project: "demo", branch: "main", touched: new Map([["src/deep/b.ts", "read"]]),
  active: new Map([["src/a.ts", "write"]]),
};
const W = 40;
const out = render(s, theme, W, 20);
console.log(out.join("\n"));
assert.equal(out.length, 20, "fills the full height");
assert(out.every((l) => l.length === W && l.startsWith("│ ")), "every row is exactly the panel width with a left edge");
assert(out[0].includes("demo") && out[0].includes("· main"), "header: project + branch");
assert(out.some((l) => l.includes("▸ docs/")), "untouched folder stays closed");
assert(out.some((l) => l.includes("▾ src/")) && out.some((l) => l.includes("▾ deep/")), "folders open along touched paths");
assert(out.some((l) => /● a\.ts\s+\+3 -1$/.test(l)), "active file + delta");
assert(!out.some((l) => l.includes("x.md")), "closed folder hides files");
assert(out.at(-2)!.includes("● editing src/a.ts"), "footer: current activity");
assert(out.at(-1)!.includes("2 changed  +3 -1"), "footer: totals");
assert(out.some((l) => l.includes("├ ▾ deep/")) && out.some((l) => l.includes("│ └ • b.ts")) && out.some((l) => l.includes("└ ● a.ts")), "tree guides");
// user folding: open a closed folder, close an auto-opened one, keyboard moves, clicks map to rows
const f: State = { ...newState(), files: ["README.md", "src/a.ts", "docs/x.md", "docs/y.md"], git: new Map([["docs/y.md", "M"]]) };
let v = view(f, theme, W, 20);
assert(v.lines.some((l) => l.includes("y.md")) && v.lines.some((l) => l.includes("x.md")), "docs auto-opens along changes");
assert(!v.lines.some((l) => l.includes("a.ts")), "src stays closed");
f.sel = "src";
act(f, v, "enter");
v = view(f, theme, W, 20);
assert(v.lines.some((l) => l.includes("a.ts")), "enter opens a folder");
f.sel = "docs";
act(f, v, "left");
v = view(f, theme, W, 20);
assert(!v.lines.some((l) => l.includes("y.md")), "left closes an auto-opened folder");
assert(v.lines.some((l) => /▸ docs\/\s+M:1/.test(l)), "closed folder shows its changes");
assert(v.lines.some((l) => l.includes("[▸ docs/")), "selected row highlighted");
act(f, v, "down");
assert.equal(f.sel, "src");
act(f, v, "right"); act(f, v, "right");
assert.equal(f.sel, "src/a.ts", "right steps into an open folder");
assert.equal(act(f, v, "enter"), "src/a.ts", "enter on a file mentions it");
act(f, v, "left");
assert.equal(f.sel, "src", "left goes to the parent");
const y = v.slots.findIndex((r) => r !== undefined && typeof r === "object" && r.path === "README.md");
assert(v.lines[y].includes("README.md"), "click slot lines up with its row");
// overflow keeps active file visible
s.files = Array.from({ length: 200 }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`).concat("src/a.ts");
const small = render(s, theme, W, 14);
assert.equal(small.length, 14);
assert(small.some((l) => l.includes("● a.ts")), "active visible when clipped");
// outside git
const plain = render({ ...s, files: ["notes/"], git: new Map(), delta: new Map(), branch: "", active: new Map(), touched: new Map() }, theme, W, 8);
assert(plain.at(-1)!.includes("not a git repo") && plain.some((l) => l.includes("▸ notes/")));
// bash commands map to files
const known = new Set(["README.md", "src/a.ts", "src/deep/b.ts"]);
const b = (cmd: string) => Object.fromEntries(bashFiles(cmd, "/p", known));
assert.deepEqual(b("cat README.md src/a.ts | head -5"), { "README.md": "read", "src/a.ts": "read" });
assert.deepEqual(b("cd src && sed -n '1,40p' deep/b.ts 2>/dev/null"), { "src/deep/b.ts": "read" });
assert.deepEqual(b("sed -i 's/x/y/' /p/src/a.ts"), { "src/a.ts": "write" });
assert.deepEqual(b('echo hi > notes.txt; grep -i foo README.md'), { "notes.txt": "write", "README.md": "read" });
assert.deepEqual(b("ls -la && git status && cat ../other/README.md"), {});
assert.deepEqual(b("Set-Location src; Get-Content deep/b.ts; Set-Content a.ts 'x'"), { "src/deep/b.ts": "read", "src/a.ts": "write" });
console.log("---\n" + small.join("\n") + "\nOK");
