import {
	addNote,
	canMove,
	emptyCard,
	agentFits,
	laneCards,
	LANES,
	pickAssignee,
	readVerdict,
	type Agent,
	type AgentKind,
	type BoardSnapshot,
	type Card,
	type CardQuestion,
	type CardRole,
	type Lane,
	type McpInfo,
	type NoteKind,
	type Settings,
} from "../shared/board";
import type { Attachments, IncomingAttachment } from "./attachments";
import { normalizeChecks, type CheckResult } from "./checks";
import type { BoardStore } from "./store";

export interface Runner {
	start(card: Card, role: CardRole): boolean;
	stop(cardId: string): void;
	live(): Set<string>;
	removeWorktree?(cardId: string): void;
	check?(card: Card): Promise<CheckResult[]>;
}

export interface BoardDeps {
	store: BoardStore;
	runner: Runner;
	attachments: Attachments;
	mcp?: () => McpInfo | null;
}

export interface CardInput {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	checks?: string[];
	tags?: string[];
	lane?: Lane;
}

export interface CardPatch {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	checks?: string[];
	tags?: string[];
}

export interface AgentInput {
	name?: string;
	kind?: AgentKind;
	capabilities?: string[];
	source?: "board" | "mcp";
}

const stamp = (): number => Date.now();

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const tagList = (value: unknown): string[] => {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return [...new Set(raw.map((item) => trimmed(item).toLowerCase()).filter(Boolean))];
};

export const newCardId = (at: number): string =>
	`c-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const newAgentId = (name: string, at: number): string => {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "agent";
	return `a-${slug}-${at.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
};

export class BoardService {
	private readonly deps: BoardDeps;
	private readonly checking = new Set<string>();

	constructor(deps: BoardDeps) {
		this.deps = deps;
	}

	card(id: string): Card {
		const card = this.deps.store.card(id);
		if (!card) throw new Error(`ไม่มี card id ${id}`);
		return card;
	}

	agents(): Agent[] {
		const live = this.deps.runner.live();
		return this.deps.store.agents().map((agent) =>
			agent.kind !== "manual" && agent.cardId !== null && !live.has(agent.cardId)
				? { ...agent, state: "offline" as const }
				: agent,
		);
	}

	snapshot(): BoardSnapshot {
		return {
			cards: this.deps.store.cards(),
			agents: this.agents(),
			settings: this.deps.store.settings(),
			mcp: this.deps.mcp ? this.deps.mcp() : null,
			at: stamp(),
		};
	}

	createCard(input: CardInput): Card {
		const at = stamp();
		const id = newCardId(at);
		const title = trimmed(input.title);
		if (!title) throw new Error("การ์ดต้องมีชื่อ");
		const lane: Lane = input.lane && LANES.includes(input.lane) ? input.lane : "backlog";
		if (lane === "done") throw new Error("ต้องตรวจงานก่อนปิดการ์ด");
		const siblings = laneCards(this.deps.store.cards(), lane);
		const card: Card = {
			...emptyCard(id, at),
			title,
			deliverable: trimmed(input.deliverable),
			spec: trimmed(input.spec),
			acceptance: trimmed(input.acceptance),
			checks: input.checks === undefined ? [] : normalizeChecks(input.checks),
			tags: tagList(input.tags),
			lane,
			position: siblings.length === 0 ? 0 : siblings[siblings.length - 1].position + 1,
			notes: [{ at, kind: "system", text: "สร้างการ์ด" }],
		};
		this.deps.store.putCard(card);
		return card;
	}

	updateCard(id: string, patch: CardPatch): Card {
		this.requireIdle(id);
		const card = this.card(id);
		const next: Card = {
			...card,
			title: patch.title === undefined ? card.title : trimmed(patch.title) || card.title,
			deliverable: patch.deliverable === undefined ? card.deliverable : trimmed(patch.deliverable),
			spec: patch.spec === undefined ? card.spec : trimmed(patch.spec),
			acceptance: patch.acceptance === undefined ? card.acceptance : trimmed(patch.acceptance),
			checks: patch.checks === undefined ? card.checks : normalizeChecks(patch.checks),
			tags: patch.tags === undefined ? card.tags : tagList(patch.tags),
			updatedAt: stamp(),
		};
		this.deps.store.putCard(next);
		return next;
	}

