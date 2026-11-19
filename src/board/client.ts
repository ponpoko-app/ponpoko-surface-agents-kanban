import { createSurfaceClient } from "../sdk/surface.mjs";
import type { Agent, AgentKind, BoardSnapshot, Card, Lane, McpInfo, ScannedAgent, Settings } from "../../shared/board";

export interface NewCardInput {
	title: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	tags?: string[];
}

export interface CardPatch {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	checks?: string[];
	tags?: string[];
}

export interface AgentInput {
	name: string;
	kind: AgentKind;
	capabilities?: string[];
}

export interface BoardClient {
	backend<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	call(namespace: "host.platform" | "host.surface" | "host.work", operation: string, payload?: Record<string, unknown>): Promise<unknown>;
	onPalette(handler: (tokens: Record<string, string>) => void): () => void;
	dispose(): void;
}

export async function connect(): Promise<BoardClient> {
	let surface: ReturnType<typeof createSurfaceClient>;
	try {
		surface = createSurfaceClient();
		await surface.ready();
	} catch (error) {
		throw new Error(`ต่อกับ Ponpoko ไม่ได้ — เปิด surface นี้จากในแอป Ponpoko ก่อน (${String(error)})`);
	}
	return {
		backend: (method, params) => surface.backend(method, params) as Promise<never>,
		call: (namespace, operation, payload) => surface.call(namespace, operation, payload),
		onPalette: (handler) => surface.onPalette(handler),
		dispose: () => surface.dispose(),
	};
}

export const fetchSnapshot = (client: BoardClient): Promise<BoardSnapshot> => client.backend<BoardSnapshot>("board.snapshot");

export const createCard = (client: BoardClient, input: NewCardInput): Promise<Card> =>
	client.backend<Card>("card.create", { ...input });

export const updateCard = (client: BoardClient, id: string, patch: CardPatch): Promise<Card> =>
	client.backend<Card>("card.update", { id, patch });

export const moveCard = (client: BoardClient, id: string, lane: Lane, position?: number): Promise<Card> =>
	client.backend<Card>("card.move", { id, lane, position });

export const deleteCard = (client: BoardClient, id: string): Promise<Card> => client.backend<Card>("card.delete", { id });

export const startCard = (client: BoardClient, id: string): Promise<Card> => client.backend<Card>("card.start", { id });

export const answerCard = (client: BoardClient, id: string, answer: string, askedAt?: number): Promise<Card> =>
	client.backend<Card>("card.answer", { id, answer, asked_at: askedAt });

export const addAgent = (client: BoardClient, input: AgentInput): Promise<Agent> =>
	client.backend<Agent>("agent.add", { ...input });

export const removeAgent = (client: BoardClient, id: string): Promise<{ ok: boolean }> =>
	client.backend<{ ok: boolean }>("agent.remove", { id });

export const saveSettings = (client: BoardClient, patch: Partial<Settings>): Promise<Settings> =>
	client.backend<Settings>("board.settings", { patch });

export const mcpInfo = (client: BoardClient): Promise<McpInfo | null> => client.backend<McpInfo | null>("mcp.info");

export const attachImage = (client: BoardClient, cardId: string, body: { name: string; mime: string; data_base64: string }): Promise<Card> =>
	client.backend<Card>("card.attach", { id: cardId, ...body });

export const detachImage = (client: BoardClient, cardId: string, attachmentId: string): Promise<Card> =>
	client.backend<Card>("card.detach", { id: cardId, attachment_id: attachmentId });

export const readAttachment = (
	client: BoardClient,
	cardId: string,
	attachmentId: string,
): Promise<{ mime: string; data_base64: string }> =>
	client.backend<{ mime: string; data_base64: string }>("attachment.read", { id: cardId, attachment_id: attachmentId });

export const scanAgents = (client: BoardClient): Promise<ScannedAgent[]> =>
	client.backend<{ agents: ScannedAgent[] }>("agent.scan").then((result) => result.agents);

export const connectAgent = (client: BoardClient, kind: string): Promise<ScannedAgent[]> =>
	client.backend<{ agents: ScannedAgent[] }>("agent.connect", { kind }).then((result) => result.agents);

export const disconnectAgent = (client: BoardClient, kind: string): Promise<ScannedAgent[]> =>
	client.backend<{ agents: ScannedAgent[] }>("agent.disconnect", { kind }).then((result) => result.agents);
