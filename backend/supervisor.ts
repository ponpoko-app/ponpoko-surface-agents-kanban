import type { Card, CardRole } from "../shared/board";
import { buildLaunch, buildMessage, readEvent, readSessionId, type Phase } from "./agents";
import type { BoardService, Runner } from "./board";
import type { BoardStore } from "./store";

export interface SupervisorDeps {
	store: BoardStore;
	board: () => BoardService;
	repoPath: () => string;
	cutoffMs?: number;
}

interface Run {
	cardId: string;
	role: CardRole;
	agentId: string;
	pid: number;
	proc: ReturnType<typeof Bun.spawn>;
	startedAt: number;
	lastNoteAt: number;
	lastText: string;
	stderr: string[];
	stopping: boolean;
	restartRole: CardRole | null;
}

const NOTE_GAP_MS = 1500;
const STDERR_KEEP = 40;

const splitLines = async (stream: ReadableStream<Uint8Array> | undefined, onLine: (line: string) => void): Promise<void> => {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				const line = buffer.slice(0, index).replace(/\r$/, "");
				buffer = buffer.slice(index + 1);
				if (line.trim()) onLine(line);
				index = buffer.indexOf("\n");
			}
		}
		if (buffer.trim()) onLine(buffer);
	} catch {
		return;
	}
};

export class Supervisor implements Runner {
	private readonly deps: SupervisorDeps;

	private readonly runs = new Map<string, Run>();

	constructor(deps: SupervisorDeps) {
		this.deps = deps;
	}

	private get cutoff(): number {
		return this.deps.cutoffMs ?? 6000;
	}

	live(): Set<string> {
		return new Set(this.runs.keys());
	}

