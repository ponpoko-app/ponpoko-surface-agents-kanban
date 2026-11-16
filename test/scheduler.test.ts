import { describe, expect, test } from "bun:test";
import {
	emptyCard,
	pickAssignee,
	pickReviewer,
	readVerdict,
	sessionName,
	type Agent,
	type Card,
} from "../shared/board";

const agent = (id: string, overrides: Partial<Agent> = {}): Agent => ({
	id,
	name: id.toUpperCase(),
	kind: "codex",
	capabilities: [],
	state: "idle",
	cardId: null,
	load: 0,
	lastSeenAt: 1,
	source: "board",
	...overrides,
});

const card = (overrides: Partial<Card> = {}): Card => ({ ...emptyCard("c-1", 1000), title: "งาน", ...overrides });

describe("who gets the work", () => {
	test("a busy board assigns nothing and says so by returning null", () => {
		const agents = [agent("a", { state: "working", cardId: "c-9" }), agent("b", { state: "offline" })];
		expect(pickAssignee(card(), agents)).toBeNull();
	});

	test("the lightest free agent wins, and ties break on name so the choice is repeatable", () => {
		const agents = [agent("z", { load: 2 }), agent("b", { load: 0 }), agent("a", { load: 0 })];
		const first = pickAssignee(card(), agents);
		const again = pickAssignee(card(), [...agents].reverse());
		expect(first?.agentId).toBe("a");
		expect(again?.agentId).toBe("a");
	});

	test("capabilities filter the board: an agent that fits none of the tags is never chosen", () => {
		const agents = [agent("front", { capabilities: ["frontend"] }), agent("back", { capabilities: ["backend"] })];
		expect(pickAssignee(card({ tags: ["backend"] }), agents)?.agentId).toBe("back");
		expect(pickAssignee(card({ tags: ["design"] }), agents)).toBeNull();
	});

	test("a manual agent is never handed work, even when it is the only one free", () => {
		expect(pickAssignee(card(), [agent("me", { kind: "manual" })])).toBeNull();
	});

	test("the reason names why that agent was picked", () => {
		const pick = pickAssignee(card({ tags: ["backend"] }), [agent("back", { capabilities: ["backend"] })]);
		expect(pick?.reason).toContain("backend");
	});
});

describe("who checks the work", () => {
	test("the implementer can never review its own card", () => {
		const workers = [agent("w", { state: "working", cardId: "c-1" })];
		expect(pickReviewer(card({ assignee: "w" }), workers)).toBeNull();
	});

	test("the reviewer is a different, free agent", () => {
		const agents = [agent("w", { state: "working", cardId: "c-1" }), agent("r")];
		expect(pickReviewer(card({ assignee: "w" }), agents)?.agentId).toBe("r");
	});

	test("a second review round never falls back to the implementer", () => {
		const agents = [agent("w", { state: "working", cardId: "c-1" }), agent("r")];
		const pick = pickReviewer(card({ assignee: "w", sessions: { implementer: "w", reviewer: "r" } }), agents);
		expect(pick?.agentId).toBe("r");
		expect(pick?.agentId).not.toBe("w");
	});
});

describe("reading a reviewer's answer", () => {
	test("the verdict is the first meaningful word, with or without markdown or Thai", () => {
		expect(readVerdict("PASS\nlooks fine")).toBe("pass");
		expect(readVerdict("**FAIL**: build broke")).toBe("fail");
		expect(readVerdict("ผ่าน\nเรียบร้อย")).toBe("pass");
		expect(readVerdict("ไม่ผ่าน เพราะ test แดง")).toBe("fail");
	});

	test("an answer without a verdict is not treated as a pass", () => {
		expect(readVerdict("please look at this again")).toBeNull();
		expect(readVerdict("")).toBeNull();
	});

	test("the card's session name is stable and role-specific", () => {
		expect(sessionName("c-1", "implementer")).toBe("kanban-c-1-implementer");
		expect(sessionName("c-1", "reviewer")).not.toBe(sessionName("c-1", "implementer"));
	});
});