	note(id: string, kind: NoteKind, text: string, at = stamp()): Card {
		const card = this.card(id);
		const next = addNote(card, { at, kind, text: text.slice(0, 4000) });
		this.deps.store.putCard(next);
		return next;
	}

	setSession(id: string, role: CardRole, value: string | null): Card {
		const card = this.card(id);
		const next: Card = {
			...card,
			sessions: { ...card.sessions, [role]: value },
			updatedAt: stamp(),
		};
		this.deps.store.putCard(next);
		return next;
	}

	markInterrupted(id: string): Card {
		const card = this.card(id);
		const at = stamp();
		const next: Card = addNote(
			{ ...card, interrupted: true, updatedAt: at },
			{ at, kind: "system", text: "Ponpoko ปิดระหว่างทำงาน — session ยังอยู่ กดทำต่อได้" },
		);
		this.deps.store.putCard(next);
		return next;
	}

	moveCard(id: string, lane: Lane, position?: number): Card {
		this.requireIdle(id);
		const card = this.card(id);
		if (!LANES.includes(lane)) throw new Error(`ไม่รู้จักคอลัมน์ ${lane}`);
		if (!canMove(card.lane, lane)) throw new Error(`ย้ายจาก ${card.lane} ไป ${lane} ไม่ได้`);
		if (lane === "done" && card.lane !== "done") throw new Error("ต้องตรวจงานก่อนปิดการ์ด");
		const at = stamp();
		if (card.lane === lane) {
			const next: Card = { ...card, position: position ?? card.position, updatedAt: at };
			this.deps.store.putCard(next);
			return next;
		}
		let next = this.step(card, lane, at);
		if (position !== undefined) next = { ...next, position };
		this.deps.store.putCard(next);
		return next;
	}

	private step(card: Card, lane: Lane, at: number): Card {
		const agents = this.agents();
		switch (lane) {
			case "backlog": {
				this.deps.runner.stop(card.id);
				this.release(card.assignee, card.id);
				this.release(card.reviewer, card.id);
				return addNote(
					{ ...card, lane, assignee: null, reviewer: null, question: null, answer: null, interrupted: false, verdict: null, updatedAt: at },
					{ at, kind: "move", text: "พักไว้ใน Backlog" },
				);
			}
			case "working": {
				const assignment = card.assignee ? null : pickAssignee(card, agents);
				const assignee = card.assignee ?? assignment?.agentId ?? null;
				let next: Card = { ...card, lane, assignee, question: null, interrupted: false, updatedAt: at };
				if (assignment) next = addNote(next, { at, kind: "move", text: `มอบหมายให้ ${assignment.agentId} — ${assignment.reason}` });
				if (!assignee) {
					return addNote(next, { at, kind: "event", text: "ยังไม่มี agent ว่าง งานรออยู่ — ลากการ์ดเองหรือเพิ่ม agent" });
				}
				this.deps.store.putCard(next);
				const resumed = this.deps.runner.start(next, "implementer");
				next = addNote(this.card(card.id), {
					at,
					kind: "event",
					text: resumed ? (card.lane === "backlog" ? "เริ่มทำงาน" : "ทำงานต่อใน session เดิม") : "ยังไม่มี agent ว่าง งานรออยู่",
				});
				return next;
			}
			case "blocked": return this.blocked(card, null, at);
			case "ready_to_test": {
				this.deps.runner.stop(card.id);
				return addNote({ ...card, lane, question: null, verdict: null }, { at, kind: "review", text: "พร้อมรันคำสั่งตรวจจากการ์ด" });
			}
			case "fix": {
				this.deps.runner.stop(card.id);
				const next: Card = { ...card, lane, reviewer: null, verdict: "fail", updatedAt: at };
				return addNote(next, { at, kind: "review", text: "ตรวจไม่ผ่าน กลับไปแก้ที่ agent คนเดิม" });
			}
			case "done": {
				this.deps.runner.stop(card.id);
				this.release(card.assignee, card.id);
				this.release(card.reviewer, card.id);
				const next: Card = { ...card, lane, updatedAt: at };
				return addNote(next, { at, kind: "system", text: "ปิดงาน" });
			}
		}
	}

