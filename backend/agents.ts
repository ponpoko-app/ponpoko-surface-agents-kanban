import type { AgentKind, Card, CardRole } from "../shared/board";

export type Phase = "start" | "resume" | "review";

export interface Launch {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

export interface LaunchedEvent {
	action: string;
	done: boolean;
	sessionId: string | null;
	text: string;
}

interface Line {
	type?: string;
	thread_id?: string;
	session_id?: string;
	sessionId?: string;
	item?: {
		type?: string;
		command?: string;
		paths?: string[];
		text?: string;
		message?: string;
		exit_code?: number;
		aggregated_output?: string;
	};
	message?: { content?: unknown; text?: string } | string;
	tool?: string | { name?: string };
	text?: string;
	error?: { message?: string } | string;
}

const firstLine = (text: string): string => text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";

const clip = (text: string, max = 220): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export interface MediaRef {
	name: string;
	path: string;
}

export interface MessageOptions {
	extra?: string;
	images?: MediaRef[];
}

const imageLines = (images: MediaRef[]): string[] =>
	images.length === 0
		? []
		: ["", "รูปแนบ (เปิดไฟล์เหล่านี้ก่อนลงมือ — มันบอก requirement หรือบั๊กที่ต้องแก้):", ...images.map((image) => `- ${image.path} (${image.name})`)];

export const buildMessage = (card: Card, role: CardRole, phase: Phase, opts: MessageOptions = {}): string => {
	const extra = opts.extra;
	const lines = [
		`การ์ด: ${card.title}`,
		card.deliverable ? `deliverable ที่ต้องปิดให้จบ: ${card.deliverable}` : "deliverable: ทำให้งานนี้ปิดจบได้จริง",
		card.spec ? `สเปก: ${card.spec}` : "",
		card.acceptance ? `เกณฑ์ผ่าน: ${card.acceptance}` : "",
		card.tags.length ? `ถนัดที่ต้องการ: ${card.tags.join(", ")}` : "",
		"",
	];
	if (role === "reviewer") {
		lines.push(
			"คุณเป็นคนตรวจ ไม่ใช่คนทำการ์ดนี้",
			"อ่าน diff ของงาน ตรวจว่าปิด deliverable จริง และอาจรันคำสั่งตรวจของโปรเจกต์ได้",
			"ตอบบรรทัดแรกว่า PASS หรือ FAIL แล้วตามด้วยเหตุผลสั้นๆ หนึ่งบรรทัด",
			extra ? `สรุปจากคนทำ: ${extra}` : "",
		);
	} else if (phase === "resume") {
		lines.push(
			"ทำงานนี้ต่อใน session เดิม ไม่ต้องเริ่มใหม่",
			"ทำจน deliverable มีอยู่จริง แล้วรันคำสั่งตรวจของโปรเจกต์เองก่อนจบ",
		);
	} else {
		lines.push(
			"ทำงานจน deliverable มีอยู่จริง (build, deploy, release หรือ publish ให้ปิดจบ)",
			"รันคำสั่งตรวจของโปรเจกต์เองก่อนบอกว่าเสร็จ",
			"อย่าแก้ไฟล์นอก repo นี้",
			"จบงานแล้วเลื่อนการ์ดไป ready to test ด้วย tool board_submit",
		);
	}
	const body = lines.filter((line, index) => line.length > 0 || index === lines.length - 1);
	return [...body, ...imageLines(opts.images ?? [])].join("\n");
};

export const buildLaunch = (
	kind: AgentKind,
	opts: {
		card: Card;
		role: CardRole;
		phase: Phase;
		message: string;
		repoPath: string;
		sessionId: string | null;
		images?: MediaRef[];
	},
): Launch => {
	const images = (opts.images ?? []).slice(0, 4);
	const env: Record<string, string> = { AGENTS_KANBAN_CARD_ID: opts.card.id, AGENTS_KANBAN_ROLE: opts.role };
	if (kind === "codex") {
		if (opts.phase === "resume") {
			const args = ["exec", "--json", "--sandbox", "workspace-write", "-C", opts.repoPath, "resume", opts.sessionId ?? "--last"];
			for (const image of images) args.push("-i", image.path);
			args.push(opts.message);
			return { command: "codex", args, cwd: opts.repoPath, env };
		}
		const args = ["exec", "--json", "-s", "workspace-write", "-C", opts.repoPath];
		for (const image of images) args.push("-i", image.path);
		args.push(opts.message);
		return { command: "codex", args, cwd: opts.repoPath, env };
	}
	if (kind === "pi") {
		const args = ["-p"];
		const provider = process.env.AGENTS_KANBAN_PI_PROVIDER;
		if (provider) args.push("--provider", provider);
		args.push("--mode", "json", "--session-id", opts.sessionId ?? opts.card.id, opts.message);
		return { command: "pi", args, cwd: opts.repoPath, env };
	}
	throw new Error("agent ชนิด manual ไม่มีคำสั่งให้รัน — เพิ่ม codex หรือ pi แทน");
};

const parse = (line: string): Line | null => {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		return JSON.parse(trimmed) as Line;
	} catch {
		return null;
	}
};

