import type { AgentKind, Lane, McpInfo } from "../shared/board";
import type { BoardService } from "./board";

export interface McpDeps {
	board: () => BoardService;
}

export interface McpServer {
	info: McpInfo;
	stop(): void;
}

interface RpcRequest {
	jsonrpc?: string;
	id?: number | string | null;
	method?: string;
	params?: Record<string, unknown>;
}

type Args = Record<string, unknown>;

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
	{
		name: "agents_join",
		description: "ลงทะเบียน agent นี้กับบอร์ด แล้วได้ agent id กลับไป",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" }, kind: { type: "string", enum: ["codex", "pi"] }, capabilities: { type: "array", items: { type: "string" } } },
			required: ["name"],
		},
	},
	{
		name: "board_list",
		description: "ดูการ์ดทุกใบและ agent ที่ต่ออยู่ พร้อมคอลัมน์ปัจจุบัน",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "board_claim",
		description: "ดึงการ์ดแรกใน Backlog ที่ตรงกับความถนัดของ agent นี้มาทำ",
		inputSchema: { type: "object", properties: { agent: { type: "string" }, kind: { type: "string", enum: ["codex", "pi"] } }, required: ["agent"] },
	},
	{
		name: "board_note",
		description: "เขียนบันทึกลงการ์ด ให้คนอื่นเห็นว่าทำอะไรอยู่",
		inputSchema: { type: "object", properties: { card_id: { type: "string" }, text: { type: "string" } }, required: ["card_id", "text"] },
	},
	{
		name: "board_block",
		description: "หยุดการ์ดเพื่อรอคำตอบจากมนุษย์ (credential, การอนุมัติ publish ฯลฯ)",
		inputSchema: { type: "object", properties: { card_id: { type: "string" }, question: { type: "string" } }, required: ["card_id", "question"] },
	},
	{
		name: "board_submit",
		description: "ส่งงานไปคอลัมน์ Ready to test ให้ agent อีกตัวตรวจ",
		inputSchema: { type: "object", properties: { card_id: { type: "string" }, summary: { type: "string" } }, required: ["card_id"] },
	},
	{
		name: "board_review",
		description: "บันทึกผลตรวจ: verdict เป็น pass หรือ fail",
		inputSchema: {
			type: "object",
			properties: { card_id: { type: "string" }, verdict: { type: "string", enum: ["pass", "fail"] }, reason: { type: "string" } },
			required: ["card_id", "verdict"],
		},
	},
] as const;

const randomToken = (bytes: number): string => {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return [...buffer].map((value) => value.toString(16).padStart(2, "0")).join("");
};

