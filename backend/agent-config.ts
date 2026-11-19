import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SERVER_NAME = "agents-kanban";

export const BLOCK_HEADER = `[mcp_servers.${SERVER_NAME}]`;

export interface AgentTarget {
	kind: string;
	label: string;
	command: string;
	configPath: (home: string) => string;
	format: "toml" | "json" | "unsupported";
}

export const TARGETS: AgentTarget[] = [
	{
		kind: "codex",
		label: "Codex",
		command: "codex",
		configPath: (home) => join(process.env.CODEX_HOME ?? join(home, ".codex"), "config.toml"),
		format: "toml",
	},
	{
		kind: "pi",
		label: "pi",
		command: "pi",
		configPath: (home) => join(home, ".pi", "agent", "mcp.json"),
		format: "json",
	},
	{
		kind: "claude",
		label: "Claude Code",
		command: "claude",
		configPath: (home) => join(home, ".claude.json"),
		format: "unsupported",
	},
	{
		kind: "gemini",
		label: "Gemini CLI",
		command: "gemini",
		configPath: (home) => join(home, ".gemini", "settings.json"),
		format: "unsupported",
	},
	{
		kind: "opencode",
		label: "opencode",
		command: "opencode",
		configPath: (home) => join(home, ".config", "opencode", "opencode.json"),
		format: "unsupported",
	},
	{
		kind: "qwen",
		label: "Qwen Code",
		command: "qwen",
		configPath: (home) => join(home, ".qwen", "settings.json"),
		format: "unsupported",
	},
];

export interface DetectedAgent {
	kind: string;
	label: string;
	installed: boolean;
	supported: boolean;
	configPath: string;
	connected: boolean;
	detail: string;
}

export interface ConfigDeps {
	home: string;
	url: string;
	token: string;
	which?: (command: string) => string | null;
	now?: () => number;
}

const defaultWhich = (command: string): string | null => Bun.which(command);

const text = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);

const tomlValue = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const codexBlock = (url: string, token: string): string =>
	[
		BLOCK_HEADER,
		`url = ${tomlValue(url)}`,
		`http_headers = { Authorization = ${tomlValue(`Bearer ${token}`)} }`,
		"startup_timeout_sec = 20",
		"tool_timeout_sec = 600",
		"",
	].join("\n");

export const stripTomlBlock = (body: string): string => {
	const kept: string[] = [];
	let inside = false;
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		const header = trimmed.startsWith("[");
		if (header && trimmed.startsWith(`[mcp_servers.${SERVER_NAME}`)) {
			inside = true;
			continue;
		}
		if (header) inside = false;
		if (!inside) kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
};

const readJson = (path: string): Record<string, unknown> => {
	const body = text(path);
	if (body === null || body.trim() === "") return {};
	try {
		const parsed = JSON.parse(body) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(`${path} ไม่ใช่ JSON ที่อ่านได้ (${String(error)}) — ไม่เขียนทับ ให้แก้ไฟล์เองก่อน`);
	}
};

const serverEntry = (url: string, token: string): Record<string, unknown> => ({
	url,
	headers: { Authorization: `Bearer ${token}` },
});

const isConnected = (target: AgentTarget, path: string, url: string): boolean => {
	const body = text(path);
	if (body === null) return false;
	if (target.format === "toml") return body.includes(BLOCK_HEADER) && body.includes(url);
	if (target.format === "json") {
		try {
			const servers = readJson(path).mcpServers as Record<string, { url?: string }> | undefined;
			return Boolean(servers?.[SERVER_NAME]?.url);
		} catch {
			return false;
		}
	}
	return false;
};

export const scanAgents = (deps: ConfigDeps): DetectedAgent[] => {
	const which = deps.which ?? defaultWhich;
	return TARGETS.map((target) => {
		const path = target.configPath(deps.home);
		const installed = Boolean(which(target.command));
		const supported = target.format !== "unsupported";
		const connected = installed && supported ? isConnected(target, path, deps.url) : false;
		const detail = !installed
			? `ไม่พบคำสั่ง ${target.command} ในเครื่อง`
			: target.kind === "claude" || target.kind === "gemini"
			? "บอร์ดตั้ง MCP ให้เมื่อเริ่มการ์ด"
			: !supported
				? `รู้จักแต่ยังเขียน config ให้อัตโนมัติไม่ได้ — ต่อเองได้ที่ ${deps.url}`
				: connected
					? `เชื่อมกับบอร์ดนี้แล้ว (${path})`
					: `พร้อมเชื่อม — จะเขียน ${path}`;
		return { kind: target.kind, label: target.label, installed, supported, configPath: path, connected, detail };
	});
};

const backup = (path: string, now: () => number): string | null => {
	if (!existsSync(path)) return null;
	const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
	const copy = `${path}.bak-${stamp}`;
	copyFileSync(path, copy);
	return copy;
};

const targetFor = (kind: string): AgentTarget => {
	const target = TARGETS.find((item) => item.kind === kind);
	if (!target) throw new Error(`ไม่รู้จัก agent ชนิด ${kind}`);
	return target;
};

export interface WriteResult {
	kind: string;
	path: string;
	changed: boolean;
	backup: string | null;
}

const writeTarget = (target: AgentTarget, deps: ConfigDeps, body: string, path: string): WriteResult => {
	const now = deps.now ?? Date.now;
	const current = text(path);
	if (current === body) return { kind: target.kind, path, changed: false, backup: null };
	const backupPath = backup(path, now);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
	return { kind: target.kind, path, changed: true, backup: backupPath };
};

export const connectAgent = (kind: string, deps: ConfigDeps): WriteResult => {
	const target = targetFor(kind);
	if (target.format === "unsupported") throw new Error(`${target.label} ยังเชื่อมต่ออัตโนมัติไม่ได้ — ใช้ ${deps.url} ต่อเอง`);
	const path = target.configPath(deps.home);
	if (target.format === "toml") {
		const current = text(path) ?? "";
		const kept = stripTomlBlock(current);
		const body = `${kept.length > 0 ? `${kept}\n\n` : ""}${codexBlock(deps.url, deps.token)}`;
		return writeTarget(target, deps, body, path);
	}
	const document = readJson(path);
	const servers = (document.mcpServers ?? {}) as Record<string, unknown>;
	document.mcpServers = { ...servers, [SERVER_NAME]: serverEntry(deps.url, deps.token) };
	return writeTarget(target, deps, `${JSON.stringify(document, null, 2)}\n`, path);
};

export const disconnectAgent = (kind: string, deps: ConfigDeps): WriteResult => {
	const target = targetFor(kind);
	const path = target.configPath(deps.home);
	if (target.format === "unsupported" || !existsSync(path)) return { kind, path, changed: false, backup: null };
	if (target.format === "toml") {
		const body = `${stripTomlBlock(readFileSync(path, "utf8"))}\n`;
		return writeTarget(target, deps, body, path);
	}
	const document = readJson(path);
	const servers = (document.mcpServers ?? {}) as Record<string, unknown>;
	delete servers[SERVER_NAME];
	document.mcpServers = servers;
	return writeTarget(target, deps, `${JSON.stringify(document, null, 2)}\n`, path);
};

export const refreshConnections = (deps: ConfigDeps): WriteResult[] => {
	const written: WriteResult[] = [];
	for (const target of TARGETS) {
		if (target.format === "unsupported") continue;
		const path = target.configPath(deps.home);
		const body = text(path);
		if (body === null || !body.includes(SERVER_NAME)) continue;
		try {
			written.push(connectAgent(target.kind, deps));
		} catch {
			continue;
		}
	}
	return written;
};