	reviewVerdict(id: string, text: string): Card {
		const verdict = readVerdict(text);
		const card = this.card(id);
		const at = stamp();
		const noted = addNote(card, {
			at,
			kind: "review",
			text: `ความเห็นเสริม (${verdict ?? "ไม่ชัดเจน"})\n${text.slice(0, 3500)}`,
		});
		this.deps.store.putCard(noted);
		return noted;
	}

	isChecking(id: string): boolean {
		return this.checking.has(id);
	}

	private requireIdle(id: string): void {
		if (this.isChecking(id)) throw new Error("การ์ดกำลังรันคำสั่งตรวจ");
	}

	async submit(id: string, checks?: unknown, summary = ""): Promise<Card> {
		this.requireIdle(id);
		const card = this.card(id);
		if (!["working", "fix", "ready_to_test"].includes(card.lane)) throw new Error("การ์ดยังส่งตรวจไม่ได้");
		const commands = checks === undefined ? card.checks : normalizeChecks(checks);
		if (!commands.length) throw new Error("เพิ่มคำสั่งตรวจอย่างน้อยหนึ่งคำสั่งก่อนปิดการ์ด");
		if (!this.deps.runner.check) throw new Error("บอร์ดยังรันคำสั่งตรวจไม่ได้");
		const pending = this.updateCard(id, { checks: commands });
		this.deps.store.putCard({ ...pending, verdict: null });
		this.checking.add(id);
		try {
			if (summary.trim()) this.note(id, "note", summary);
			this.note(id, "review", "เริ่มรันคำสั่งตรวจใน worktree ของการ์ด");
			const results = await this.deps.runner.check(pending);
			for (const result of results) {
				const status = result.timedOut ? "หมดเวลา" : `exit ${result.exit}`;
				this.note(id, "review", `${result.command} · ${status}${result.output ? `\n${result.output}` : ""}`);
			}
			if (results.length !== commands.length || results.some(({ exit, timedOut }) => exit !== 0 || timedOut)) {
				return this.note(id, "review", "ตรวจไม่ผ่าน การ์ดยังเปิดอยู่");
			}
			const closed = this.step({ ...this.card(id), verdict: "pass" }, "done", stamp());
			this.deps.store.putCard(closed);
			return closed;
		} catch (error) {
			return this.note(id, "review", `รันคำสั่งตรวจไม่สำเร็จ · ${String(error)}`);
		} finally {
			this.checking.delete(id);
		}
	}

	private blocked(card: Card, question: CardQuestion | null, at: number): Card {
		this.deps.runner.stop(card.id);
		return addNote(
			{ ...card, lane: "blocked", question, answer: null, interrupted: false },
			{ at, kind: "blocked", text: question?.text.slice(0, 4000) ?? "รอคำตอบจากคุณ" },
		);
	}

	private saveQuestion(id: string, question: CardQuestion): Card {
		this.requireIdle(id);
		const card = this.card(id);
		if (!canMove(card.lane, "blocked")) throw new Error(`ย้ายจาก ${card.lane} ไป blocked ไม่ได้`);
		const previous = card.notes.reduce(
			(latest, note) => note.kind === "blocked" ? Math.max(latest, note.at) : latest,
			card.question?.askedAt ?? 0,
		);
		const askedAt = Math.max(question.askedAt, previous + 1);
		const next = this.blocked(card, { ...question, askedAt }, askedAt);
		this.deps.store.putCard(next);
		return next;
	}

