export const SCHEMA: Record<string, unknown>;
export const CONTRACT: { version: 1; schema_sha256: string };

export interface TextRequest {
	request_id: string;
	io: { inputs: string[]; outputs: string[] };
	input: { type: "text"; text: string; role?: "system" | "user" }[];
	budget: { seconds: number; output_bytes: number };
}

type Receipt = { found: false } | {
	found: true;
	status: "running" | "completed" | "failed" | "stopped" | "unknown_outcome";
	result: { output?: { type: string; text?: string | null }[] } | null;
};

export function createHostAi(transport: (envelope: Record<string, unknown>) => Promise<unknown>): {
	validate(input: TextRequest, checkSetup?: boolean): Promise<{ setup?: { status: "ready" | "setup_required" } }>;
	invoke(input: TextRequest): Promise<Receipt>;
	status(requestId: string): Promise<Receipt>;
};
