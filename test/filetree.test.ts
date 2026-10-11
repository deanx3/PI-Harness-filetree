import assert from "node:assert";
import { render, type State } from "../extensions/filetree.ts";
const theme: any = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const s: State = {
  files: ["README.md", "src/a.ts", "src/deep/b.ts", "docs/x.md"],
  git: new Map([["src/a.ts", "M"], ["new.ts", "??"]]),
  delta: new Map([["src/a.ts", "+3 -1"]]),
  project: "demo", branch: "main", touched: new Map([["src/deep/b.ts", "read"]]),
  active: new Map([["src/a.ts", "write"]]), activeIds: new Map(),
};
const W = 40;
const out = render(s, theme, W, 20);
console.log(out.join("\n"));
assert.equal(out.length, 20, "fills the full height");
assert(out.every((l) => l.length === W && l.startsWith("│ ")), "every row is exactly the panel width with a left edge");
assert(out[0].includes("demo") && out[0].includes("⎇ main"), "header: project + branch");
assert(out.some((l) => l.includes("▸ docs/")), "untouched folder stays closed");
assert(out.some((l) => l.includes("▾ src/")) && out.some((l) => l.includes("▾ deep/")), "folders open along touched paths");
assert(out.some((l) => /● a\.ts\s+\+3 -1$/.test(l)), "active file + delta");
assert(!out.some((l) => l.includes("x.md")), "closed folder hides files");
assert(out.at(-2)!.includes("● editing src/a.ts"), "footer: current activity");
assert(out.at(-1)!.includes("2 changed  +3 -1"), "footer: totals");
// overflow keeps active file visible
s.files = Array.from({ length: 200 }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`).concat("src/a.ts");
const small = render(s, theme, W, 14);
assert.equal(small.length, 14);
assert(small.some((l) => l.includes("● a.ts")), "active visible when clipped");
// outside git
const plain = render({ ...s, files: ["notes/"], git: new Map(), delta: new Map(), branch: "", active: new Map(), touched: new Map() }, theme, W, 8);
assert(plain.at(-1)!.includes("not a git repo") && plain.some((l) => l.includes("▸ notes/")));
console.log("---\n" + small.join("\n") + "\nOK");
