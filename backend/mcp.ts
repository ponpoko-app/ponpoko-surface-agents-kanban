import { RUNNABLE_KINDS, type AgentKind, type McpInfo, type RunnableKind } from "../shared/board";
import type { BoardService } from "./board";

export interface McpDeps {
	board: () => BoardService;
	useLease?: (cardId: string, token: string) => void;
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
const LEASE_TOOLS = new Set(["board_note", "board_ask", "board_block", "board_submit", "board_review"]);
const LEASE_TOKEN = { type: "string", description: "สิทธิ์ของ agent ที่บอร์ดส่งผ่าน AGENTS_KANBAN_LEASE" };

const TOOLS = [
	{
		name: "agents_join",
		description: "ลงทะเบียน agent นี้กับบอร์ด แล้วได้ agent id กลับไป",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" }, kind: { type: "string", enum: RUNNABLE_KINDS }, capabilities: { type: "array", items: { type: "string" } } },
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
		inputSchema: { type: "object", properties: { agent: { type: "string" }, kind: { type: "string", enum: RUNNABLE_KINDS } }, required: ["agent"] },
	},
	{
		name: "board_attach",
		description: "แนบรูป (screenshot ของบั๊ก หรือ UI ที่ต้องการ) เข้ากับการ์ด เป็น base64",
		inputSchema: {
			type: "object",
			properties: { card_id: { type: "string" }, name: { type: "string" }, data_base64: { type: "string" } },
			required: ["card_id", "data_base64"],
		},
	},
	{
		name: "board_note",
		description: "เขียนบันทึกลงการ์ด ให้คนอื่นเห็นว่าทำอะไรอยู่",
		inputSchema: { type: "object", properties: { card_id: { type: "string" }, text: { type: "string" } }, required: ["card_id", "text"] },
	},
	{
		name: "board_ask",
		description: "ถามผู้ใช้โดยให้ตัวเลือกและแนะนำหนึ่งข้อ การ์ดจะพักไว้จนกว่าจะได้รับคำตอบ",
		inputSchema: {
			type: "object",
			properties: {
				card_id: { type: "string" },
				text: { type: "string", minLength: 1 },
				options: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true },
				recommend: { type: "string", description: "ข้อความที่ตรงกับหนึ่งใน options" },
				kind: { type: "string", enum: ["decision", "problem"], default: "decision" },
			},
			required: ["card_id", "text", "options", "recommend"],
		},
	},
	{
		name: "board_block",
		description: "หยุดการ์ดเพื่อรอคำตอบจากมนุษย์ (credential, การอนุมัติ publish ฯลฯ)",
		inputSchema: { type: "object", properties: { card_id: { type: "string" }, question: { type: "string" } }, required: ["card_id", "question"] },
	},
	{
		name: "board_submit",
		description: "รันคำสั่งตรวจใน worktree และปิดการ์ดเมื่อผ่านทุกคำสั่ง ส่ง checks เพื่อกำหนดคำสั่งใหม่ได้",
		inputSchema: {
			type: "object",
			properties: { card_id: { type: "string" }, summary: { type: "string" }, checks: { type: "array", items: { type: "string" }, minItems: 1 } },
			required: ["card_id"],
		},
	},
	{
		name: "board_review",
		description: "บันทึกความเห็นเสริมว่า pass หรือ fail โดยให้คำสั่งตรวจบนการ์ดตัดสินการปิดงาน",
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

const agentKind = (value: unknown): AgentKind => RUNNABLE_KINDS.includes(value as RunnableKind) ? value as RunnableKind : "manual";

const cardView = (card: ReturnType<BoardService["card"]>) => ({
	id: card.id,
	title: card.title,
	lane: card.lane,
	deliverable: card.deliverable,
	acceptance: card.acceptance,
	checks: card.checks,
	tags: card.tags,
	assignee: card.assignee,
	reviewer: card.reviewer,
	question: card.question,
	answer: card.answer,
	attachments: card.attachments.map((item) => ({ id: item.id, name: item.name, mime: item.mime })),
	notes: card.notes.slice(-5).map((note) => note.text),
});

export async function startMcpServer(deps: McpDeps, options: { port?: number; token?: string } = {}): Promise<McpServer> {
	const token = options.token ?? randomToken(24);
	const session = randomToken(8);

	const runTool = async (name: string, args: Args, connectionLease: string): Promise<unknown> => {
		const board = deps.board();
		if (LEASE_TOOLS.has(name)) deps.useLease?.(text(args, "card_id"), connectionLease || text(args, "lease_token"));
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
			case "board_attach":
				return cardView(board.attach(text(args, "card_id"), { name: text(args, "name"), data_base64: text(args, "data_base64") }));
			case "board_note":
				return cardView(board.note(text(args, "card_id"), "note", text(args, "text")));
			case "board_ask":
				return cardView(board.ask(text(args, "card_id"), { text: args.text, options: args.options, recommend: args.recommend, kind: args.kind }));
			case "board_block":
				return cardView(board.block(text(args, "card_id"), text(args, "question")));
			case "board_submit":
				return cardView(await board.submit(text(args, "card_id"), args.checks, text(args, "summary")));
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

	const handle = async (request: RpcRequest, connectionLease: string): Promise<Response | null> => {
		const method = request.method ?? "";
		if (method === "initialize") {
			return answer(
				request.id,
				{
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: "agents-kanban", version: "0.1.0" },
					instructions: "ดึงการ์ดด้วย board_claim แล้วส่งงานพร้อมคำสั่งตรวจด้วย board_submit",
				},
				{ "Mcp-Session-Id": session },
			);
		}
		if (method.startsWith("notifications/")) return null;
		if (method === "ping") return answer(request.id, {});
		if (method === "tools/list") return answer(request.id, { tools: TOOLS.map((tool) => LEASE_TOOLS.has(tool.name)
			? { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, lease_token: LEASE_TOKEN } } }
			: tool) });
		if (method === "tools/call") {
			const name = typeof request.params?.name === "string" ? request.params.name : "";
			const args = (request.params?.arguments as Args) ?? {};
			try {
				const value = await runTool(name, args, connectionLease);
				return answer(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
			} catch (error) {
				return answer(request.id, { content: [{ type: "text", text: String(error) }], isError: true });
			}
		}
		return failure(request.id, -32601, `ไม่รู้จัก method ${method}`);
	};

	const fetchHandler = async (request: Request): Promise<Response> => {
			const url = new URL(request.url);
			if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
			if (request.method === "GET") return new Response("use POST", { status: 405 });
			if (request.method !== "POST") return new Response("use POST", { status: 405 });
			const authorization = request.headers.get("authorization") ?? "";
			if (authorization !== `Bearer ${token}`) return failure(null, -32001, "ต้องส่ง bearer token ของบอร์ดนี้", 401);
			const connectionLease = request.headers.get("x-agents-kanban-lease") ?? "";
			let body: RpcRequest | RpcRequest[];
			try {
				body = (await request.json()) as RpcRequest | RpcRequest[];
			} catch {
				return failure(null, -32700, "อ่าน JSON ไม่ได้");
			}
			if (Array.isArray(body)) {
				const answered = (await Promise.all(body.map((item) => handle(item, connectionLease)))).filter((item): item is Response => item !== null);
				if (answered.length === 0) return new Response(null, { status: 202 });
				const payload = await Promise.all(answered.map((response) => response.json()));
				return Response.json(payload, { headers: { "Content-Type": "application/json" } });
			}
		const response = await handle(body, connectionLease);
		if (!response) return new Response(null, { status: 202 });
		return response;
	};

	const bind = (port: number): ReturnType<typeof Bun.serve> =>
		Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 255, fetch: fetchHandler });

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = bind(options.port ?? 0);
	} catch {
		server = bind(0);
	}

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
