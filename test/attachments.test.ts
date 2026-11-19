import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLaunch, buildMessage, type MediaRef } from "../backend/agents";
import { Attachments, MAX_ATTACHMENT_BYTES, detectImage } from "../backend/attachments";
import { BoardService, type Runner } from "../backend/board";
import { BoardStore } from "../backend/store";
import type { Card, CardRole } from "../shared/board";

const PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	),
);

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

class NoRunner implements Runner {
	start(): boolean {
		return true;
	}

	stop(): void {}

	live(): Set<string> {
		return new Set();
	}
}

const open = (): { dir: string; store: BoardStore; board: BoardService; files: Attachments } => {
	const dir = mkdtempSync(join(tmpdir(), "kanban-attach-"));
	const store = new BoardStore(dir);
	const files = new Attachments(dir);
	const board = new BoardService({ store, runner: new NoRunner(), attachments: files });
	return { dir, store, board, files };
};

const clean = (dir: string): void => rmSync(dir, { recursive: true, force: true });

describe("storing a screenshot", () => {
	test("the bytes land on disk and come back unchanged", () => {
		const { dir, board, files } = open();
		const card = board.createCard({ title: "บั๊กตอนกดบันทึก" });
		const stored = board.attach(card.id, { name: "bug.png", data_base64: base64(PNG) });
		expect(stored.attachments).toHaveLength(1);
		const attachment = stored.attachments[0];
		expect(attachment.mime).toBe("image/png");
		expect(attachment.bytes).toBe(PNG.length);
		expect(attachment.name).toBe("bug.png");
		expect(files.cardFiles(card.id)).toHaveLength(1);
		expect(readFileSync(files.fileFor(card.id, attachment))).toEqual(Buffer.from(PNG));
		expect(board.attachmentData(card.id, attachment.id).data_base64).toBe(base64(PNG));
		clean(dir);
	});

	test("a card keeps its images across a restart", () => {
		const { dir, board, store } = open();
		const card = board.createCard({ title: "requirement UI" });
		board.attach(card.id, { name: "mock.png", data_base64: base64(PNG) });
		store.close();
		const reopened = new BoardStore(dir);
		const reloaded = reopened.card(card.id);
		expect(reloaded?.attachments).toHaveLength(1);
		expect(reloaded?.attachments[0].name).toBe("mock.png");
		reopened.close();
		clean(dir);
	});

	test("the card's notes say an image was attached", () => {
		const { dir, board } = open();
		const card = board.createCard({ title: "x" });
		const stored = board.attach(card.id, { name: "shot.png", data_base64: base64(PNG) });
		expect(stored.notes.at(-1)?.text).toContain("shot.png");
		clean(dir);
	});
});

describe("refusing what does not belong", () => {
	test("a text file is refused by name and nothing is written", () => {
		const files = new Attachments(mkdtempSync(join(tmpdir(), "kanban-refuse-")));
		expect(() => files.save("c-1", { name: "notes.txt", data_base64: base64(Uint8Array.from(Buffer.from("hello"))) })).toThrow(/ไม่ใช่รูป/);
		expect(files.cardFiles("c-1")).toHaveLength(0);
	});

	test("an oversized image is refused before it touches the disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "kanban-big-"));
		const files = new Attachments(dir);
		const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1024);
		big.set(PNG.subarray(0, 16));
		expect(() => files.save("c-1", { name: "huge.png", data_base64: base64(big) })).toThrow(/ใหญ่เกิน/);
		expect(files.cardFiles("c-1")).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	test("the image type is read from the bytes, not from what the caller claims", () => {
		expect(detectImage(PNG)?.mime).toBe("image/png");
		expect(detectImage(Uint8Array.from(Buffer.from("not an image at all")))).toBeNull();
		const dir = mkdtempSync(join(tmpdir(), "kanban-sniff-"));
		const files = new Attachments(dir);
		const saved = files.save("c-1", { name: "wrong.jpg", data_base64: base64(PNG) });
		expect(saved.attachment.mime).toBe("image/png");
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("removing images", () => {
	test("detaching deletes the file and keeps the others", () => {
		const { dir, board, files } = open();
		const card = board.createCard({ title: "สองรูป" });
		const firstId = board.attach(card.id, { name: "a.png", data_base64: base64(PNG) }).attachments[0].id;
		const secondId = board.attach(card.id, { name: "b.png", data_base64: base64(PNG) }).attachments[1].id;
		const remaining = board.detach(card.id, firstId);
		expect(remaining.attachments.map((item) => item.id)).toEqual([secondId]);
		expect(files.cardFiles(card.id)).toHaveLength(1);
		clean(dir);
	});

	test("deleting a card takes its images with it", () => {
		const { dir, board, files } = open();
		const card = board.createCard({ title: "จะถูกลบ" });
		board.attach(card.id, { name: "c.png", data_base64: base64(PNG) });
		expect(files.cardFiles(card.id)).toHaveLength(1);
		board.deleteCard(card.id);
		expect(files.cardFiles(card.id)).toHaveLength(0);
		expect(existsSync(join(dir, "attachments", card.id))).toBe(false);
		clean(dir);
	});
});

describe("the agent sees the image", () => {
	const card: Card = {
		id: "c-1",
		title: "บั๊กปุ่มบันทึก",
		deliverable: "กดบันทึกแล้วไม่ค้าง",
		spec: "",
		acceptance: "",
		checks: [],
		tags: [],
		lane: "working",
		position: 0,
		assignee: "a-1",
		reviewer: null,
		sessions: { implementer: null, reviewer: null },
		question: null,
		answer: null,
		verdict: null,
		interrupted: false,
		attachments: [{ id: "att-1", name: "bug.png", mime: "image/png", bytes: 70, createdAt: 1 }],
		notes: [],
		createdAt: 1,
		updatedAt: 1,
	};

	const images: MediaRef[] = [{ name: "bug.png", path: "/data/attachments/c-1/att-1.png" }];

	test("the prompt names every attached file so the agent opens it first", () => {
		const message = buildMessage(card, "implementer", "start", { images });
		expect(message).toContain("/data/attachments/c-1/att-1.png");
		expect(message).toContain("bug.png");
		expect(message.toLowerCase()).toContain("รูปแนบ");
	});

	test("codex is handed the image with --image on the first run and on a resume", () => {
		const opts = { card, role: "implementer" as CardRole, phase: "start" as const, message: "ทำต่อ", repoPath: "/repo", sessionId: null, images };
		const start = buildLaunch("codex", opts);
		expect(start.args).toContain("-i");
		expect(start.args.join(" ")).toContain("/data/attachments/c-1/att-1.png");
		const resume = buildLaunch("codex", { ...opts, phase: "resume", sessionId: "thread-1" });
		expect(resume.args[0]).toBe("exec");
		expect(resume.args).toContain("resume");
		expect(resume.args.join(" ")).toContain("/data/attachments/c-1/att-1.png");
	});

	test("pi gets the paths inside the message, which it can open with its own tools", () => {
		const launch = buildLaunch("pi", { card, role: "reviewer", phase: "review", message: buildMessage(card, "reviewer", "review", { images }), repoPath: "/repo", sessionId: "kanban-c-1-reviewer", images });
		expect(launch.args.join(" ")).toContain("/data/attachments/c-1/att-1.png");
	});

	test("a card without images adds nothing to the prompt", () => {
		const message = buildMessage({ ...card, attachments: [] }, "implementer", "start");
		expect(message.toLowerCase()).not.toContain("รูปแนบ");
	});
});
