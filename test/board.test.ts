import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Attachments } from "../backend/attachments";
import { BoardService, type Runner } from "../backend/board";
import type { CheckResult } from "../backend/checks";
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
	check = async (card: Card): Promise<CheckResult[]> => card.checks.map((command) => ({
		command, exit: command === "ตรวจไม่ผ่าน" ? 7 : 0, timedOut: false, output: "ผลจากตัวตรวจ",
	}));

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

	test("การ์ดพร้อมตรวจโดยไม่ต้องจอง agent อีกตัว", () => {
		const { board, runner } = open();
		const first = board.addAgent({ name: "codex-1", kind: "codex" });
		board.addAgent({ name: "pi-1", kind: "pi" });
		const card = board.createCard({ title: "งาน" });
		board.moveCard(card.id, "working");
		const ready = board.moveCard(card.id, "ready_to_test");
		expect(ready.assignee).toBe(first.id);
		expect(ready.reviewer).toBeNull();
		expect(runner.started.map((call) => call.role)).toEqual(["implementer"]);
	});

	test("บอร์ดใช้ผลคำสั่งตรวจเป็นหลักและเก็บหลักฐานไว้บนการ์ด", async () => {
		const { board } = open();
		board.addAgent({ name: "codex-1", kind: "codex" });
		board.addAgent({ name: "pi-1", kind: "pi" });
		const passed = board.createCard({ title: "ผ่าน" });
		board.moveCard(passed.id, "working");
		board.moveCard(passed.id, "ready_to_test");
		expect(board.reviewVerdict(passed.id, "PASS\nทุกอย่างเรียบร้อย").lane).toBe("ready_to_test");
		await expect(board.submit(passed.id)).rejects.toThrow(/เพิ่มคำสั่งตรวจ/);
		const done = await board.submit(passed.id, ["ตรวจผ่าน"]);
		expect(done.lane).toBe("done");
		expect(done.checks).toEqual(["ตรวจผ่าน"]);

		const failed = board.createCard({ title: "ไม่ผ่าน" });
		const builder = board.moveCard(failed.id, "working").assignee;
		board.moveCard(failed.id, "ready_to_test");
		const result = await board.submit(failed.id, ["ตรวจไม่ผ่าน"]);
		expect(result.lane).toBe("ready_to_test");
		expect(result.assignee).toBe(builder);
		expect(result.notes.some(({ text }) => text === "ตรวจไม่ผ่าน · exit 7\nผลจากตัวตรวจ")).toBe(true);
	});

	test("a fix round keeps the implementer and their session so the resume is not a restart", () => {
		const { board, runner } = open();
		const worker = board.addAgent({ name: "codex-1", kind: "codex" });
		const card = board.createCard({ title: "งาน" });
		board.moveCard(card.id, "working");
		board.setSession(card.id, "implementer", "thread-42");
		board.moveCard(card.id, "ready_to_test");
		board.moveCard(card.id, "fix");
		const resumed = board.moveCard(card.id, "working");
		expect(resumed.assignee).toBe(worker.id);
		expect(resumed.sessions.implementer).toBe("thread-42");
		expect(runner.started.some((call) => call.id === card.id && call.role === "implementer")).toBe(true);
	});
});

