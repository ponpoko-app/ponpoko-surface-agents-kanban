import type { AgentKind, Lane } from "../shared/board";

export interface CardInput {
	title?: string;
	deliverable?: string;
	spec?: string;
	acceptance?: string;
	checks?: string[];
	tags?: string[];
	lane?: Lane;
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
	name?: string;
	kind?: AgentKind;
	capabilities?: string[];
	source?: "board" | "mcp";
}

export const stamp = (): number => Date.now();

export const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const tagList = (value: unknown): string[] => {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return [...new Set(raw.map((item) => trimmed(item).toLowerCase()).filter(Boolean))];
};

export const newCardId = (at: number): string =>
	`c-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const newAgentId = (name: string, at: number): string => {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "agent";
	return `a-${slug}-${at.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
};
