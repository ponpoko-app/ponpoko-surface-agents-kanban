import { describe, expect, test } from "bun:test";
import { emptyCard, type Card } from "../shared/board";
import { filterCards, matches } from "../src/board/search";

const card = (overrides: Partial<Card>): Card => ({ ...emptyCard("c-1", 1000), title: "ปล่อย v0.2", ...overrides });

describe("finding a card", () => {
	test("an empty query keeps every card and never reorders them", () => {
		const cards = [card({ id: "a" }), card({ id: "b" })];
		expect(filterCards(cards, "   ").map((item) => item.id)).toEqual(["a", "b"]);
	});

	test("every word must appear somewhere on the card, in any field", () => {
		const target = card({ deliverable: "tag v0.2 published", tags: ["release"] });
		expect(matches(target, "v0.2")).toBe(true);
		expect(matches(target, "release tag")).toBe(true);
		expect(matches(target, "release docker")).toBe(false);
	});

	test("the filter is case-insensitive and keeps only what matches", () => {
		const cards = [card({ id: "a", title: "Publish NPM" }), card({ id: "b", title: "แก้บั๊ก" })];
		expect(filterCards(cards, "npm").map((item) => item.id)).toEqual(["a"]);
	});

	test("the lane name is searchable so a column can be inspected", () => {
		const cards = [card({ id: "a", lane: "blocked" }), card({ id: "b", lane: "backlog" })];
		expect(filterCards(cards, "blocked").map((item) => item.id)).toEqual(["a"]);
	});
});
