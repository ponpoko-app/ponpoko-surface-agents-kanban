import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BLOCK_HEADER,
	connectAgent,
	disconnectAgent,
	refreshConnections,
	scanAgents,
	type ConfigDeps,
} from "../backend/agent-config";

const dirs: string[] = [];

const home = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "kanban-home-"));
	dirs.push(dir);
	return dir;
};

const deps = (base: string, url = "http://127.0.0.1:51234/mcp", token = "t".repeat(32)): ConfigDeps => ({
	home: base,
	url,
	token,
	which: (command) => (["codex", "pi", "claude"].includes(command) ? `/usr/local/bin/${command}` : null),
	now: () => 1_700_000_000_000,
});

const codexPath = (base: string): string => join(base, ".codex", "config.toml");
const piPath = (base: string): string => join(base, ".pi", "agent", "mcp.json");

process.on("exit", () => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("what is on this machine", () => {
	test("installed agents are found and only the supported ones can be connected", () => {
		const base = home();
		const scanned = scanAgents(deps(base));
		expect(scanned.find((agent) => agent.kind === "codex")?.installed).toBe(true);
		expect(scanned.find((agent) => agent.kind === "codex")?.supported).toBe(true);
		expect(scanned.find((agent) => agent.kind === "claude")?.supported).toBe(false);
		expect(scanned.find((agent) => agent.kind === "opencode")?.installed).toBe(false);
	});

	test("before connecting, nothing claims the board endpoint", () => {
		const found = scanAgents(deps(home(), "http://127.0.0.1:6000/mcp"));
		expect(found.every((agent) => !agent.connected)).toBe(true);
	});
});

describe("writing the codex config", () => {
	test("connecting writes one block and keeps everything else in the file", () => {
		const base = home();
		const other = `model = "gpt-5"\n\n[mcp_servers.other]\nurl = "http://example.test/mcp"\n`;
		mkdirSync(join(base, ".codex"), { recursive: true });
		writeFileSync(codexPath(base), other);

		const result = connectAgent("codex", deps(base));
		expect(result.changed).toBe(true);
		const body = readFileSync(codexPath(base), "utf8");
		expect(body).toContain('model = "gpt-5"');
		expect(body).toContain("[mcp_servers.other]");
		expect(body.split(BLOCK_HEADER)).toHaveLength(2);
		expect(body).toContain("Authorization");
		expect(scanAgents(deps(base)).find((agent) => agent.kind === "codex")?.connected).toBe(true);
	});

	test("connecting twice changes nothing the second time and leaves one backup", () => {
		const base = home();
		const first = connectAgent("codex", deps(base));
		const backups = readdirSync(join(base, ".codex")).filter((name) => name.includes(".bak-"));
		const second = connectAgent("codex", deps(base));
		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
		expect(second.backup).toBeNull();
		expect(readdirSync(join(base, ".codex")).filter((name) => name.includes(".bak-"))).toEqual(backups);
		expect(readFileSync(codexPath(base), "utf8").split(BLOCK_HEADER)).toHaveLength(2);
	});

	test("disconnecting removes only our block", () => {
		const base = home();
		connectAgent("codex", deps(base));
		const removed = disconnectAgent("codex", deps(base));
		expect(removed.changed).toBe(true);
		expect(readFileSync(codexPath(base), "utf8")).not.toContain(BLOCK_HEADER);
		expect(scanAgents(deps(base)).find((agent) => agent.kind === "codex")?.connected).toBe(false);
	});
});

describe("writing the pi config", () => {
	test("connecting merges into existing servers instead of replacing them", () => {
		const base = home();
		mkdirSync(join(base, ".pi", "agent"), { recursive: true });
		writeFileSync(piPath(base), JSON.stringify({ mcpServers: { other: { url: "http://example.test" } } }, null, 2));
		connectAgent("pi", deps(base));
		const document = JSON.parse(readFileSync(piPath(base), "utf8"));
		expect(document.mcpServers.other.url).toBe("http://example.test");
		expect(document.mcpServers["agents-kanban"].url).toContain("127.0.0.1");
		expect(document.mcpServers["agents-kanban"].headers.Authorization).toStartWith("Bearer ");
	});

	test("a config we cannot parse is never overwritten", () => {
		const base = home();
		mkdirSync(join(base, ".pi", "agent"), { recursive: true });
		writeFileSync(piPath(base), "{ not json");
		expect(() => connectAgent("pi", deps(base))).toThrow(/ไม่ใช่ JSON/);
		expect(readFileSync(piPath(base), "utf8")).toBe("{ not json");
	});
});

describe("after a restart", () => {
	test("a new port is written into the configs that already point at this board", () => {
		const base = home();
		connectAgent("codex", deps(base, "http://127.0.0.1:50001/mcp"));
		connectAgent("pi", deps(base, "http://127.0.0.1:50001/mcp"));
		const written = refreshConnections(deps(base, "http://127.0.0.1:50002/mcp"));
		expect(written.map((item) => item.kind).sort()).toEqual(["codex", "pi"]);
		expect(readFileSync(codexPath(base), "utf8")).toContain("50002");
		expect(readFileSync(codexPath(base), "utf8").split(BLOCK_HEADER)).toHaveLength(2);
		expect(JSON.parse(readFileSync(piPath(base), "utf8")).mcpServers["agents-kanban"].url).toContain("50002");
		expect(existsSync(piPath(base))).toBe(true);
	});
});
