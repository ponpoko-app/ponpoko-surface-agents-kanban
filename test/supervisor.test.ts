import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Attachments } from "../backend/attachments";
import { BoardService } from "../backend/board";
import { Leases } from "../backend/leases";
import { BoardStore } from "../backend/store";
import { Supervisor } from "../backend/supervisor";

const root = mkdtempSync(join(tmpdir(), "kanban-supervisor-"));
const repo = join(root, "repo");
const pids = join(root, "pids.txt");
const argsFile = join(root, "args.txt");
const originalPath = process.env.PATH ?? "";

const waitFor = async (check: () => boolean, timeoutMs = 8000): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return true;
		await Bun.sleep(50);
	}
	return check();
};

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const rows = (path: string): string[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);
const git = (...args: string[]): string => {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
};

interface Setup {
	store: BoardStore;
	board: BoardService;
	supervisor: Supervisor;
}

const setup = (directory: string): Setup => {
	const store = new BoardStore(directory);
	const supervisor = new Supervisor({
		store,
		board: () => board,
		repoPath: () => store.settings().repoPath,
		cutoffMs: 2000,
	});
	const board = new BoardService({ store, runner: supervisor, attachments: new Attachments(directory) });
	board.settings({ repoPath: repo, maxConcurrent: 2, autoResume: true, autoAssign: true });
	return { store, board, supervisor };
};

let live: Setup;

beforeAll(() => {
	writeFileSync(pids, "");
	writeFileSync(argsFile, "");
	rmSync(repo, { recursive: true, force: true });
	Bun.spawnSync(["mkdir", "-p", repo]);
	git("init", "-q");
	writeFileSync(join(repo, "readme.txt"), "ต้นฉบับ\n");
	git("add", "readme.txt");
	git("-c", "user.name=Kanban", "-c", "user.email=kanban@example.test", "commit", "-qm", "เริ่มต้น");
	const stub = join(root, "codex");
	writeFileSync(
		stub,
		[
			"#!/bin/sh",
			"printf '%s\\n' \"$$\" >> \"$KANBAN_TEST_PIDS\"",
			"printf '%s\\n' \"$*\" >> \"$KANBAN_TEST_ARGS\"",
			"echo '{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}'",
			"echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"command\":\"bun run build\",\"exit_code\":0}}'",
			"if [ \"$KANBAN_TEST_WRITE_CWD\" = 1 ]; then printf '%s' \"$AGENTS_KANBAN_CARD_ID\" > card-work.txt; fi",
			"if [ \"$KANBAN_TEST_FAIL_CARD\" = \"$AGENTS_KANBAN_CARD_ID\" ]; then exit 23; fi",
			"sleep 30",
			"",
		].join("\n"),
	);
	chmodSync(stub, 0o755);
	const claude = join(root, "claude");
	writeFileSync(claude, [
		"#!/bin/sh",
		"echo '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"claude-เดิม\"}'",
		"echo '{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"rejected\",\"utilization\":1}}'",
		"printf '%s' \"$PWD\" > before.txt",
		"exit 1",
	].join("\n"));
	chmodSync(claude, 0o755);
	const gemini = join(root, "gemini");
	writeFileSync(gemini, [
		"#!/bin/sh",
		"printf '%s' \"$*\" > next-args.txt",
		"printf '%s' \"$PWD\" > after.txt",
		"echo '{\"type\":\"init\",\"session_id\":\"gemini-ใหม่\"}'",
		"sleep 30",
	].join("\n"));
	chmodSync(gemini, 0o755);
	process.env.PATH = `${root}:${originalPath}`;
	process.env.KANBAN_TEST_PIDS = pids;
	process.env.KANBAN_TEST_ARGS = argsFile;
	live = setup(join(root, "data"));
});

afterAll(async () => {
	live?.supervisor.stopAll();
	if (live) await waitFor(() => live.supervisor.live().size === 0, 6000);
	live?.store.close();
	process.env.PATH = originalPath;
	delete process.env.KANBAN_TEST_PIDS;
	delete process.env.KANBAN_TEST_ARGS;
	rmSync(root, { recursive: true, force: true });
});