	ask(id: string, input: { text: unknown; options: unknown; recommend: unknown; kind?: unknown }): Card {
		const text = trimmed(input.text);
		const recommend = trimmed(input.recommend);
		const kind = input.kind === undefined ? "decision" : input.kind;
		if (!text) throw new Error("กรุณาระบุคำถาม");
		if (kind !== "decision" && kind !== "problem") throw new Error("ชนิดคำถามต้องเป็น decision หรือ problem");
		const options = Array.isArray(input.options) ? input.options.map(trimmed) : [];
		if (options.length < 2 || options.some((option) => !option) || new Set(options).size !== options.length) {
			throw new Error("กรุณาระบุตัวเลือกที่ต่างกันอย่างน้อย 2 ข้อ");
		}
		if (!recommend || !options.includes(recommend)) throw new Error("คำแนะนำต้องตรงกับหนึ่งในตัวเลือก");
		return this.saveQuestion(id, { text, options, recommend, kind, askedAt: stamp() });
	}

	block(id: string, question: string): Card {
		const text = trimmed(question);
		if (!text) throw new Error("กรุณาระบุสิ่งที่ติดขัด");
		return this.saveQuestion(id, { text, options: [], recommend: "", kind: "problem", askedAt: stamp() });
	}

	answer(id: string, answer: string, askedAt?: number): Card {
		this.requireIdle(id);
		const card = this.card(id);
		if (askedAt !== undefined && (card.lane !== "blocked" || card.question?.askedAt !== askedAt)) {
			throw new Error("คำถามเปลี่ยนแล้ว กรุณาเลือกคำตอบจากคำถามล่าสุด");
		}
		const text = trimmed(answer);
		if (!text) throw new Error("คำตอบว่างไม่ได้");
		const at = stamp();
		const noted = addNote({ ...card, answer: text, question: null }, { at, kind: "answer", text });
		const next = card.lane === "blocked" ? this.step(noted, "working", at) : noted;
		this.deps.store.putCard(next);
		return next;
	}

	resume(id: string): Card {
		this.requireIdle(id);
		const card = this.card(id);
		if (card.lane === "working" || card.lane === "fix") {
			const started = this.deps.runner.start(card, "implementer");
			return this.note(id, "event", started ? "ทำต่อใน session เดิม" : "ยังไม่มี agent ว่าง");
		}
		return this.moveCard(id, "working");
	}

	attach(id: string, incoming: IncomingAttachment): Card {
		const card = this.card(id);
		const { attachment } = this.deps.attachments.save(id, incoming);
		const at = stamp();
		const next = addNote(
			{ ...card, attachments: [...card.attachments, attachment], updatedAt: at },
			{ at, kind: "note", text: `แนบรูป ${attachment.name} (${Math.round(attachment.bytes / 1024)}KB)` },
		);
		this.deps.store.putCard(next);
		return next;
	}

	detach(id: string, attachmentId: string): Card {
		const card = this.card(id);
		const attachment = card.attachments.find((item) => item.id === attachmentId);
		if (!attachment) throw new Error(`ไม่พบรูป ${attachmentId} บนการ์ดนี้`);
		this.deps.attachments.remove(id, attachment);
		const at = stamp();
		const next = addNote(
			{ ...card, attachments: card.attachments.filter((item) => item.id !== attachmentId), updatedAt: at },
			{ at, kind: "note", text: `ลบรูป ${attachment.name}` },
		);
		this.deps.store.putCard(next);
		return next;
	}

	attachmentPath(id: string, attachmentId: string): string {
		const card = this.card(id);
		const attachment = card.attachments.find((item) => item.id === attachmentId);
		if (!attachment) throw new Error(`ไม่พบรูป ${attachmentId} บนการ์ดนี้`);
		return this.deps.attachments.fileFor(id, attachment);
	}

