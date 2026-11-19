import { describe, expect, test } from "bun:test";
import type { CardQuestion } from "../shared/board";
import { consultRequest, createConsultation } from "../src/board/consult";
import samples from "../ai-requests.json";

const question: CardQuestion = {
	text: "ใครควรเห็นรายงาน",
	options: ["ทีมภายใน", "ลูกค้า"],
	recommend: "ทีมภายใน",
	kind: "decision",
	askedAt: 123,
};
const explanation = {
	meaning: "คำถามนี้กำหนดว่าใครเปิดรายงานได้",
	consequences: "ทีมภายในเห็นแล้วแก้ไขได้ง่าย\nถ้าลูกค้าเห็นต้องตรวจข้อมูลก่อนเปิด",
	recommendation: "เริ่มที่ทีมภายในเพราะย้อนกลับง่ายกว่า",
	fallback: "ถ้ายังไม่แน่ใจ ให้ทีมอ่านก่อน",
	draft: "ให้ทีมภายในเห็นรายงานก่อน",
};
const complete = { found: true, status: "completed", result: { output: [{ type: "text", text: JSON.stringify(explanation) }] } };

describe("การปรึกษาผ่าน Host AI", () => {
	test("ส่งเฉพาะข้อมูลคำถามและกำหนดรูปแบบผลลัพธ์ตามตัวอย่างใน bundle", () => {
		const request = consultRequest("c-ตัวอย่าง", question);
		expect<unknown>(request).toEqual(samples[0]);
		expect(request.request_id).toBe("ask:c-ตัวอย่าง:123");
		expect(request.io).toEqual({ inputs: ["text"], outputs: ["text"] });
		expect(request.budget).toEqual({ seconds: 30, output_bytes: 32768 });
		expect(request.input[0].role).toBe("system");
		expect(request.input[0].text).toContain("120 คำ");
		expect(request.input[0].text).toContain("draft");
		expect(request.input[1].role).toBe("user");
		expect(JSON.parse(request.input[1].text)).toEqual({ question: question.text, options: question.options, recommend: question.recommend });
	});

	test("คลิกซ้ำพร้อมกันและเรียกจากอีกหน้าหลังเสร็จใช้ผลเดิม คำถามใหม่เริ่มคำขอใหม่", async () => {
		const calls: Record<string, unknown>[] = [];
		const consult = createConsultation({
			call: async (namespace, operation, envelope) => {
				expect([namespace, operation]).toEqual(["host.platform", "ai.request"]);
				calls.push(envelope!);
				if (envelope?.operation === "invoke") return { found: true, status: "running", result: null };
				return { ok: true, result: complete };
			},
		}, async () => {});
		expect(calls).toEqual([]);
		const first = consult.ask("c-1", question);
		expect(consult.ask("c-1", question)).toBe(first);
		expect(await first).toEqual(explanation);
		expect(await consult.ask("c-1", question)).toEqual(explanation);
		expect(calls.map((call) => call.operation)).toEqual(["invoke", "invoke_status"]);
		expect(calls[1].request_id).toBe("ask:c-1:123");

		await consult.ask("c-1", { ...question, askedAt: 567 });
		await consult.ask("c-2", question);
		expect(calls.filter((call) => call.operation === "invoke").map((call) => (call.input as { request_id: string }).request_id))
			.toEqual(["ask:c-1:123", "ask:c-1:567", "ask:c-2:123"]);
	});

	test("ตรวจความพร้อมหนึ่งครั้งโดยไม่เรียกโมเดลเมื่อโฮสต์ยังไม่ตั้งค่า", async () => {
		const calls: Record<string, unknown>[] = [];
		const consult = createConsultation({ call: async (_namespace, _operation, envelope) => {
			calls.push(envelope!);
			return { setup: { status: "setup_required" } };
		} });
		expect(await consult.available()).toBe(false);
		expect(await consult.available()).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ operation: "validate", check_setup: true });
		const oldHost = createConsultation({ call: async () => { throw new Error("unknown_operation"); } });
		expect(await oldHost.available()).toBe(false);
	});

	test("ใช้รหัสเดิมตามหาผลเมื่อโฮสต์ยังไม่ยืนยันการรับคำขอ", async () => {
		const operations: unknown[] = [];
		const consult = createConsultation({ call: async (_namespace, _operation, envelope) => {
			operations.push(envelope?.operation);
			if (envelope?.operation === "invoke") throw Object.assign(new Error("ยังไม่ยืนยัน"), { code: "unknown_outcome" });
			expect(envelope?.request_id).toBe("ask:c-1:123");
			return complete;
		} });
		expect(await consult.ask("c-1", question)).toEqual(explanation);
		expect(operations).toEqual(["invoke", "invoke_status"]);
	});

	test("คำอธิบายที่ไม่ครบไม่ถูกทำเป็นร่างและไม่ยิงคำขอเดิมซ้ำ", async () => {
		let requests = 0;
		const consult = createConsultation({ call: async () => {
			requests++;
			return { ...complete, result: { output: [{ type: "text", text: JSON.stringify({ draft: "ข้อมูลไม่ครบ" }) }] } };
		} });
		await expect(consult.ask("c-1", question)).rejects.toThrow("คำอธิบายไม่ครบ");
		await expect(consult.ask("c-1", question)).rejects.toThrow("คำอธิบายไม่ครบ");
		expect(requests).toBe(1);
	});
});
