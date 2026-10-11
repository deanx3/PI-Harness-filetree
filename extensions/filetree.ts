/**
 * File tree on the right, like Claude Code's filetree mod: the project's files
 * (git-tracked + untracked, ignored files hidden) with git status, and the files
 * pi reads or edits (its file tools, and file paths in bash/PowerShell commands)
 * highlighted live. Folders auto-open along changed or touched paths; click a folder
 * or use the keyboard to open any other. `/filetree` toggles the panel, `alt+e` or
 * `/filetree focus` focuses it. Plain Unicode glyphs only (no Nerd Font, no emoji),
 * so it looks the same in Windows Terminal, macOS Terminal, kitty, and the rest.
 * Mouse needs pi's fullscreen mode (the default); the keyboard works in both modes.
 */
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDTH = 40;
const MIN_COLS = 120;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

type Kind = "read" | "write";
type Dir = Map<string, Dir | null>; // null = file

export type State = {
	files: string[]; // cwd-relative, "/"-separated
	git: Map<string, string>; // path -> porcelain code ("M", "??", "D", ...)
	delta: Map<string, string>; // path -> "+3 -1"
	project: string;
	branch: string; // "" outside git
	touched: Map<string, Kind>; // this session
	active: Map<string, Kind>; // running right now
	activeIds: Map<string, string[]>; // toolCallId -> paths
	open: Map<string, boolean>; // folders the user opened (true) or closed (false); wins over auto-open
	sel?: string; // selected row
	scroll: number; // first visible tree row
	follow: boolean; // keep the active file in view; off once the user scrolls or moves
	focused: boolean;
};

export const newState = (): State => ({
	files: [], git: new Map(), delta: new Map(), project: "", branch: "",
	touched: new Map(), active: new Map(), activeIds: new Map(),
	open: new Map(), scroll: 0, follow: true, focused: false,
});

/**
 * Files a shell command reads or writes: words that resolve to a known file, following `cd`.
 * Write = after `>`/`>>`, or in a segment with sed/perl -i, tee, mv, cp, rm, touch, truncate,
 * or a PowerShell writer (Set-Content, Out-File, Remove-Item, ...).
 */
