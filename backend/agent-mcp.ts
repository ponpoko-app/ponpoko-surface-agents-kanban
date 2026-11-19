import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpInfo } from "../shared/board";

const name = "agents-kanban";
const tools = ["board_list", "board_note", "board_attach", "board_ask", "board_block", "board_submit"];
const headers = { Authorization: 'Bearer ${AGENTS_KANBAN_MCP_TOKEN}', "X-Agents-Kanban-Lease": '${AGENTS_KANBAN_LEASE}' };

export function claudeMcp(mcp: McpInfo): string[] {
	const config = { mcpServers: { [name]: { type: "http", alwaysLoad: true, url: mcp.url, headers } } };
	return ["--mcp-config", JSON.stringify(config), "--allowedTools", tools.map((tool) => "mcp__" + name + "__" + tool).join(",")];
}

export function geminiMcp(directory: string, mcp: McpInfo): string {
	const source = process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ?? (process.platform === "darwin"
		? "/Library/Application Support/GeminiCli/system-defaults.json" : "/etc/gemini-cli/system-defaults.json");
	const defaults = existsSync(source) ? JSON.parse(readFileSync(source, "utf8")) : {};
	const settings = {
		...defaults,
		mcpServers: {
			...defaults.mcpServers,
			[name]: { httpUrl: mcp.url, headers, includeTools: tools, trust: true },
		},
	};
	const folder = join(directory, "agent-runtime");
	mkdirSync(folder, { recursive: true });
	const file = join(folder, "gemini-defaults.json");
	const temporary = join(folder, randomUUID());
	writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
	renameSync(temporary, file);
	return file;
}
