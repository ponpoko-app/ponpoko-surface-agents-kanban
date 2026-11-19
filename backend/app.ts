import type { Lane } from "../shared/board";
import { connectAgent, disconnectAgent, refreshConnections, scanAgents, type ConfigDeps } from "./agent-config";
import type { BoardService } from "./board";

type Params = Record<string, unknown>;

const text = (params: Params, key: string): string => (typeof params[key] === "string" ? (params[key] as string) : "");

const requireId = (params: Params): string => {
	const id = text(params, "id");
	if (!id) throw new Error("ต้องระบุ id ของการ์ด");
	return id;
};

const lane = (params: Params): Lane => text(params, "lane") as Lane;

export class BoardApp {
	private readonly board: BoardService;

	constructor(board: BoardService) {
		this.board = board;
	}

	private configDeps(): ConfigDeps {
		const mcp = this.board.snapshot().mcp;
		return { home: process.env.HOME ?? "", url: mcp?.url ?? "", token: mcp?.token ?? "" };
	}

	async call(method: string, params: Params = {}): Promise<unknown> {
		switch (method) {
			case "app.info":
				return { id: "agents-kanban", name: "Agents Kanban", version: "0.1.0" };
			case "board.snapshot":
				return this.board.snapshot();
			case "board.settings":
				return this.board.settings(
					params.patch && typeof params.patch === "object" ? (params.patch as Record<string, never>) : undefined,
				);
			case "card.create":
				return this.board.createCard(params);
			case "card.update":
				return this.board.updateCard(
					requireId(params),
					params.patch && typeof params.patch === "object" ? (params.patch as Record<string, never>) : {},
				);
			case "card.move": {
				const id = requireId(params);
				const target = lane(params);
				if (target === "done" && this.board.card(id).lane === "ready_to_test") return this.board.submit(id);
				return this.board.moveCard(id, target, typeof params.position === "number" ? params.position : undefined);
			}
			case "card.delete":
				return this.board.deleteCard(requireId(params));
			case "card.start":
				return this.board.resume(requireId(params));
			case "card.stop":
				return this.board.moveCard(requireId(params), "backlog");
			case "card.answer":
				return this.board.answer(requireId(params), text(params, "answer"), typeof params.asked_at === "number" ? params.asked_at : undefined);
			case "card.resume":
				return this.board.resume(requireId(params));
			case "card.attach":
				return this.board.attach(requireId(params), {
					name: text(params, "name"),
					mime: text(params, "mime"),
					data_base64: text(params, "data_base64"),
				});
			case "card.detach":
				return this.board.detach(requireId(params), text(params, "attachment_id"));
			case "attachment.read":
				return this.board.attachmentData(requireId(params), text(params, "attachment_id"));
			case "agent.scan":
				return { agents: scanAgents(this.configDeps()) };
			case "agent.connect": {
				const written = connectAgent(text(params, "kind"), this.configDeps());
				return { written, agents: scanAgents(this.configDeps()) };
			}
			case "agent.disconnect": {
				const written = disconnectAgent(text(params, "kind"), this.configDeps());
				return { written, agents: scanAgents(this.configDeps()) };
			}
			case "agent.refresh": {
				const written = refreshConnections(this.configDeps());
				return { written, agents: scanAgents(this.configDeps()) };
			}
			case "agent.add":
				return this.board.addAgent(params);
			case "agent.remove":
				this.board.removeAgent(text(params, "id"));
				return { ok: true };
			case "mcp.info":
				return this.board.snapshot().mcp;
			default:
				throw new Error(`ไม่รู้จัก method ${method}`);
		}
	}
}