export function bashFiles(cmd: string, cwd: string, known: Set<string>): Map<string, Kind> {
	// ponytail: word matching, not a shell parser; globs and $vars are missed, and cp's source counts as a write
	const out = new Map<string, Kind>();
	const norm = (w: string) => {
		w = w.replace(/^~(?=[\\/]|$)/, os.homedir());
		// Git Bash on Windows: /c/Users/x -> c:/Users/x
		return process.platform === "win32" ? w.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:") : w;
	};
	let dir = cwd;
	for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
		const words = seg.replace(/[<'"`()]/g, " ").replace(/>>?/g, " > ").split(/\s+/).filter(Boolean);
		if (/^(cd|pushd|set-location|sl)$/i.test(words[0] ?? "") && words[1]) {
			dir = path.resolve(dir, norm(words[1]));
			continue;
		}
		const writes = /\b(sed|perl)\b.*\s-\w*i|\b(tee|mv|cp|rm|touch|truncate|set-content|add-content|out-file|remove-item|move-item|copy-item|new-item|rename-item)\b/i.test(seg);
		words.forEach((w, i) => {
			const r = path.relative(cwd, path.resolve(dir, norm(w))).split(path.sep).join("/");
			const redirect = words[i - 1] === ">";
			if (!known.has(r) && !(redirect && r && !r.startsWith(".."))) return;
			if (out.get(r) !== "write") out.set(r, writes || redirect ? "write" : "read");
		});
	}
	return out;
}

export type Row = { path: string; dir: boolean; open: boolean };
/** One entry per rendered line: a tree row, a "more" marker to scroll by, or nothing (header/footer). */
export type Slot = Row | "up" | "down" | undefined;
export type View = { lines: string[]; slots: Slot[]; rows: Row[]; room: number };

const parents = (p: string) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"));

export function view(s: State, theme: Theme, width: number, maxRows: number): View {
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
	const marked = [...s.git.keys(), ...s.touched.keys(), ...s.active.keys()];
	for (const p of [...s.files, ...marked]) add(p);
	const auto = new Set(marked.flatMap(parents)); // open every folder that leads to something changed, touched or active

	const cw = width - 2; // inside the "│ " left edge
	const fit = (text: string) => {
		const t = truncateToWidth(text, cw);
		return t + " ".repeat(Math.max(0, cw - visibleWidth(t)));
	};
	const line = (left: string, name: string, color: Parameters<Theme["fg"]>[0], right: string, bold: boolean) => {
		const n = truncateToWidth(name, Math.max(4, cw - visibleWidth(left) - visibleWidth(right) - 1));
		const styled = bold ? theme.bold(theme.fg(color, n)) : theme.fg(color, n);
		return left + styled + " ".repeat(Math.max(1, cw - visibleWidth(left) - visibleWidth(n) - visibleWidth(right))) + right;
	};
	const rule = theme.fg("borderMuted", "─".repeat(cw));

	const rows: Row[] = [];
	const body: string[] = [];
	let focus = -1;
	const walk = (dir: Dir, prefix: string, guide: string) => {
		const entries = [...dir].sort(([a, av], [b, bv]) => (av === null) === (bv === null) ? a.localeCompare(b) : av === null ? 1 : -1);
		entries.forEach(([name, child], i) => {
			const rel = prefix ? `${prefix}/${name}` : name;
			const last = i === entries.length - 1;
			const lead = theme.fg("borderMuted", guide + (prefix ? (last ? "└ " : "├ ") : ""));
			let text: string;
			if (child) {
				const isOpen = s.open.get(rel) ?? auto.has(rel);
				let right = "";
				if (!isOpen) {
					// changes hidden inside a closed folder: ?:1 M:2 D:1
					const n = { "?": 0, M: 0, D: 0 };
					for (const [p, code] of s.git) if (p.startsWith(`${rel}/`)) n[code === "??" || code === "A" ? "?" : code === "D" ? "D" : "M"]++;
					right = [n["?"] && theme.fg("success", `?:${n["?"]}`), n.M && theme.fg("warning", `M:${n.M}`), n.D && theme.fg("error", `D:${n.D}`)].filter(Boolean).join(" ");
				}
				text = line(lead + theme.fg("muted", isOpen ? "▾ " : "▸ "), `${name}/`, isOpen ? "text" : "muted", right, false);
				rows.push({ path: rel, dir: true, open: isOpen });
				body.push(rel === s.sel ? theme.bg("selectedBg", fit(text)) : fit(text));
				if (isOpen) walk(child, rel, guide + (prefix ? (last ? "  " : "│ ") : ""));
				return;
			}
			const act = s.active.get(rel), done = s.touched.get(rel), code = s.git.get(rel);
			const mark = act ? theme.fg(act === "write" ? "warning" : "accent", "● ") : done ? theme.fg(done === "write" ? "warning" : "accent", "• ") : "  ";
			const color = code === "??" || code === "A" ? "success" : code === "D" ? "error" : code ? "warning" : "text";
			const right = code ? theme.fg("dim", s.delta.get(rel) ?? (code === "??" ? "new" : code)) : "";
			if (act) focus = rows.length;
			text = line(lead + mark, name, color, right, !!act);
			rows.push({ path: rel, dir: false, open: false });
			body.push(rel === s.sel ? theme.bg("selectedBg", fit(text)) : fit(text));
		});
	};
	walk(root, "", "");

	const header = [fit(theme.bold(theme.fg("accent", s.project)) + (s.branch ? theme.fg("muted", ` · ${s.branch}`) : "")), rule];
	const [cur] = s.active;
	let plus = 0, minus = 0;
	for (const d of s.delta.values()) {
		const m = /^\+(\d+) -(\d+)$/.exec(d);
		if (m) (plus += +m[1]), (minus += +m[2]);
	}
	const footer = [
		rule,
		fit(cur ? theme.fg(cur[1] === "write" ? "warning" : "accent", `● ${cur[1] === "write" ? "editing" : "reading"} `) + cur[0] : theme.fg("dim", "  idle")),
		fit(s.branch ? theme.fg("muted", `${s.git.size} changed  `) + theme.fg("success", `+${plus}`) + " " + theme.fg("error", `-${minus}`) : theme.fg("dim", "not a git repo")),
	];
	if (s.focused) footer.push(fit(theme.fg("dim", "↑↓ move  ←→ fold  enter @file  esc")));

	const room = Math.max(1, maxRows - header.length - footer.length);
	if (s.follow && focus >= 0) s.scroll = focus - Math.floor(room / 2);
	s.scroll = Math.min(Math.max(0, s.scroll), Math.max(0, rows.length - room));
	const start = s.scroll;
	const lines = body.slice(start, start + room);
	const slots: Slot[] = rows.slice(start, start + room);
	if (start > 0) (lines[0] = fit(theme.fg("dim", `  ↑ ${start + 1} more`))), (slots[0] = "up");
	if (start + room < rows.length) (lines[lines.length - 1] = fit(theme.fg("dim", `  ↓ ${rows.length - start - room + 1} more`))), (slots[lines.length - 1] = "down");
	while (lines.length < room) lines.push(fit("")), slots.push(undefined); // solid column, so chat text can't show through
	const edge = theme.fg("borderMuted", "│") + " ";
	return {
		lines: [...header, ...lines, ...footer].map((l) => edge + l),
		slots: [...header.map(() => undefined), ...slots, ...footer.map(() => undefined)],
		rows,
		room,
	};
}

export const render = (s: State, theme: Theme, width: number, maxRows: number) => view(s, theme, width, maxRows).lines;

/** Keyboard/mouse actions on the tree. Returns the file to mention when the user picks one. */
export function act(s: State, v: View, action: "up" | "down" | "left" | "right" | "enter" | "toggle" | "pageUp" | "pageDown"): string | undefined {
	const i = v.rows.findIndex((r) => r.path === s.sel);
	const row = v.rows[i];
	const go = (j: number) => {
		const r = v.rows[Math.min(Math.max(0, j), v.rows.length - 1)];
		if (!r) return;
		s.sel = r.path;
		s.follow = false;
		const k = v.rows.indexOf(r);
		if (k <= s.scroll) s.scroll = k - 1; // keep clear of the "↑ more" line
		else if (k >= s.scroll + v.room - 1) s.scroll = k - v.room + 2;
	};
	if (action === "pageUp" || action === "pageDown") {
		s.follow = false;
		s.scroll += (action === "pageUp" ? -1 : 1) * Math.max(1, v.room - 2);
		return;
	}
	if (!row) return go(0);
	if (action === "up") return go(i - 1);
	if (action === "down") return go(i + 1);
	if (row.dir && (action === "toggle" || action === "enter" || (action === "right" && !row.open) || (action === "left" && row.open))) {
		s.open.set(row.path, !row.open);
		return;
	}
	if (action === "right" && row.dir) return go(i + 1); // into the open folder
	if (action === "left") return go(v.rows.findIndex((r) => r.path === parents(row.path).at(-1)));
	if (action === "enter" && !row.dir) return row.path;
}

export default function (pi: ExtensionAPI) {
	const s = newState();
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let handle: OverlayHandle | undefined;
	let hidden = false;
	let last: View | undefined; // latest render, for mapping clicks and keys to rows
	const redraw = () => tui?.requestRender();

	async function git(args: string[]) {
		const r = await pi.exec("git", args, { cwd: ctx!.cwd, timeout: 3000 });
		return r.code === 0 ? r.stdout : undefined;
	}

	async function refresh() {
		if (!ctx) return;
		s.project = path.basename(ctx.cwd);
		const list = await git(["ls-files", "-co", "--exclude-standard", "-z"]);
		if (list === undefined) {
			// not a git repo: top level only, touched files fill in the rest
			s.files = readdirSync(ctx.cwd, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
			s.git.clear();
			s.delta.clear();
			s.branch = "";
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

	const mention = (p: string | undefined) => {
		if (!p || !ctx) return;
		ctx.ui.pasteToEditor(`@${p} `);
		handle?.unfocus(); // back to the prompt to finish the message
	};

	function focusTree() {
		if (!handle || hidden) return;
		if (!s.sel) s.sel = [...s.active.keys()][0] ?? last?.rows[0]?.path;
		handle.focus();
		redraw();
	}

	function show(c: ExtensionContext) {
		if (!c.hasUI || tui) return;
		void c.ui.custom<void>(
			(t: TUI, theme: Theme, _kb, done) => {
				tui = t;
				return {
					render: (w: number) => {
						s.focused = !!handle?.isFocused();
						last = view(s, theme, w, (process.stdout.rows || 40) - 1);
						return last.lines;
					},
					handleInput(data: string) {
						if (!last) return;
						if (matchesKey(data, "escape")) return void (handle?.unfocus(), redraw());
						const keys = ["up", "down", "left", "right", "enter", "pageUp", "pageDown"] as const;
						const k = keys.find((key) => matchesKey(data, key));
						if (!k) return;
						mention(act(s, last, k));
						redraw();
					},
					handleMouse(e: TuiMouseEvent) {
						if (!last) return;
						if (e.type === "wheel") {
							s.follow = false;
							s.scroll += e.wheelDelta ?? 0;
							return { handled: true };
						}
						if (e.type === "press" || e.type === "release") return { handled: true }; // the click goes to whoever took the press
						if (e.type !== "click" || e.button !== "left") return;
						const hit = last.slots[e.y];
						if (hit === "up" || hit === "down") act(s, last, hit === "up" ? "pageUp" : "pageDown");
						else if (hit) {
							s.sel = hit.path;
							if (hit.dir) act(s, last, "toggle");
							else if ((e.clickCount ?? 1) >= 2) mention(hit.path);
						}
						return { focus: true };
					},
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
	pi.on("agent_start", async () => {
		s.follow = true; // a new request: follow pi again
	});
	pi.on("tool_execution_start", async (e, c) => {
		ctx = c;
		let hits: Map<string, Kind>;
		if (SHELL_TOOLS.has(e.toolName) && typeof e.args?.command === "string") {
			hits = bashFiles(e.args.command, c.cwd, new Set(s.files));
		} else {
			const kind: Kind | undefined = WRITE_TOOLS.has(e.toolName) ? "write" : READ_TOOLS.has(e.toolName) ? "read" : undefined;
			const p = kind && rel(e.args?.path ?? e.args?.file_path);
			hits = new Map(kind && p ? [[p, kind]] : []);
		}
		if (!hits.size) return;
		for (const [p, kind] of hits) {
			s.active.set(p, kind);
			for (const d of parents(p)) if (s.open.get(d) === false) s.open.delete(d); // reveal it even in a folder the user closed
		}
		s.activeIds.set(e.toolCallId, [...hits.keys()]);
		redraw();
	});
	pi.on("tool_execution_end", async (e) => {
		const paths = s.activeIds.get(e.toolCallId);
		if (!paths) return;
		s.activeIds.delete(e.toolCallId);
		let wrote = false;
		for (const p of paths) {
			const kind = s.active.get(p);
			if (!kind) continue;
			s.active.delete(p);
			if (s.touched.get(p) !== "write") s.touched.set(p, kind);
			wrote ||= kind === "write";
		}
		if (wrote) await refresh();
		else redraw();
	});
	pi.on("turn_end", async (_e, c) => {
		ctx = c;
		await refresh();
	});

	pi.registerShortcut("alt+e", { description: "Focus the file tree", handler: () => focusTree() });
	pi.registerCommand("filetree", {
		description: "Toggle the file tree on the right; `/filetree focus` moves keyboard focus to it",
		handler: async (args, c) => {
			if (args.trim() === "focus") return focusTree();
			hidden = !hidden;
			handle?.setHidden(hidden);
			c.ui.notify(hidden ? "File tree hidden" : `File tree shown (needs ${MIN_COLS}+ columns)`, "info");
			redraw();
		},
	});
}
