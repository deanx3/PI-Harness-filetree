import assert from "node:assert";
import { render, type State } from "../extensions/filetree.ts";
const theme: any = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const s: State = {
  files: ["README.md", "src/a.ts", "src/deep/b.ts", "docs/x.md"],
  git: new Map([["src/a.ts", "M"], ["new.ts", "??"]]),
  delta: new Map([["src/a.ts", "+3 -1"]]),
  branch: "main", touched: new Map([["src/deep/b.ts", "read"]]),
  active: new Map([["src/a.ts", "write"]]), activeIds: new Map(),
};
const out = render(s, theme, 36, 50);
console.log(out.join("\n"));
assert.equal(out[0].trim(), "main");
assert(out.some((l) => l.includes("▸ docs/")), "untouched folder stays closed");
assert(out.some((l) => l.includes("▾ src/")) && out.some((l) => l.includes("▾ deep/")), "folders open along touched paths");
assert(out.some((l) => /● a\.ts\s+\+3 -1$/.test(l)), "active file + delta");
assert(out.some((l) => /new\.ts\s+new$/.test(l)), "untracked file shown");
assert(!out.some((l) => l.includes("x.md")), "closed folder hides files");
assert(out.every((l) => l.length <= 36), "fits width");
// overflow keeps active file visible
s.files = Array.from({ length: 200 }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`).concat("src/a.ts");
const small = render(s, theme, 36, 10);
assert.equal(small.length, 10); assert(small.some((l) => l.includes("● a.ts")), "active visible when clipped");
console.log("---\n" + small.join("\n") + "\nOK");
