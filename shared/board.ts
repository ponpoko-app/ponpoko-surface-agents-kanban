export const LANES = ["backlog", "working", "blocked", "ready_to_test", "fix", "done"] as const;

export type Lane = (typeof LANES)[number];

export const LANE_LABELS: Record<Lane, string> = {
	backlog: "Backlog",
	working: "Working",
	blocked: "Blocked",
	ready_to_test: "Ready to test",
	fix: "Fix",
	done: "Done",
};

export const LANE_HINTS: Record<Lane, string> = {
	backlog: "การ์ดที่ยังไม่มีใครทำ ลากไป Working เพื่อเริ่ม",
	working: "agent กำลังทำงานอยู่บน session ของการ์ดนี้",
	blocked: "รอคำตอบจากคุณ — ตอบในหน้าการ์ดแล้ว agent จะทำต่อ",
	ready_to_test: "รอรันคำสั่งตรวจจากการ์ด",
	fix: "กลับไปแก้ในการ์ดเดิม",
	done: "ปิดงานแล้ว",
};

export const AGENT_KINDS = ["codex", "pi", "manual"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_LABELS: Record<AgentKind, string> = {
	codex: "Codex (ChatGPT plan)",
	pi: "pi (Synthetic)",
	manual: "ฉันเอง (ไม่มี session)",
};

export const AGENT_COMMANDS: Record<AgentKind, string> = {
	codex: "codex exec --json -s workspace-write -C <repo>",
	pi: "pi -p --mode json --session-id <card>",
	manual: "",
};

export type AgentState = "idle" | "working" | "offline";

export interface Agent {
	id: string;
	name: string;
	kind: AgentKind;
	capabilities: string[];
	state: AgentState;
	cardId: string | null;
	load: number;
	lastSeenAt: number;
	source: "board" | "mcp";
}

export type CardRole = "implementer" | "reviewer";

export interface CardSessions {
	implementer: string | null;
	reviewer: string | null;
}

export type NoteKind = "note" | "move" | "event" | "review" | "blocked" | "answer" | "system";

export interface CardNote {
	at: number;
	kind: NoteKind;
	text: string;
}

export interface Attachment {
	id: string;
	name: string;
	mime: string;
	bytes: number;
	createdAt: number;
}

export interface CardQuestion {
	text: string;
	options: string[];
	recommend: string;
	kind: "decision" | "problem";
	askedAt: number;
}

export interface Card {
	id: string;
	title: string;
	deliverable: string;
	spec: string;
	acceptance: string;
	checks: string[];
	tags: string[];
	lane: Lane;
	position: number;
	assignee: string | null;
	reviewer: string | null;
	sessions: CardSessions;
	question: CardQuestion | null;
	answer: string | null;
	verdict: string | null;
	interrupted: boolean;
	attachments: Attachment[];
	notes: CardNote[];
	createdAt: number;
	updatedAt: number;
}

export interface Settings {
	repoPath: string;
	autoAssign: boolean;
	autoResume: boolean;
	maxConcurrent: number;
}

export const DEFAULT_SETTINGS: Settings = {
	repoPath: "",
	autoAssign: true,
	autoResume: true,
	maxConcurrent: 2,
};

export interface McpInfo {
	url: string;
	token: string;
	codex: string | null;
	pi: string | null;
}

export interface ScannedAgent {
	kind: string;
	label: string;
	installed: boolean;
	supported: boolean;
	configPath: string;
	connected: boolean;
	detail: string;
}

export interface BoardSnapshot {
	cards: Card[];
	agents: Agent[];
	settings: Settings;
	mcp: McpInfo | null;
	at: number;
}

export const MOVES: Record<Lane, readonly Lane[]> = {
	backlog: ["working"],
	working: ["ready_to_test", "blocked", "backlog"],
	blocked: ["working", "backlog"],
	ready_to_test: ["done", "fix", "working"],
	fix: ["working", "ready_to_test", "backlog"],
	done: ["ready_to_test", "backlog"],
};

export const canMove = (from: Lane, to: Lane): boolean => from === to || MOVES[from].includes(to);

export const moveTargets = (from: Lane): readonly Lane[] => MOVES[from];

export const laneCards = (cards: readonly Card[], lane: Lane): Card[] =>
	cards
		.filter((card) => card.lane === lane)
		.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export interface Pick {
	agentId: string;
	reason: string;
}

const free = (agent: Agent): boolean => agent.state !== "offline" && agent.cardId === null;

export const agentFits = (agent: Agent, tags: readonly string[]): boolean => {
	if (tags.length === 0) return true;
	const held = new Set(agent.capabilities.map((tag) => tag.trim().toLowerCase()));
	return tags.every((tag) => held.has(tag.trim().toLowerCase()));
};

const order = (agents: readonly Agent[]): Agent[] =>
	[...agents].sort(
		(a, b) => a.load - b.load || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
	);

const reasonFor = (tags: readonly string[]): string =>
	tags.length === 0
		? `ว่าง และไม่มีงานค้าง`
		: `ว่าง และถนัด ${tags.join(", ")}`;

export const assigneeCandidates = (card: Card, agents: readonly Agent[]): Agent[] =>
	order(
		agents.filter(
			(agent) =>
				agent.kind !== "manual" &&
				free(agent) &&
				agent.id !== card.assignee &&
				agent.id !== card.reviewer &&
				agentFits(agent, card.tags),
		),
	);

export const pickAssignee = (card: Card, agents: readonly Agent[]): Pick | null => {
	const chosen = assigneeCandidates(card, agents)[0];
	return chosen ? { agentId: chosen.id, reason: reasonFor(card.tags) } : null;
};

export const pickReviewer = (card: Card, agents: readonly Agent[]): Pick | null => {
	const excluded = new Set([card.assignee, card.sessions.implementer].filter(Boolean) as string[]);
	const seen = new Set<Agent>();
	for (const agent of order(agents)) {
		if (agent.kind === "manual" || !free(agent)) continue;
		if (excluded.has(agent.id)) continue;
		if (seen.has(agent)) continue;
		seen.add(agent);
		return { agentId: agent.id, reason: `ไม่ได้เป็นคนทำการ์ดนี้ จึงตรวจได้` };
	}
	return null;
};

export const sessionName = (cardId: string, role: CardRole): string => `kanban-${cardId}-${role}`;

const PASS = /^(pass|passed|ok)\b/i;
const PASS_TH = /^ผ่าน/;
const FAIL = /^(fail|failed|reject)\b/i;
const FAIL_TH = /^ไม่ผ่าน/;

export const readVerdict = (text: string): "pass" | "fail" | null => {
	const line = text
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part.length > 0);
	if (!line) return null;
	const clean = line.replace(/^[#*\-\s]+/, "").replace(/[:：].*$/, "").trim();
	if (FAIL.test(clean) || FAIL_TH.test(clean)) return "fail";
	if (PASS.test(clean) || PASS_TH.test(clean)) return "pass";
	return null;
};

export const emptyCard = (id: string, at: number): Card => ({
	id,
	title: "",
	deliverable: "",
	spec: "",
	acceptance: "",
	checks: [],
	tags: [],
	lane: "backlog",
	position: at,
	assignee: null,
	reviewer: null,
	sessions: { implementer: null, reviewer: null },
	question: null,
	answer: null,
	verdict: null,
	interrupted: false,
	attachments: [],
	notes: [],
	createdAt: at,
	updatedAt: at,
});

export const MAX_NOTES = 40;

export const addNote = (card: Card, note: CardNote): Card => ({
	...card,
	notes: [...card.notes, note].slice(-MAX_NOTES),
	updatedAt: note.at,
});

export const isActionable = (card: Card): boolean => card.lane === "backlog" || card.lane === "working" || card.lane === "fix";