export const readSessionId = (kind: AgentKind, line: string): string | null => {
	const parsed = parse(line);
	if (!parsed) return null;
	if (kind === "codex") return typeof parsed.thread_id === "string" ? parsed.thread_id : null;
	return parsed.session_id ?? parsed.sessionId ?? null;
};

const messageText = (parsed: Line): string => {
	if (typeof parsed.text === "string") return parsed.text;
	if (typeof parsed.message === "string") return parsed.message;
	if (parsed.message && typeof parsed.message === "object") {
		if (typeof parsed.message.text === "string") return parsed.message.text;
		if (Array.isArray(parsed.message.content)) {
			return parsed.message.content
				.map((part) => (part && typeof part === "object" && typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : ""))
				.join(" ")
				.trim();
		}
	}
	return "";
};

export const readEvent = (kind: AgentKind, line: string): LaunchedEvent | null => {
	const parsed = parse(line);
	if (!parsed) return null;
	const sessionId = readSessionId(kind, line);
	const item = parsed.item;
	if (kind === "codex") {
		if (parsed.type === "turn.completed") return { action: "จบ turn", done: true, sessionId, text: "" };
		if (parsed.type === "turn.failed") {
			const reason = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "turn ล้มเหลว");
			return { action: `ล้มเหลว: ${clip(reason)}`, done: true, sessionId, text: reason };
		}
		if (!item) return null;
		if (item.type === "command_execution") {
			const action = `รัน: ${clip(firstLine(item.command ?? ""), 160)}`;
			if (parsed.type === "item.completed" && typeof item.exit_code === "number" && item.exit_code !== 0) {
				return { action: `${action} (exit ${item.exit_code})`, done: false, sessionId, text: item.aggregated_output ?? "" };
			}
			return { action, done: false, sessionId, text: item.aggregated_output ?? "" };
		}
		if (item.type === "agent_message") {
			const text = item.text ?? "";
			return { action: `พูด: ${clip(firstLine(text))}`, done: false, sessionId, text };
		}
		if (item.type === "file_change" || item.type === "patch") {
			return { action: `แก้ไฟล์: ${clip((item.paths ?? []).join(", "), 160)}`, done: false, sessionId, text: "" };
		}
		if (item.type === "error") {
			return { action: `คำเตือน: ${clip(item.message ?? "error")}`, done: false, sessionId, text: item.message ?? "" };
		}
		return null;
	}
	const text = messageText(parsed);
	if (!text) {
		const tool = typeof parsed.tool === "string" ? parsed.tool : parsed.tool?.name;
		return tool ? { action: `ใช้ ${tool}`, done: false, sessionId, text: "" } : null;
	}
	const done = parsed.type === "agent_end" || parsed.type === "turn.completed" || parsed.type === "done";
	return { action: done ? "จบ session" : `พูด: ${clip(firstLine(text))}`, done, sessionId, text };
};