describe("คำถามบนการ์ด", () => {
	const question = { text: "ใครควรเห็นหน้าใหม่", options: ["ทีมภายใน", "ลูกค้า"], recommend: "ทีมภายใน" };

	test("คำถามหยุดการทำงานและคำตอบล้างคำถามก่อนส่งงานคืนให้ agent", () => {
		const { board, runner } = open();
		board.addAgent({ name: "codex-1", kind: "codex" });
		const { id } = board.createCard({ title: "หน้าใหม่" });
		board.moveCard(id, "working");
		const asked = board.ask(id, question);
		expect(asked.lane).toBe("blocked");
		expect(asked.question).toEqual({ ...question, kind: "decision", askedAt: asked.updatedAt });
		expect(board.snapshot().cards[0].question).toEqual(asked.question);
		expect(runner.stopped).toEqual([id]);
		expect(() => board.answer(id, " ")).toThrow(/คำตอบว่าง/);
		expect(board.card(id).question).toEqual(asked.question);

		const answered = board.answer(id, "ลูกค้า");
		expect(answered.lane).toBe("working");
		expect(answered.answer).toBe("ลูกค้า");
		expect(answered.question).toBeNull();
		expect(board.card(id)).toEqual(answered);
		expect(runner.started).toEqual([{ id, role: "implementer" }, { id, role: "implementer" }]);

		const next = board.ask(id, { ...question, kind: "problem" });
		expect(next.answer).toBeNull();
		expect(next.question?.kind).toBe("problem");
	});

	test("คำถามผิดรูปแบบและการ์ดที่ยังไม่ทำงานไม่เปลี่ยนสถานะหรือหยุด agent", () => {
		const { board, runner } = open();
		const { id } = board.createCard({ title: "หน้าใหม่" });
		expect(() => board.ask(id, question)).toThrow(/ย้ายจาก/);
		const working = board.moveCard(id, "working");
		expect(() => board.ask(id, { ...question, options: ["ทีมภายใน"] })).toThrow(/อย่างน้อย 2/);
		expect(() => board.ask(id, { ...question, options: ["ทีมภายใน", " ทีมภายใน "] })).toThrow(/ต่างกัน/);
		expect(() => board.ask(id, { ...question, recommend: undefined })).toThrow(/คำแนะนำ/);
		expect(() => board.ask(id, { ...question, recommend: "ทุกคน" })).toThrow(/คำแนะนำ/);
		expect(board.card(id)).toEqual(working);
		expect(runner.stopped).toEqual([]);
	});

	test("คำถามแบบข้อความที่บันทึกไว้ยังแสดงและตอบจากการ์ดเดิมได้", () => {
		const { board, store } = open();
		const blocked = board.createCard({ title: "หน้าเดิม", lane: "blocked" });
		const legacy = "ขอพาธของโปรเจกต์";
		store.db.query("UPDATE cards SET json = ? WHERE id = ?").run(JSON.stringify({ ...blocked, question: legacy }), blocked.id);
		expect(board.snapshot().cards[0].question).toEqual({
			text: legacy, options: [], recommend: "", kind: "problem", askedAt: blocked.updatedAt,
		});
		expect(board.answer(blocked.id, "/tmp/project")).toMatchObject({ lane: "working", question: null, answer: "/tmp/project" });
		store.close();
	});

	test("คำตอบที่ค้างจากคำถามก่อนจะเปลี่ยนคำถามล่าสุดหรือคำตอบที่บันทึกแล้วไม่ได้", () => {
		const { board } = open();
		const { id } = board.createCard({ title: "หน้าใหม่", lane: "working" });
		const now = Date.now();
		using clock = spyOn(Date, "now");
		clock.mockReturnValue(now);
		const first = board.ask(id, question).question!;
		const latest = board.ask(id, { ...question, text: "ใครควรแก้หน้าใหม่" }).question!;
		expect(latest.askedAt).toBeGreaterThan(first.askedAt);
		expect(() => board.answer(id, first.recommend, first.askedAt)).toThrow(/คำถามเปลี่ยนแล้ว/);
		expect(board.card(id).question).toEqual(latest);
		expect(board.answer(id, "ลูกค้า", latest.askedAt).lane).toBe("working");
		expect(() => board.answer(id, "ทีมภายใน", latest.askedAt)).toThrow(/คำถามเปลี่ยนแล้ว/);
		expect(board.card(id).answer).toBe("ลูกค้า");

		const next = board.ask(id, question).question!;
		expect(next.askedAt).toBeGreaterThan(latest.askedAt);
		expect(() => board.answer(id, "ลูกค้า", latest.askedAt)).toThrow(/คำถามเปลี่ยนแล้ว/);
		expect(board.card(id).question).toEqual(next);
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