	start(card: Card, role: CardRole): boolean {
		const current = this.runs.get(card.id);
		if (current) {
			if (current.stopping) current.restartRole = role;
			return true;
		}
		const board = this.deps.board();
		const settings = this.deps.store.settings();
		if (this.runs.size >= settings.maxConcurrent) {
			board.note(card.id, "system", `งานเต็มโควตาที่ตั้งไว้ (${settings.maxConcurrent}) — รอตัวที่ทำอยู่จบก่อน`);
			return false;
		}
		const agentId = role === "reviewer" ? card.reviewer : card.assignee;
		if (!agentId) {
			board.note(card.id, "system", role === "reviewer" ? "ยังไม่มี agent ว่างให้ตรวจ" : "ยังไม่มี agent ว่าง");
			return false;
		}
		const agent = this.deps.store.agent(agentId);
		if (!agent) {
			board.note(card.id, "system", `ไม่พบ agent ${agentId} แล้ว`);
			return false;
		}
		if (agent.kind === "manual") {
			board.note(card.id, "system", "agent ชนิด manual ไม่ได้ทำงานเอง ลากการ์ดเองหรือเพิ่ม codex/pi");
			return false;
		}
		const repoPath = this.deps.repoPath();
		if (!repoPath) {
			board.note(card.id, "system", "ยังไม่ได้ตั้ง repo path ของบอร์ด — ตั้งในแถบด้านบนก่อน");
			return false;
		}
		const sessionId = role === "reviewer" ? card.sessions.reviewer : card.sessions.implementer;
		const phase: Phase = role === "reviewer" ? "review" : sessionId ? "resume" : "start";
		const images = card.attachments.map((attachment) => ({
			name: attachment.name,
			path: board.attachmentPath(card.id, attachment.id),
		}));
		const message = buildMessage(card, role, phase, {
			extra: card.notes.slice(-3).map((note) => note.text).join(" | "),
			images,
		});
		let launch: ReturnType<typeof buildLaunch>;
		try {
			launch = buildLaunch(agent.kind, { card, role, phase, message, repoPath, sessionId, images });
		} catch (error) {
			board.note(card.id, "system", String(error));
			return false;
		}
		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn([launch.command, ...launch.args], {
				cwd: launch.cwd,
				env: { ...process.env, ...launch.env },
				stdout: "pipe",
				stderr: "pipe",
				detached: true,
			});
		} catch (error) {
			board.note(card.id, "system", `รัน ${launch.command} ไม่ได้: ${String(error)}`);
			return false;
		}
		const run: Run = {
			cardId: card.id,
			role,
			agentId,
			pid: proc.pid,
			proc,
			startedAt: Date.now(),
			lastNoteAt: 0,
			lastText: "",
			stderr: [],
			stopping: false,
			restartRole: null,
		};
		this.runs.set(card.id, run);
		board.note(card.id, "event", `${agent.name} เริ่มทำงาน (${launch.command})`);
		void this.pump(run);
		return true;
	}

	private transfer(run: Run, action: string, text: string): void {
		const at = Date.now();
		if (at - run.lastNoteAt < NOTE_GAP_MS) {
			run.lastText = text || run.lastText;
			return;
		}
		run.lastNoteAt = at;
		if (text) run.lastText = text;
		this.deps.board().note(run.cardId, "event", action);
	}

	private async pump(run: Run): Promise<void> {
		const stderr = splitLines(run.proc.stderr as ReadableStream<Uint8Array> | undefined, (line) => {
			run.stderr.push(line);
			if (run.stderr.length > STDERR_KEEP) run.stderr.shift();
		});
		const stdout = splitLines(run.proc.stdout as ReadableStream<Uint8Array> | undefined, (line) => {
			const sessionId = readSessionId("pi", line) ?? readSessionId("codex", line);
			if (sessionId && sessionId !== (run.role === "reviewer" ? this.currentSession(run) : this.currentSession(run))) {
				this.deps.board().setSession(run.cardId, run.role, sessionId);
			}
			const event = readEvent("codex", line) ?? readEvent("pi", line);
			if (!event) return;
			if (event.text) run.lastText = event.text;
			if (!event.done) this.transfer(run, event.action, event.text);
		});
		const code = await run.proc.exited;
		await Promise.all([stdout, stderr]);
		this.finish(run, code);
	}

	private currentSession(run: Run): string | null {
		const card = this.deps.store.card(run.cardId);
		if (!card) return null;
		return run.role === "reviewer" ? card.sessions.reviewer : card.sessions.implementer;
	}

	private finish(run: Run, code: number): void {
		this.runs.delete(run.cardId);
		const board = this.deps.board();
		const card = this.deps.store.card(run.cardId);
		if (run.stopping) {
			board.release(run.agentId);
			const role = run.restartRole;
			if (card && role && (role === "reviewer" ? card.lane === "ready_to_test" : card.lane === "working" || card.lane === "fix")) {
				this.start(card, role);
			}
			return;
		}
		if (!card) {
			board.release(run.agentId);
			return;
		}
		const tail = run.stderr.slice(-3).join(" / ");
		if (run.role === "reviewer") {
			const verdictText = (run.lastText || tail).trim();
			if (verdictText) board.reviewVerdict(run.cardId, verdictText);
			else board.note(run.cardId, "system", `คนตรวจจบโดยไม่บอกผล (exit ${code})`);
			board.release(run.agentId);
			return;
		}
		const moved = this.deps.store.card(run.cardId) ?? card;
		if (code === 0) {
			board.note(run.cardId, "event", "session จบแล้ว");
			if (moved.lane === "working" || moved.lane === "fix") board.moveCard(run.cardId, "ready_to_test");
		} else {
			board.note(run.cardId, "system", `จบด้วย exit ${code}${tail ? ` — ${tail}` : ""}`);
		}
		board.release(run.agentId);
	}

	stop(cardId: string): void {
		const run = this.runs.get(cardId);
		if (!run) return;
		run.restartRole = null;
		if (run.stopping) return;
		run.stopping = true;
		this.signal(run, "SIGTERM");
		const timer = setTimeout(() => {
			if (this.runs.get(cardId) === run) this.signal(run, "SIGKILL");
		}, this.cutoff);
		timer.unref?.();
	}

	private signal(run: Run, signal: "SIGTERM" | "SIGKILL"): void {
		try {
			process.kill(-run.pid, signal);
			return;
		} catch {
			try {
				process.kill(run.pid, signal);
			} catch {
				return;
			}
		}
	}

	stopAll(): void {
		for (const cardId of this.runs.keys()) this.stop(cardId);
	}

	sweep(): Card[] {
		const board = this.deps.board();
		const settings = this.deps.store.settings();
		const swept: Card[] = [];
		for (const card of this.deps.store.cards()) {
			if (card.lane !== "working" && card.lane !== "fix") continue;
			if (this.runs.has(card.id)) continue;
			board.markInterrupted(card.id);
			const fresh = this.deps.store.card(card.id);
			if (fresh) swept.push(fresh);
			if (settings.autoResume && (card.assignee || card.reviewer)) board.resume(card.id);
		}
		return swept;
	}
}