	attachmentData(id: string, attachmentId: string): { mime: string; data_base64: string } {
		const card = this.card(id);
		const attachment = card.attachments.find((item) => item.id === attachmentId);
		if (!attachment) throw new Error(`ไม่พบรูป ${attachmentId} บนการ์ดนี้`);
		return this.deps.attachments.read(id, attachment);
	}

	deleteCard(id: string): Card {
		this.requireIdle(id);
		const card = this.card(id);
		this.deps.runner.stop(id);
		this.deps.runner.removeWorktree?.(id);
		this.deps.attachments.removeCard(id);
		this.release(card.assignee, id);
		this.release(card.reviewer, id);
		this.deps.store.removeCard(id);
		return card;
	}

	settings(patch?: Partial<Settings>): Settings {
		const current = this.deps.store.settings();
		if (!patch) return current;
		const next: Settings = {
			repoPath: patch.repoPath === undefined ? current.repoPath : trimmed(patch.repoPath),
			autoAssign: patch.autoAssign === undefined ? current.autoAssign : Boolean(patch.autoAssign),
			autoResume: patch.autoResume === undefined ? current.autoResume : Boolean(patch.autoResume),
			maxConcurrent:
				patch.maxConcurrent === undefined
					? current.maxConcurrent
					: Math.max(1, Math.min(8, Math.floor(Number(patch.maxConcurrent) || current.maxConcurrent))),
		};
		this.deps.store.putSettings(next);
		return next;
	}

	addAgent(input: AgentInput): Agent {
		const at = stamp();
		const name = trimmed(input.name) || "agent";
		const kind: AgentKind = input.kind && input.kind !== undefined ? input.kind : "manual";
		const existing = this.deps.store.agents().find((agent) => agent.name === name && agent.kind === kind);
		const agent: Agent = {
			id: existing?.id ?? newAgentId(name, at),
			name,
			kind,
			capabilities: tagList(input.capabilities),
			state: existing?.state ?? "idle",
			cardId: existing?.cardId ?? null,
			load: existing?.load ?? 0,
			lastSeenAt: at,
			source: input.source ?? "board",
		};
		this.deps.store.putAgent(agent);
		return agent;
	}

	removeAgent(id: string): void {
		const agent = this.deps.store.agent(id);
		if (agent?.cardId) this.deps.runner.stop(agent.cardId);
		this.deps.store.removeAgent(id);
		const cards = this.deps.store.cards().map((card) =>
			card.assignee === id || card.reviewer === id ? { ...card, assignee: card.assignee === id ? null : card.assignee, reviewer: card.reviewer === id ? null : card.reviewer } : card,
		);
		for (const card of cards) this.deps.store.putCard(card);
	}

	claimNext(agentId: string): Card | null {
		const agent = this.deps.store.agent(agentId);
		if (!agent || agent.kind === "manual") return null;
		if (agent.cardId) return this.deps.store.card(agent.cardId);
		const candidate = laneCards(this.deps.store.cards(), "backlog").find((card) => agentFits(agent, card.tags));
		if (!candidate) return null;
		const at = stamp();
		const next = addNote(
			{ ...candidate, lane: "working", assignee: agentId, interrupted: false, updatedAt: at },
			{ at, kind: "move", text: `${agent.name} ดึงการ์ดจาก Backlog` },
		);
		this.deps.store.putCard(next);
		this.deps.runner.start(next, "implementer");
		return this.card(next.id);
	}

	claim(agentId: string, cardId: string): Agent | null {
		const agent = this.deps.store.agent(agentId);
		if (!agent) return null;
		const next: Agent = { ...agent, state: "working", cardId, load: agent.load + 1, lastSeenAt: stamp() };
		this.deps.store.putAgent(next);
		return next;
	}

	release(agentId: string | null, cardId: string): void {
		if (!agentId) return;
		const agent = this.deps.store.agent(agentId);
		if (agent?.cardId !== cardId) return;
		this.deps.store.putAgent({ ...agent, state: "idle", cardId: null, load: 0, lastSeenAt: stamp() });
	}
}
