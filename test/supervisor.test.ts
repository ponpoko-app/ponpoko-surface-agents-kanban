import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardService } from "../backend/board";
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
	const board = new BoardService({ store, runner: supervisor });
	board.settings({ repoPath: repo, maxConcurrent: 2, autoResume: true, autoAssign: true });
	return { store, board, supervisor };
};

let live: Setup;

beforeAll(() => {
	writeFileSync(pids, "");
	writeFileSync(argsFile, "");
	rmSync(repo, { recursive: true, force: true });
	Bun.spawnSync(["mkdir", "-p", repo]);
	const stub = join(root, "codex");
	writeFileSync(
		stub,
		[
			"#!/bin/sh",
			"printf '%s\\n' \"$$\" >> \"$KANBAN_TEST_PIDS\"",
			"printf '%s\\n' \"$*\" >> \"$KANBAN_TEST_ARGS\"",
			"echo '{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}'",
			"echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"command\":\"bun run build\",\"exit_code\":0}}'",
			"sleep 30",
			"",
		].join("\n"),
	);
	chmodSync(stub, 0o755);
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
});
