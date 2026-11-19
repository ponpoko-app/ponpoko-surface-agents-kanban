import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLaunch, readEvent, readSessionId } from "../backend/agents";
import { BoardStore } from "../backend/store";
import { UsageLedger, usageObservation } from "../backend/usage";
import { emptyCard, pickAssignee, type Agent, type AgentUsage, type RunnableKind } from "../shared/board";

const now = 1_800_000_000_000;
const roots: string[] = [];
const directory = () => {
	const root = mkdtempSync(join(tmpdir(), "kanban-usage-"));
	roots.push(root);
	return root;
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

test("ตัวเลขโควตาใช้หน้าต่างจริงและคงอยู่เมื่อเปิดฐานข้อมูลใหม่", () => {
	const root = directory();
	const store = new BoardStore(root);
	const ledger = new UsageLedger(store);
	ledger.start("claude");
	ledger.start("claude");
	const line = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", utilization: 0.65, resetsAt: now / 1000 + 20 } });
	expect(ledger.observe("claude", line, false, now)).toBe(false);
	expect(ledger.observe("gemini", '{"type":"result","stats":{"total_tokens":832}}', false, now)).toBe(false);
	store.close();
	const reopened = new BoardStore(root);
	const again = new UsageLedger(reopened);
	expect(again.snapshot(now).find(({ kind }) => kind === "claude")).toMatchObject({ used_fraction: 0.65, runs: 2, window_ends_at: now + 20_000 });
	expect(again.snapshot(now + 20_001).find(({ kind }) => kind === "claude")).toMatchObject({ used_fraction: null, runs: 2 });
	expect(again.snapshot(now).find(({ kind }) => kind === "gemini")?.used_fraction).toBeNull();
	reopened.close();
});

test("ข้ามชนิดที่ติดโควตาแล้วเลือกสัดส่วนที่ต่ำสุดในกลุ่มที่ถนัด", () => {
	const at = Date.now();
	const agent = (kind: RunnableKind, capabilities = ["ทดสอบ"]): Agent => ({
		id: kind, name: kind, kind, capabilities, state: "idle", cardId: null, load: 0, source: "board", lastSeenAt: at,
	});
	const usage = (kind: RunnableKind, used_fraction: number, saturatedUntil: number | null = null): AgentUsage =>
		({ kind, used_fraction, saturatedUntil, runs: 3, window_ends_at: at + 30_000 });
	const card = { ...emptyCard("c-หนึ่ง", at), tags: ["ทดสอบ"] };
	const agents = [agent("codex"), agent("claude"), agent("gemini"), agent("pi", ["งานอื่น"])];
	const limits = [usage("claude", 0.05, at + 30_000), usage("codex", 0.7), usage("gemini", 0.2), usage("pi", 0.01)];
	expect(pickAssignee(card, agents, limits)?.agentId).toBe("gemini");
	expect(pickAssignee(card, agents, [{ ...limits[0], saturatedUntil: at - 1 }, ...limits.slice(1)])?.agentId).toBe("claude");
});

test("รับ rate limit เฉพาะจากเหตุการณ์โควตาหรือ error และอ่านเวลาลองใหม่", () => {
	expect(usageObservation('{"type":"message","role":"assistant","content":"error 429 rate limit reached"}', false, now)).toBeNull();
	expect(usageObservation('{"type":"error","error":{"message":"RESOURCE_EXHAUSTED","retryDelay":"15s"}}', false, now))
		.toMatchObject({ limited: true, reset: now + 15_000 });
	expect(usageObservation('{"rate_limits":{"primary":{"used_percent":30},"secondary":{"used_percent":60}}}', false, now))
		.toMatchObject({ limited: false, fraction: 0.6 });
});

test("Claude และ Gemini ทำงานใน cwd เดิมและอ่าน session ของแต่ละ CLI", () => {
	const repoPath = directory();
	const opts = { card: emptyCard("c-หนึ่ง", now), role: "implementer", phase: "resume", message: "ทำงานต่อ", repoPath, sessionId: "old" } as const;
	const claude = buildLaunch("claude", opts);
	const gemini = buildLaunch("gemini", opts);
	expect(claude.args).toEqual(["--print", "--verbose", "--output-format", "stream-json", "--permission-mode", "acceptEdits", "--resume", "old", "--", "ทำงานต่อ"]);
	expect(gemini.args).toEqual(["--output-format", "stream-json", "--approval-mode", "auto_edit", "--resume", "old", "--prompt", "ทำงานต่อ"]);
	expect([claude.cwd, gemini.cwd]).toEqual([repoPath, repoPath]);
	expect(readSessionId("claude", '{"type":"system","subtype":"init","session_id":"c-session"}')).toBe("c-session");
	expect(readSessionId("gemini", '{"type":"init","session_id":"g-session"}')).toBe("g-session");
	expect(readEvent("gemini", '{"type":"message","role":"assistant","content":"ทำงานแล้ว"}')?.text).toBe("ทำงานแล้ว");
	expect(readEvent("gemini", '{"type":"message","role":"user","content":"ข้อความตั้งต้น"}')).toBeNull();
	expect(readEvent("claude", '{"type":"assistant","message":{"content":[{"type":"text","text":"ทำงานแล้ว"}]}}')?.text).toBe("ทำงานแล้ว");
});
