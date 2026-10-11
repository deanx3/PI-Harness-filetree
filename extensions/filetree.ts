/**
 * File tree on the right, like Claude Code's filetree mod: the project's files
 * (git-tracked + untracked, ignored files hidden) with git status, and the file
 * pi is reading or editing highlighted live. Folders open only along changed or
 * touched paths. `/filetree` toggles it; hidden on terminals narrower than MIN_COLS.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDTH = 36;
const MIN_COLS = 120;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write"]);

type Kind = "read" | "write";
type Dir = Map<string, Dir | null>; // null = file

export type State = {
	files: string[]; // cwd-relative, "/"-separated
	git: Map<string, string>; // path -> porcelain code ("M", "??", "D", ...)
	delta: Map<string, string>; // path -> "+3 -1"
	branch: string;
	touched: Map<string, Kind>; // this session
	active: Map<string, Kind>; // running right now, by toolCallId
	activeIds: Map<string, string>; // toolCallId -> path
};

export function render(s: State, theme: Theme, width: number, maxRows: number): string[] {
	const root: Dir = new Map();
	const add = (p: string) => {
		const parts = p.split("/").filter(Boolean);
		if (p.endsWith("/")) parts.push(""); // bare folder (non-git fallback)
		let node = root;
		parts.forEach((part, i) => {
			if (i === parts.length - 1) {
				if (part && !node.has(part)) node.set(part, null);
			} else {
				let next = node.get(part);
				if (!next) node.set(part, (next = new Map()));
				node = next;
			}
		});
	};
	for (const p of s.files) add(p);
	for (const p of [...s.git.keys(), ...s.touched.keys(), ...s.active.keys()]) add(p);

	// open every folder that leads to something changed, touched or active
	const open = new Set<string>();
	for (const p of [...s.git.keys(), ...s.touched.keys(), ...s.active.keys()]) {
		const parts = p.split("/");
		for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join("/"));
	}

	const lines: string[] = [];
	let focus = -1;
	const walk = (dir: Dir, prefix: string, depth: number) => {
		const entries = [...dir].sort(([a, av], [b, bv]) => (av === null) === (bv === null) ? a.localeCompare(b) : av === null ? 1 : -1);
		for (const [name, child] of entries) {
			const rel = prefix ? `${prefix}/${name}` : name;
			const indent = "  ".repeat(depth);
			if (child) {
				const isOpen = open.has(rel);
				lines.push(theme.fg(isOpen ? "text" : "muted", `${indent}${isOpen ? "▾" : "▸"} ${name}/`));
				if (isOpen) walk(child, rel, depth + 1);
				continue;
			}
			const act = s.active.get(rel), done = s.touched.get(rel), code = s.git.get(rel);
			const mark = act ? theme.fg(act === "write" ? "warning" : "accent", "●") : done ? theme.fg(done === "write" ? "warning" : "accent", "·") : " ";
			const color = code === "??" || code === "A" ? "success" : code === "D" ? "error" : code ? "warning" : "text";
			const right = code ? ` ${s.delta.get(rel) ?? (code === "??" ? "new" : code)}` : "";
			const left = `${indent}${mark} `;
			const name_ = truncateToWidth(name, Math.max(4, width - visibleWidth(left) - right.length - 1));
			let text = theme.fg(color, name_);
			if (act) {
				text = theme.bold(text);
				focus = lines.length;
			}
			const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(name_) - right.length));
			lines.push(left + text + pad + theme.fg("dim", right.trim()));
		}
	};
	walk(root, "", 0);

	const header = [theme.fg("borderAccent", truncateToWidth(` ${s.branch || "files"}`, width)), ""];
	const room = Math.max(1, maxRows - header.length);
	if (lines.length <= room) return [...header, ...lines];
	// too tall: keep the active file in view
	const start = Math.min(Math.max(0, focus - Math.floor(room / 2)), lines.length - room);
	const view = lines.slice(start, start + room);
	if (start > 0) view[0] = theme.fg("dim", `  … ${start} more`);
	if (start + room < lines.length) view[view.length - 1] = theme.fg("dim", `  … ${lines.length - start - room + 1} more`);
	return [...header, ...view];
}

export default function (pi: ExtensionAPI) {
	const s: State = { files: [], git: new Map(), delta: new Map(), branch: "", touched: new Map(), active: new Map(), activeIds: new Map() };
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let handle: OverlayHandle | undefined;
	let hidden = false;
	const redraw = () => tui?.requestRender();

	async function git(args: string[]) {
		const r = await pi.exec("git", args, { cwd: ctx!.cwd, timeout: 3000 });
		return r.code === 0 ? r.stdout : undefined;
	}

	async function refresh() {
		if (!ctx) return;
		const list = await git(["ls-files", "-co", "--exclude-standard", "-z"]);
		if (list === undefined) {
			// not a git repo: top level only, touched files fill in the rest
			s.files = readdirSync(ctx.cwd, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
			s.git.clear();
			s.branch = path.basename(ctx.cwd);
			return redraw();
		}
		s.files = list.split("\0").filter(Boolean);
		const prefix = (await git(["rev-parse", "--show-prefix"]))?.trim() ?? "";
		const strip = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : undefined);
		const [status, numstat, branch] = await Promise.all([
			git(["status", "--porcelain=v1", "-z", "-uall", "."]),
			git(["diff", "--numstat", "HEAD", "--", "."]),
			git(["branch", "--show-current"]),
		]);
		s.git.clear();
		const parts = (status ?? "").split("\0");
		for (let i = 0; i < parts.length; i++) {
			const e = parts[i];
			if (e.length < 4) continue;
			const code = e.slice(0, 2).trim();
			const p = strip(e.slice(3));
			if (p) s.git.set(p, code);
			if (code.startsWith("R") || code.startsWith("C")) i++; // skip the old path
		}
		s.delta.clear();
		for (const line of (numstat ?? "").split("\n")) {
			const [a, d, file] = line.split("\t");
			const p = file && strip(file);
			if (p) s.delta.set(p, a === "-" ? "bin" : `+${a} -${d}`);
		}
		s.branch = branch?.trim() || "detached";
		redraw();
	}

	function rel(p: unknown): string | undefined {
		if (typeof p !== "string" || !ctx) return;
		const r = path.relative(ctx.cwd, path.resolve(ctx.cwd, p.replace(/^@/, ""))).split(path.sep).join("/");
		return r && !r.startsWith("..") ? r : undefined;
	}

	function show(c: ExtensionContext) {
		if (!c.hasUI || tui) return;
		void c.ui.custom<void>(
			(t: TUI, theme: Theme, _kb, done) => {
				tui = t;
				return {
					render: (w: number) => render(s, theme, w, (process.stdout.rows || 40) - 1),
					invalidate() {},
					dispose() {
						tui = undefined;
						done();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: () => ({
					anchor: "top-right",
					width: WIDTH,
					maxHeight: "100%",
					margin: { top: 0, right: 0, bottom: 0 },
					nonCapturing: true,
					visible: (cols: number) => !hidden && cols >= MIN_COLS,
				}),
				onHandle: (h: OverlayHandle) => {
					handle = h;
					h.unfocus();
				},
			},
		);
	}

	pi.on("session_start", async (_e, c) => {
		ctx = c;
		show(c);
		await refresh();
	});
	pi.on("session_shutdown", async () => {
		handle?.hide();
		handle = undefined;
	});
	pi.on("tool_execution_start", async (e, c) => {
		ctx = c;
		const kind: Kind | undefined = WRITE_TOOLS.has(e.toolName) ? "write" : READ_TOOLS.has(e.toolName) ? "read" : undefined;
		const p = kind && rel(e.args?.path ?? e.args?.file_path);
		if (!kind || !p) return; // ponytail: bash commands aren't mapped to files
		s.active.set(p, kind);
		s.activeIds.set(e.toolCallId, p);
		redraw();
	});
	pi.on("tool_execution_end", async (e) => {
		const p = s.activeIds.get(e.toolCallId);
		if (!p) return;
		s.activeIds.delete(e.toolCallId);
		const kind = s.active.get(p)!;
		s.active.delete(p);
		if (s.touched.get(p) !== "write") s.touched.set(p, kind);
		if (kind === "write") await refresh();
		else redraw();
	});
	pi.on("turn_end", async (_e, c) => {
		ctx = c;
		await refresh();
	});

	pi.registerCommand("filetree", {
		description: "Toggle the file tree on the right",
		handler: async (_args, c) => {
			hidden = !hidden;
			handle?.setHidden(hidden);
			c.ui.notify(hidden ? "File tree hidden" : `File tree shown (needs ${MIN_COLS}+ columns)`, "info");
			redraw();
		},
	});
}
