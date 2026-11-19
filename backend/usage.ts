import { RUNNABLE_KINDS, type AgentUsage, type RunnableKind } from "../shared/board";
import type { BoardStore } from "./store";

const HOLD_MS = 300_000;
type Json = Record<string, unknown>;
interface Observation { fraction?: number; reset?: number; limited: boolean; rejected: boolean }

const object = (value: unknown): Json | undefined => value && typeof value === "object" ? value as Json : undefined;
const absoluteTime = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return value >= 1e12 ? value : value * 1000;
	if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return Date.parse(value);
	return undefined;
};
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const limitedText = /(?:too many requests|rate[ _-]?limit(?:ed| exceeded| reached)|overloaded_error|resource_exhausted|quota (?:has been )?exceeded|usage limit|\b429\b)/i;

export function usageObservation(line: string, stderr: boolean, now = Date.now()): Observation | null {
	let event: Json | undefined;
	try { event = object(JSON.parse(line)); } catch {}
	const info = object(event?.rate_limit_info);
	const rateLimits = object(event?.rateLimits ?? event?.rate_limits ?? object(event?.params)?.rateLimits);
	const windows = [info, object(rateLimits?.primary), object(rateLimits?.secondary), event?.type === "usage" ? event : undefined];
	let measured: { fraction: number; reset?: number } | undefined;
	for (const window of windows) {
		const percent = finite(window?.usedPercent ?? window?.used_percent);
		const fraction = finite(window?.used_fraction ?? window?.utilization) ?? (percent === undefined ? undefined : percent / 100);
		const reset = absoluteTime(window?.resetsAt ?? window?.resets_at ?? window?.window_ends_at);
		if (fraction !== undefined && fraction >= 0 && fraction <= 1 && (reset === undefined || reset > now) && fraction > (measured?.fraction ?? -1)) {
			measured = { fraction, reset };
		}
	}
	const error = object(event?.error);
	const errorEvent = event?.type === "error" || event?.type === "turn.failed" || event?.is_error === true || event?.status === "error";
	const errorText = stderr && !event ? line : errorEvent ? [event?.message, event?.result, event?.error, error?.message, error?.code].filter((value) => typeof value === "string" || typeof value === "number").join(" ") : "";
	const rejected = info?.status === "rejected" || limitedText.test(errorText);
	const limited = rejected || measured?.fraction === 1;
	const retry = /(?:retry(?:Delay|[- ]after| in)\s*["':=]*\s*)(\d+(?:\.\d+)?)\s*s/i.exec(line);
	const reset = absoluteTime(info?.resetsAt ?? info?.resets_at) ?? measured?.reset ?? (retry ? now + Number(retry[1]) * 1000 : undefined);
	return limited || measured ? { fraction: measured?.fraction, reset, limited, rejected } : null;
}

const defaultRow = (kind: RunnableKind): AgentUsage => ({ kind, runs: 0, used_fraction: null, window_ends_at: null, saturatedUntil: null });

export class UsageLedger {
	private readonly store: BoardStore;

	constructor(store: BoardStore) {
		this.store = store;
		store.db.exec("CREATE TABLE IF NOT EXISTS vendor_usage (kind TEXT PRIMARY KEY, json TEXT NOT NULL)");
	}

	snapshot(now = Date.now()): AgentUsage[] {
		return RUNNABLE_KINDS.map((kind) => {
			const row = this.get(kind);
			if (row.window_ends_at !== null && row.window_ends_at <= now) {
				row.used_fraction = null;
				row.window_ends_at = null;
			}
			if (row.saturatedUntil !== null && row.saturatedUntil <= now) row.saturatedUntil = null;
			return row;
		});
	}

	start(kind: RunnableKind): void {
		this.store.transaction(() => {
			const row = this.get(kind);
			this.put({ ...row, runs: row.runs + 1 });
		});
	}

	observe(kind: RunnableKind, line: string, stderr: boolean, now = Date.now()): boolean {
		const observation = usageObservation(line, stderr, now);
		if (!observation) return false;
		this.store.transaction(() => {
			const previous = this.get(kind);
			const reset = observation.reset && observation.reset > now ? observation.reset : now + HOLD_MS;
			this.put({
				...previous,
				used_fraction: observation.fraction ?? previous.used_fraction,
				window_ends_at: observation.fraction === undefined ? previous.window_ends_at : reset,
				saturatedUntil: observation.limited ? Math.max(reset, previous.saturatedUntil ?? 0) : previous.saturatedUntil,
			});
		});
		return observation.rejected;
	}

	private get(kind: RunnableKind): AgentUsage {
		const row = this.store.db.query("SELECT json FROM vendor_usage WHERE kind = ?").get(kind) as { json: string } | null;
		return row ? JSON.parse(row.json) as AgentUsage : defaultRow(kind);
	}

	private put(row: AgentUsage): void {
		this.store.db.query("INSERT INTO vendor_usage (kind,json) VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET json=excluded.json").run(row.kind, JSON.stringify(row));
	}
}
