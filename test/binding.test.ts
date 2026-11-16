import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BINDING_FILE, loadBinding, newToken, saveBinding } from "../backend/binding";

const dirs: string[] = [];

const dir = (): string => {
	const path = mkdtempSync(join(tmpdir(), "kanban-binding-"));
	dirs.push(path);
	return path;
};

process.on("exit", () => {
	for (const path of dirs) rmSync(path, { recursive: true, force: true });
});

describe("the board's port and token", () => {
	test("a fresh data directory has no binding and gets a fresh token", () => {
		const path = dir();
		expect(loadBinding(path)).toBeNull();
		const token = newToken();
		expect(token).toHaveLength(48);
		expect(newToken()).not.toBe(token);
	});

	test("what was saved is what comes back after a restart", () => {
		const path = dir();
		saveBinding(path, { port: 51234, token: "a".repeat(48) });
		expect(loadBinding(path)).toEqual({ port: 51234, token: "a".repeat(48) });
	});

	test("the binding file is private to the user", () => {
		const path = dir();
		saveBinding(path, { port: 51234, token: "b".repeat(48) });
		const mode = statSync(join(path, BINDING_FILE)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("a damaged or partial binding is refused instead of guessed", () => {
		const path = dir();
		writeFileSync(join(path, BINDING_FILE), "{ not json");
		expect(loadBinding(path)).toBeNull();
		writeFileSync(join(path, BINDING_FILE), JSON.stringify({ port: 0, token: "c".repeat(48) }));
		expect(loadBinding(path)).toBeNull();
		writeFileSync(join(path, BINDING_FILE), JSON.stringify({ port: 51234, token: "short" }));
		expect(loadBinding(path)).toBeNull();
	});

	test("the file is plain JSON so a human can read it", () => {
		const path = dir();
		saveBinding(path, { port: 40000, token: "d".repeat(48) });
		const parsed = JSON.parse(readFileSync(join(path, BINDING_FILE), "utf8"));
		expect(parsed.port).toBe(40000);
	});
});
