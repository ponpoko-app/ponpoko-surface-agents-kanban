import type { Lane } from "../shared/board";
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
			case "card.move":
				return this.board.moveCard(requireId(params), lane(params), typeof params.position === "number" ? params.position : undefined);
			case "card.delete":
				return this.board.deleteCard(requireId(params));
			case "card.start":
				return this.board.resume(requireId(params));
			case "card.stop":
				return this.board.moveCard(requireId(params), "backlog");
			case "card.answer":
				return this.board.answer(requireId(params), text(params, "answer"));
			case "card.resume":
				return this.board.resume(requireId(params));
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