const text = (args: Args, key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");

const strings = (args: Args, key: string): string[] =>
	Array.isArray(args[key]) ? (args[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];

const agentKind = (value: unknown): AgentKind => (value === "pi" ? "pi" : value === "codex" ? "codex" : "manual");

const cardView = (card: ReturnType<BoardService["card"]>) => ({
	id: card.id,
	title: card.title,
	lane: card.lane,
	deliverable: card.deliverable,
	acceptance: card.acceptance,
	tags: card.tags,
	assignee: card.assignee,
	reviewer: card.reviewer,
	question: card.question,
	notes: card.notes.slice(-5).map((note) => note.text),
});

export async function startMcpServer(deps: McpDeps): Promise<McpServer> {
	const token = randomToken(24);
	const session = randomToken(8);

	const runTool = (name: string, args: Args): unknown => {
		const board = deps.board();
		switch (name) {
			case "agents_join":
				return board.addAgent({
					name: text(args, "name") || "agent",
					kind: agentKind(args.kind),
					capabilities: strings(args, "capabilities"),
					source: "mcp",
				});
			case "board_list":
				return {
					cards: board.snapshot().cards.map(cardView),
					agents: board.agents().map((agent) => ({ id: agent.id, name: agent.name, kind: agent.kind, state: agent.state })),
				};
			case "board_claim": {
				const name = text(args, "agent");
				const existing = board.agents().find((agent) => agent.name === name);
				const agent = existing ?? board.addAgent({ name, kind: agentKind(args.kind), source: "mcp" });
				const card = board.claimNext(agent.id);
				return { card: card ? cardView(card) : null, agent_id: agent.id };
			}
			case "board_note":
				return cardView(board.note(text(args, "card_id"), "note", text(args, "text")));
			case "board_block": {
				const id = text(args, "card_id");
				board.note(id, "blocked", text(args, "question"));
				return cardView(board.moveCard(id, "blocked" as Lane));
			}
			case "board_submit": {
				const id = text(args, "card_id");
				board.note(id, "note", text(args, "summary") || "ส่งงานให้ตรวจ");
				return cardView(board.moveCard(id, "ready_to_test" as Lane));
			}
			case "board_review": {
				const verdict = text(args, "verdict").toLowerCase() === "fail" ? "FAIL" : "PASS";
				const reason = text(args, "reason");
				return cardView(board.reviewVerdict(text(args, "card_id"), `${verdict}\n${reason}`));
			}
			default:
				throw new Error(`ไม่รู้จัก tool ${name}`);
		}
	};

	const answer = (id: RpcRequest["id"], result: unknown, headers: Record<string, string> = {}): Response =>
		Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: { "Content-Type": "application/json", ...headers } });

	const failure = (id: RpcRequest["id"], code: number, message: string, status = 200): Response =>
		Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers: { "Content-Type": "application/json" } });

	const handle = (request: RpcRequest): Response | null => {
		const method = request.method ?? "";
		if (method === "initialize") {
			return answer(
				request.id,
				{
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: "agents-kanban", version: "0.1.0" },
					instructions: "ดึงการ์ดด้วย board_claim, ส่งงานด้วย board_submit, ตอบผลตรวจด้วย board_review",
				},
				{ "Mcp-Session-Id": session },
			);
		}
		if (method.startsWith("notifications/")) return null;
		if (method === "ping") return answer(request.id, {});
		if (method === "tools/list") return answer(request.id, { tools: TOOLS });
		if (method === "tools/call") {
			const name = typeof request.params?.name === "string" ? request.params.name : "";
			const args = (request.params?.arguments as Args) ?? {};
			try {
				const value = runTool(name, args);
				return answer(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
			} catch (error) {
				return answer(request.id, { content: [{ type: "text", text: String(error) }], isError: true });
			}
		}
		return failure(request.id, -32601, `ไม่รู้จัก method ${method}`);
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
			if (request.method === "GET") return new Response("use POST", { status: 405 });
			if (request.method !== "POST") return new Response("use POST", { status: 405 });
			const authorization = request.headers.get("authorization") ?? "";
			if (authorization !== `Bearer ${token}`) return failure(null, -32001, "ต้องส่ง bearer token ของบอร์ดนี้", 401);
			let body: RpcRequest | RpcRequest[];
			try {
				body = (await request.json()) as RpcRequest | RpcRequest[];
			} catch {
				return failure(null, -32700, "อ่าน JSON ไม่ได้");
			}
			if (Array.isArray(body)) {
				const answered = body.map((item) => handle(item)).filter((item): item is Response => item !== null);
				if (answered.length === 0) return new Response(null, { status: 202 });
				const payload = await Promise.all(answered.map((response) => response.json()));
				return Response.json(payload, { headers: { "Content-Type": "application/json" } });
			}
			const response = handle(body);
			if (!response) return new Response(null, { status: 202 });
			return response;
		},
	});

	const url = `http://127.0.0.1:${server.port}/mcp`;
	const info: McpInfo = {
		url,
		token,
		codex: `codex mcp add agents-kanban --url ${url} --bearer-token-env-var KANBAN_TOKEN`,
		pi: `pi mcp add agents-kanban --url ${url} --bearer-token-env-var KANBAN_TOKEN`,
	};

	return {
		info,
		stop() {
			void server.stop(true);
		},
	};
}
