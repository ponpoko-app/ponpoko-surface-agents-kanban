import { describe, expect, test } from "bun:test";
import { emptyCard, type Card, type CardQuestion } from "../shared/board";
import { adjacentIndex, attentionItems, attentionShortcut, recommendedAnswers, rememberQuestions } from "../src/board/attention-queue";

const asked = (id: string, askedAt: number, kind: CardQuestion["kind"] = "decision"): Card => ({
	...emptyCard(id, askedAt),
	lane: "blocked",
	question: { kind, askedAt, text: id, options: ["ทีม", "ลูกค้า"], recommend: askedAt % 2 ? "ทีม" : "ลูกค้า" },
});

describe("คิวคำถาม", () => {
	test("เรียงตามเวลาที่ถามและแยกปัญหาออกจากการตัดสินใจ", () => {
		const cards = [asked("ค", 3), asked("ข", 2), asked("ก", 2), asked("ปัญหา", 1, "problem"), { ...asked("งาน", 1), lane: "working" as const }];
		expect(attentionItems(cards, "decision").map(({ id }) => id)).toEqual(["ก", "ข", "ค"]);
		expect(attentionItems(cards, "problem").map(({ id }) => id)).toEqual(["ปัญหา"]);
	});

	test("จำนวนคำถามเหลือลดจาก 5 ไป 1 โดยตัวหารคงเดิม แล้วเริ่มนับชุดใหม่ได้", () => {
		const all = attentionItems(Array.from({ length: 5 }, (_, index) => asked(`c${index}`, index)), "decision");
		let seen: ReadonlySet<string> = new Set();
		const progress = all.map((_, index) => {
			const remaining = all.slice(index);
			seen = rememberQuestions(seen, remaining);
			return `${remaining.length}/${seen.size}`;
		});
		expect(progress).toEqual(["5/5", "4/5", "3/5", "2/5", "1/5"]);
		expect(rememberQuestions(seen, []).size).toBe(0);
		expect(rememberQuestions(rememberQuestions(seen, []), all.slice(0, 1)).size).toBe(1);
	});

	test("ยอมรับทั้งหมดใช้คำแนะนำและเวลาของแต่ละคำถามที่ยังอยู่ในคิว", () => {
		const queue = attentionItems([asked("ปัญหา", 2, "problem"), asked("ก", 1), asked("ข", 2), asked("ค", 3)], "decision");
		expect(recommendedAnswers(queue.filter(({ id }) => id !== "ค"))).toEqual([
			{ id: "ก", answer: "ทีม", askedAt: 1 },
			{ id: "ข", answer: "ลูกค้า", askedAt: 2 },
		]);
	});

	test("ปุ่มเลื่อนวนที่ขอบและเลือกได้เฉพาะหมายเลขที่มีตัวเลือก", () => {
		expect(adjacentIndex(0, -1, 5)).toBe(4);
		expect(adjacentIndex(4, 1, 5)).toBe(0);
		expect(attentionShortcut("j", 3)).toEqual({ action: "move", offset: 1 });
		expect(attentionShortcut("k", 3)).toEqual({ action: "move", offset: -1 });
		expect(attentionShortcut("3", 3)).toEqual({ action: "select", index: 2 });
		expect(attentionShortcut("4", 3)).toBeNull();
		expect(attentionShortcut("9", 12)).toEqual({ action: "select", index: 8 });
		expect(attentionShortcut("Enter", 3)).toEqual({ action: "confirm" });
		expect(attentionShortcut("a", 3)).toEqual({ action: "accept-all" });
		expect(attentionShortcut("Escape", 3)).toEqual({ action: "collapse" });
	});
});
