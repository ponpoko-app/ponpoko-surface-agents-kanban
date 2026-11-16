import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Binding {
	port: number;
	token: string;
}

export const BINDING_FILE = "mcp-binding.json";

export const newToken = (): string => randomBytes(24).toString("hex");

export const loadBinding = (directory: string): Binding | null => {
	const path = join(directory, BINDING_FILE);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Binding>;
		if (typeof parsed.port !== "number" || typeof parsed.token !== "string") return null;
		if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) return null;
		if (parsed.token.length < 16) return null;
		return { port: parsed.port, token: parsed.token };
	} catch {
		return null;
	}
};

export const saveBinding = (directory: string, binding: Binding): void => {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, BINDING_FILE), `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
};