describe("a card's worker process", () => {
	test("starting a card spawns the agent and records the session it reports", async () => {
		const agent = live.board.addAgent({ name: "codex-1", kind: "codex" });
		const card = live.board.createCard({ title: "ปล่อย v0.1", deliverable: "tag published" });
		const moved = live.board.moveCard(card.id, "working");
		expect(moved.assignee).toBe(agent.id);
		expect(await waitFor(() => rows(pids).length >= 1)).toBe(true);
		expect(live.supervisor.live().has(card.id)).toBe(true);
		expect(await waitFor(() => live.store.card(card.id)?.sessions.implementer === "thread-1")).toBe(true);
	});

	test("stopping the board kills the whole process group instead of orphaning it", async () => {
		const pid = Number(rows(pids)[0]);
		expect(alive(pid)).toBe(true);
		live.supervisor.stopAll();
		expect(await waitFor(() => !alive(pid), 6000)).toBe(true);
		expect(live.supervisor.live().size).toBe(0);
	});

	test("a card left mid-flight comes back interrupted and resumes the same session", async () => {
		const [card] = live.store.cards();
		live.store.putCard({ ...card, lane: "working", interrupted: false });
		const before = rows(argsFile).length;
		const swept = live.supervisor.sweep();
		expect(swept.map((item) => item.id)).toContain(card.id);
		expect(live.store.card(card.id)?.interrupted).toBe(true);
		expect(await waitFor(() => rows(argsFile).length > before)).toBe(true);
		const invocations = readFileSync(argsFile, "utf8");
		expect(invocations).toContain("resume thread-1");
		live.supervisor.stopAll();
	});

	test("a manual agent is never handed a card and never spawns anything", () => {
		const independent = setup(join(root, "manual"));
		independent.board.addAgent({ name: "ฉัน", kind: "manual" });
		const card = independent.board.createCard({ title: "งานของฉัน" });
		const moved = independent.board.moveCard(card.id, "working");
		expect(moved.assignee).toBeNull();
		expect(moved.lane).toBe("working");
		expect(independent.supervisor.live().size).toBe(0);
		expect(moved.notes.at(-1)?.text).toContain("ยังไม่มี agent ว่าง");
		independent.store.close();
	});

	test("คำตอบที่มาทันทีจะเปิด session เดิมหลัง process ที่ถูกพักจบ", async () => {
		const { board, store, supervisor } = setup(join(root, "answer"));
		try {
			board.addAgent({ name: "codex-answer", kind: "codex" });
			const { id } = board.createCard({ title: "เลือกผู้ชม" });
			board.moveCard(id, "working");
			expect(await waitFor(() => store.card(id)?.sessions.implementer === "thread-1")).toBe(true);
			const previousArgs = readFileSync(argsFile, "utf8").length;

			board.ask(id, { text: "ใครควรเห็นหน้านี้", options: ["ทีมภายใน", "ลูกค้า"], recommend: "ทีมภายใน" });
			board.answer(id, "ลูกค้า");
			expect(await waitFor(() => {
				const resumedArgs = readFileSync(argsFile, "utf8").slice(previousArgs);
				return resumedArgs.includes("resume thread-1") && resumedArgs.includes("คำตอบจากผู้ใช้: ลูกค้า");
			})).toBe(true);
			expect(store.card(id)).toMatchObject({ lane: "working", question: null, answer: "ลูกค้า" });
		} finally {
			supervisor.stopAll();
			await waitFor(() => supervisor.live().size === 0);
			store.close();
		}
	});

	test("agent สองตัวเขียนพร้อมกันคนละ worktree และ Git ไม่ลบงานที่ยังไม่ได้เก็บ", async () => {
		const { board, store, supervisor } = setup(join(root, "parallel"));
		process.env.KANBAN_TEST_WRITE_CWD = "1";
		try {
			board.addAgent({ name: "หนึ่ง", kind: "codex" });
			board.addAgent({ name: "สอง", kind: "codex" });
			const first = board.createCard({ title: "หนึ่ง" });
			const second = board.createCard({ title: "สอง" });
			board.moveCard(first.id, "working");
			board.moveCard(second.id, "working");
			const firstFile = join(store.root, "worktrees", first.id, "card-work.txt");
			const secondFile = join(store.root, "worktrees", second.id, "card-work.txt");
			expect(await waitFor(() => existsSync(firstFile) && existsSync(secondFile))).toBe(true);
			expect(readFileSync(firstFile, "utf8")).toBe(first.id);
			expect(readFileSync(secondFile, "utf8")).toBe(second.id);
			expect(supervisor.live()).toEqual(new Set([first.id, second.id]));
			expect(git("status", "--porcelain")).toBe("");
			expect(supervisor.sweep(false, Date.now() + 180_000)).toEqual([]);
			supervisor.stopAll();
			expect(await waitFor(() => supervisor.live().size === 0)).toBe(true);
			expect(() => board.deleteCard(first.id)).toThrow(/เก็บงาน/);
			expect(readFileSync(firstFile, "utf8")).toBe(first.id);
			rmSync(firstFile);
			board.deleteCard(first.id);
			expect(existsSync(join(store.root, "worktrees", first.id))).toBe(false);
			expect(git("show-ref", "--verify", `refs/heads/agents-kanban/${first.id}`)).toContain(first.id);
		} finally {
			delete process.env.KANBAN_TEST_WRITE_CWD;
			supervisor.stopAll();
			await waitFor(() => supervisor.live().size === 0);
			store.close();
		}
	});

	test("agent ที่ตายยังถือสิทธิ์ถึง TTL หลังจากนั้นการ์ดกลับ Backlog และสิทธิ์เดิมใช้ไม่ได้", async () => {
		const { board, store, supervisor } = setup(join(root, "lease"));
		try {
			const agent = board.addAgent({ name: "agent-lease", kind: "codex" });
			const { id } = board.createCard({ title: "งานที่ถูกขัดจังหวะ" });
			process.env.KANBAN_TEST_FAIL_CARD = id;
			board.moveCard(id, "working");
			const leases = new Leases(store);
			const lease = leases.get(id)!;
			expect(leases.acquire(id, "อีกตัว", "implementer")).toBeNull();
			expect(leases.acquire("อีกใบ", agent.id, "implementer")).toBeNull();
			expect(() => supervisor.useLease(id, "ผิด")).toThrow(/สิทธิ์/);
			supervisor.useLease(id, lease.token);
			expect(await waitFor(() => !supervisor.live().has(id))).toBe(true);
			expect(supervisor.sweep(false)).toEqual([]);
			expect(board.card(id).lane).toBe("working");
			expect(supervisor.sweep(false, Date.now() + 91_000).map((card) => card.id)).toEqual([id]);
			expect(board.card(id)).toMatchObject({ lane: "backlog", assignee: null });
			expect(board.card(id).notes.at(-1)?.text).toContain("สิทธิ์หมดอายุ");
			expect(() => supervisor.useLease(id, lease.token)).toThrow(/หมดอายุ/);
		} finally {
			delete process.env.KANBAN_TEST_FAIL_CARD;
			supervisor.stopAll();
			await waitFor(() => supervisor.live().size === 0);
			store.close();
		}
	});

	test("ติดโควตาแล้วส่งให้ผู้ให้บริการถัดไปใน worktree เดิมโดยเปิด session ใหม่", async () => {
		const { board, store, supervisor } = setup(join(root, "quota"));
		try {
			const claude = board.addAgent({ name: "1-claude", kind: "claude" });
			const gemini = board.addAgent({ name: "2-gemini", kind: "gemini" });
			const card = board.createCard({ title: "ส่งต่อเมื่อเต็มโควตา" });
			expect(board.moveCard(card.id, "working").assignee).toBe(claude.id);
			expect(await waitFor(() => store.card(card.id)?.sessions.implementer === "gemini-ใหม่")).toBe(true);
			const cwd = join(store.root, "worktrees", card.id);
			expect(board.card(card.id).assignee).toBe(gemini.id);
			expect(readFileSync(join(cwd, "before.txt"), "utf8")).toBe(readFileSync(join(cwd, "after.txt"), "utf8"));
			expect(readFileSync(join(cwd, "next-args.txt"), "utf8")).not.toContain("--resume");
			expect(supervisor.usage().find(({ kind }) => kind === "claude")).toMatchObject({ runs: 1, used_fraction: 1 });
			expect(supervisor.usage().find(({ kind }) => kind === "claude")!.saturatedUntil).toBeGreaterThan(Date.now());
			expect(supervisor.usage().find(({ kind }) => kind === "gemini")).toMatchObject({ runs: 1, used_fraction: null });
		} finally {
			supervisor.stopAll();
			await waitFor(() => supervisor.live().size === 0);
			store.close();
		}
	});
});
