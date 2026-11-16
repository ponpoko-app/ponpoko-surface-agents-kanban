import { canMove, type Lane } from "../../shared/board";

export const DRAG_MIME = "application/x-agents-kanban-card";

export interface DragPayload {
	id: string;
	lane: Lane;
}

export const encodeDrag = (payload: DragPayload): string => JSON.stringify(payload);

export const decodeDrag = (raw: string): DragPayload | null => {
	try {
		const parsed = JSON.parse(raw) as { id?: unknown; lane?: unknown };
		if (typeof parsed.id !== "string" || typeof parsed.lane !== "string") return null;
		return { id: parsed.id, lane: parsed.lane as Lane };
	} catch {
		return null;
	}
};

export type DropTone = "idle" | "ok" | "bad";

export const dropTone = (from: Lane | null, to: Lane): DropTone => {
	if (!from) return "idle";
	if (from === to) return "ok";
	return canMove(from, to) ? "ok" : "bad";
};

export const acceptsDrop = (from: Lane | null, to: Lane): boolean => dropTone(from, to) === "ok";
