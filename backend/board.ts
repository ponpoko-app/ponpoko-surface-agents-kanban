import {
	addNote,
	canMove,
	emptyCard,
	laneCards,
	LANES,
	pickAssignee,
	pickReviewer,
	readVerdict,
	type Agent,
	type AgentKind,
	type BoardSnapshot,
	type Card,
	type CardRole,
	type Lane,
	type McpInfo,
	type NoteKind,
	type Settings,
} from "../shared/board";
import type { BoardStore } from "./store";

export interface Runner {
	start(card: Card, role: CardRole): boolean;
	stop(cardId: string): void;
	live(): Set<string>;
}

export interface BoardDeps {
	store: BoardStore;
	runner: Runner;
	mcp?: () => McpInfo | null;
}

export interface CardInput {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	tags?: string[];
	lane?: Lane;
}

export interface CardPatch {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
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
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of raw) {
		const tag = trimmed(item).toLowerCase();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
};

export const newCardId = (at: number): string =>
	`c-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const newAgentId = (name: string, at: number): string => {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "agent";
	return `a-${slug}-${at.toString(36)}`;
};

export class BoardService {
	private readonly deps: BoardDeps;

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
		const siblings = laneCards(this.deps.store.cards(), lane);
		const card: Card = {
			...emptyCard(id, at),
			title,
			deliverable: trimmed(input.deliverable),
			spec: trimmed(input.spec),
			acceptance: trimmed(input.acceptance),
			tags: tagList(input.tags),
			lane,
			position: siblings.length === 0 ? 0 : siblings[siblings.length - 1].position + 1,
			notes: [{ at, kind: "system", text: "สร้างการ์ด" }],
		};
		this.deps.store.putCard(card);
		return card;
	}

	updateCard(id: string, patch: CardPatch): Card {
		const card = this.card(id);
		const next: Card = {
			...card,
			title: patch.title === undefined ? card.title : trimmed(patch.title) || card.title,
			deliverable: patch.deliverable === undefined ? card.deliverable : trimmed(patch.deliverable),
			spec: patch.spec === undefined ? card.spec : trimmed(patch.spec),
			acceptance: patch.acceptance === undefined ? card.acceptance : trimmed(patch.acceptance),
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

	setLane(id: string, lane: Lane): Card {
		const card = this.card(id);
		const next: Card = { ...card, lane, interrupted: false, updatedAt: stamp() };
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
		const card = this.card(id);
		if (!LANES.includes(lane)) throw new Error(`ไม่รู้จักคอลัมน์ ${lane}`);
		if (!canMove(card.lane, lane)) throw new Error(`ย้ายจาก ${card.lane} ไป ${lane} ไม่ได้`);
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
				this.release(card.assignee);
				this.release(card.reviewer);
				return addNote(
					{ ...card, lane, assignee: null, reviewer: null, question: null, answer: null, interrupted: false, verdict: null, updatedAt: at },
					{ at, kind: "move", text: "พักไว้ใน Backlog" },
				);
			}
			case "working": {
				const assignment = card.assignee ? null : pickAssignee(card, agents);
				const assignee = card.assignee ?? assignment?.agentId ?? null;
				let next: Card = { ...card, lane, assignee, interrupted: false, updatedAt: at };
				if (assignment) next = addNote(next, { at, kind: "move", text: `มอบหมายให้ ${assignment.agentId} — ${assignment.reason}` });
				const resumed = this.deps.runner.start(next, "implementer");
				next = addNote(next, {
					at,
					kind: "event",
					text: resumed ? (card.lane === "backlog" ? "เริ่มทำงาน" : "ทำงานต่อใน session เดิม") : "ยังไม่มี agent ว่าง งานรออยู่",
				});
				return next;
			}
			case "blocked": {
				this.deps.runner.stop(card.id);
				return addNote({ ...card, lane, updatedAt: at }, { at, kind: "blocked", text: "รอคำตอบจากคุณ" });
			}
			case "ready_to_test": {
				this.deps.runner.stop(card.id);
				const pick = card.reviewer ? null : pickReviewer(card, agents);
				const reviewer = card.reviewer ?? pick?.agentId ?? null;
				let next: Card = { ...card, lane, reviewer, verdict: null, question: null, updatedAt: at };
				next = addNote(
					next,
					{ at, kind: "review", text: reviewer ? `ส่งให้ ${reviewer} ตรวจ` : "งานเสร็จ รอคนตรวจ (ยังไม่มี agent ว่าง)" },
				);
				if (reviewer) this.deps.runner.start(next, "reviewer");
				return next;
			}
			case "fix": {
				this.deps.runner.stop(card.id);
				const next: Card = { ...card, lane, reviewer: null, verdict: "fail", updatedAt: at };
				return addNote(next, { at, kind: "review", text: "ตรวจไม่ผ่าน กลับไปแก้ที่ agent คนเดิม" });
			}
			case "done": {
				this.deps.runner.stop(card.id);
				this.release(card.assignee);
				this.release(card.reviewer);
				const next: Card = { ...card, lane, updatedAt: at };
				return addNote(next, { at, kind: "system", text: "ปิดงาน" });
			}
		}
	}

	reviewVerdict(id: string, text: string): Card {
		const verdict = readVerdict(text);
		const card = this.card(id);
		const at = stamp();
		const noted = addNote({ ...card, verdict: verdict ?? card.verdict, updatedAt: at }, {
			at,
			kind: "review",
			text: `ผลตรวจ: ${verdict ?? "ไม่ชัดเจน"} — ${text.split("\n")[0]?.slice(0, 300) ?? ""}`,
		});
		this.deps.store.putCard(noted);
		if (verdict === "pass") return this.moveCard(id, "done");
		if (verdict === "fail") return this.moveCard(id, "fix");
		return noted;
	}

	answer(id: string, answer: string): Card {
		const card = this.card(id);
		const text = trimmed(answer);
		if (!text) throw new Error("คำตอบว่างไม่ได้");
		const at = stamp();
		const noted = addNote({ ...card, answer: text, updatedAt: at }, { at, kind: "answer", text });
		this.deps.store.putCard(noted);
		return card.lane === "blocked" ? this.moveCard(id, "working") : noted;
	}

	resume(id: string): Card {
		const card = this.card(id);
		if (card.lane === "working" || card.lane === "fix") {
			const started = this.deps.runner.start(card, "implementer");
			return this.note(id, "event", started ? "ทำต่อใน session เดิม" : "ยังไม่มี agent ว่าง");
		}
		return this.moveCard(id, "working");
	}

	deleteCard(id: string): Card {
		const card = this.card(id);
		this.deps.runner.stop(id);
		this.release(card.assignee);
		this.release(card.reviewer);
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

	claim(agentId: string, cardId: string): Agent | null {
		const agent = this.deps.store.agent(agentId);
		if (!agent) return null;
		const next: Agent = { ...agent, state: "working", cardId, load: agent.load + 1, lastSeenAt: stamp() };
		this.deps.store.putAgent(next);
		return next;
	}

	release(agentId: string | null): void {
		if (!agentId) return;
		const agent = this.deps.store.agent(agentId);
		if (!agent) return;
		const busy = this.deps.store
			.cards()
			.filter((card) => card.lane === "working" && (card.assignee === agentId || card.reviewer === agentId));
		const next: Agent = {
			...agent,
			state: busy.length > 0 ? "working" : "idle",
			cardId: busy[0]?.id ?? null,
			load: Math.max(0, busy.length),
			lastSeenAt: stamp(),
		};
		this.deps.store.putAgent(next);
	}
}
