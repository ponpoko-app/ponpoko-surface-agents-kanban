import { createInterface } from "node:readline";
import { refreshConnections } from "./agent-config";
import { BoardApp } from "./app";
import { loadBinding, saveBinding } from "./binding";
import { BoardService } from "./board";
import { startMcpServer, type McpServer } from "./mcp";
import { BoardStore } from "./store";
import { Supervisor } from "./supervisor";

const directory = process.env.PONPOKO_SURFACE_DATA_DIR;
if (!directory) throw new Error("The Host must provide PONPOKO_SURFACE_DATA_DIR");

const store = new BoardStore(directory);
let board: BoardService;
const supervisor = new Supervisor({
	store,
	board: () => board,
	repoPath: () => store.settings().repoPath,
	cutoffMs: Number(process.env.AGENTS_KANBAN_KILL_WAIT_MS ?? 6000),
});
let mcp: McpServer | null = null;
board = new BoardService({ store, runner: supervisor, mcp: () => mcp?.info ?? null });
if (process.env.AGENTS_KANBAN_NO_MCP !== "1") {
	const binding = loadBinding(directory);
	mcp = await startMcpServer({ board: () => board }, { port: binding?.port, token: binding?.token });
	const port = Number(new URL(mcp.info.url).port);
	saveBinding(directory, { port, token: mcp.info.token });
	if (process.env.AGENTS_KANBAN_NO_AGENT_CONFIG !== "1") {
		refreshConnections({ home: process.env.HOME ?? "", url: mcp.info.url, token: mcp.info.token });
	}
}

supervisor.sweep();

const app = new BoardApp(board);
const shutdown = (): void => {
	supervisor.stopAll();
	mcp?.stop();
};

const close = async (): Promise<void> => {
	shutdown();
	await Bun.sleep(250);
	store.close();
	process.exit(0);
};

process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
process.on("exit", shutdown);

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
	let request: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> } | undefined = undefined;
	try {
		if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error("Request exceeds 4 MiB");
		request = JSON.parse(line);
		if (request?.jsonrpc !== "2.0" || typeof request.method !== "string" || request.id === undefined) {
			throw new Error("Invalid JSON-RPC request");
		}
		const result = await app.call(request.method, request.params ?? {});
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32000, message: String(error) } })}\n`,
		);
	}
}

shutdown();
store.close();
