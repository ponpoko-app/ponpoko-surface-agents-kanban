import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Attachments } from "../backend/attachments";
import { BoardService, type Runner } from "../backend/board";
import { BoardStore } from "../backend/store";
import type { Card, CardRole } from "../shared/board";

const dirs: string[] = [];

const open = (): { store: BoardStore; board: BoardService; runner: FakeRunner } => {
	const dir = mkdtempSync(join(tmpdir(), "kanban-board-"));
	dirs.push(dir);
	const store = new BoardStore(dir);
	const runner = new FakeRunner();
	const board = new BoardService({ store, runner, attachments: new Attachments(dir) });
	return { store, board, runner };
};

class FakeRunner implements Runner {
	readonly started: { id: string; role: CardRole }[] = [];

	readonly stopped: string[] = [];

	private readonly liveCards = new Set<string>();

	start(card: Card, role: CardRole): boolean {
		this.started.push({ id: card.id, role });
		this.liveCards.add(card.id);
		return true;
	}

	stop(cardId: string): void {
		this.stopped.push(cardId);
		this.liveCards.delete(cardId);
	}

	live(): Set<string> {
		return new Set(this.liveCards);
	}
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the card lifecycle", () => {
	test("a card starts in backlog and a drag to working puts a free agent on it", () => {
		const { board } = open();
		const worker = board.addAgent({ name: "codex-1", kind: "codex", capabilities: ["backend"] });
		const card = board.createCard({ title: "ปล่อย v0.1", tags: ["backend"] });
		expect(card.lane).toBe("backlog");
		expect(card.assignee).toBeNull();
		const moved = board.moveCard(card.id, "working");
		expect(moved.lane).toBe("working");
		expect(moved.assignee).toBe(worker.id);
	});

	test("the card keeps working without an agent instead of refusing the drag", () => {
		const { board, runner } = open();
		const card = board.createCard({ title: "งานที่ยังไม่มีคนทำ" });
		const moved = board.moveCard(card.id, "working");
		expect(moved.lane).toBe("working");
		expect(moved.assignee).toBeNull();
		expect(runner.started).toHaveLength(0);
		expect(moved.notes.at(-1)?.text).toContain("ยังไม่มี agent ว่าง");
	});

	test("an illegal transition is refused with a reason a person can read", () => {
		const { board } = open();
		const card = board.createCard({ title: "การ์ด" });
		board.moveCard(card.id, "working");
		expect(() => board.moveCard(card.id, "done")).toThrow(/ย้ายจาก/);
	});

	test("a blocked card returns to work with the human's answer attached", () => {
		const { board } = open();
		const card = board.createCard({ title: "ต้อง publish" });
		board.moveCard(card.id, "working");
		const blocked = board.moveCard(card.id, "blocked");
		expect(blocked.lane).toBe("blocked");
		const answered = board.answer(card.id, "ใช้ token ใน .env ได้");
		expect(answered.lane).toBe("working");
		expect(answered.answer).toBe("ใช้ token ใน .env ได้");
	});

	test("ready to test hands the card to an agent that did not build it", () => {
		const { board, runner } = open();
		const first = board.addAgent({ name: "codex-1", kind: "codex" });
		const second = board.addAgent({ name: "pi-1", kind: "pi" });
		const card = board.createCard({ title: "งาน" });
		board.moveCard(card.id, "working");
		const ready = board.moveCard(card.id, "ready_to_test");
		expect(ready.assignee).toBe(first.id);
		expect(ready.reviewer).toBe(second.id);
		expect(ready.reviewer).not.toBe(ready.assignee);
		expect(runner.started.some((call) => call.role === "reviewer")).toBe(true);
	});

	test("a pass closes the card and a fail sends it back to the same implementer", () => {
		const { board } = open();
		board.addAgent({ name: "codex-1", kind: "codex" });
		board.addAgent({ name: "pi-1", kind: "pi" });
		const passed = board.createCard({ title: "ผ่าน" });
		board.moveCard(passed.id, "working");
		board.moveCard(passed.id, "ready_to_test");
		const done = board.reviewVerdict(passed.id, "PASS\nทุกอย่างเรียบร้อย");
		expect(done.lane).toBe("done");

		const failed = board.createCard({ title: "ไม่ผ่าน" });
		const builder = board.moveCard(failed.id, "working").assignee;
		board.moveCard(failed.id, "ready_to_test");
		const fix = board.reviewVerdict(failed.id, "FAIL\nbuild แดง");
		expect(fix.lane).toBe("fix");
		expect(fix.assignee).toBe(builder);
		expect(fix.assignee).not.toBeNull();
	});

	test("a fix round keeps the implementer and their session so the resume is not a restart", () => {
		const { board, runner } = open();
		const worker = board.addAgent({ name: "codex-1", kind: "codex" });
		const card = board.createCard({ title: "งาน" });
		board.moveCard(card.id, "working");
		board.setSession(card.id, "implementer", "thread-42");
		board.moveCard(card.id, "ready_to_test");
		board.reviewVerdict(card.id, "FAIL\nอีกนิด");
		const resumed = board.moveCard(card.id, "working");
		expect(resumed.assignee).toBe(worker.id);
		expect(resumed.sessions.implementer).toBe("thread-42");
		expect(runner.started.some((call) => call.id === card.id && call.role === "implementer")).toBe(true);
	});
});

describe("the board survives a restart", () => {
	test("cards, agents, sessions and settings come back from the same data directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "kanban-store-"));
		dirs.push(dir);
		const store = new BoardStore(dir);
		const board = new BoardService({ store, runner: new FakeRunner(), attachments: new Attachments(dir) });
		const agent = board.addAgent({ name: "codex-1", kind: "codex", capabilities: ["backend"] });
		const card = board.createCard({ title: "ปล่อย v0.1", deliverable: "tag published", tags: ["backend"] });
		board.moveCard(card.id, "working");
		board.setSession(card.id, "implementer", "thread-7");
		board.settings({ repoPath: "/tmp/repo", maxConcurrent: 3 });
		store.close();

		const reopened = new BoardStore(dir);
		const cards = reopened.cards();
		expect(cards).toHaveLength(1);
		expect(cards[0].sessions.implementer).toBe("thread-7");
		expect(cards[0].lane).toBe("working");
		expect(cards[0].assignee).toBe(agent.id);
		expect(reopened.agents()).toHaveLength(1);
		expect(reopened.settings().repoPath).toBe("/tmp/repo");
		expect(reopened.settings().maxConcurrent).toBe(3);
		reopened.close();
	});

	test("notes stay bounded so a long session cannot grow one card forever", () => {
		const { board } = open();
		const card = board.createCard({ title: "ยาว" });
		for (let index = 0; index < 60; index += 1) board.note(card.id, "event", `ครั้งที่ ${index}`);
		const reloaded = board.card(card.id);
		expect(reloaded.notes.length).toBeLessThanOrEqual(40);
		expect(reloaded.notes.at(-1)?.text).toBe("ครั้งที่ 59");
	});
});
