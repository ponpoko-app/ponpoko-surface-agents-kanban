import { describe, expect, test } from "bun:test";
import { canMove, laneCards, LANES, moveTargets, type Card, type Lane } from "../shared/board";
import { acceptsDrop, decodeDrag, dropTone, encodeDrag } from "../src/board/dnd";
import { emptyCard } from "../shared/board";

const card = (id: string, lane: Lane, position: number): Card => ({ ...emptyCard(id, 1000 + position), lane, position });

describe("lane graph", () => {
	test("a lane never moves to itself through the graph but is always accepted as a no-op", () => {
		for (const lane of LANES) {
			expect(canMove(lane, lane)).toBe(true);
			expect(moveTargets(lane)).not.toContain(lane);
		}
	});

	test("the happy path the board advertises is walkable: backlog → working → ready_to_test → done", () => {
		const path: Lane[] = ["backlog", "working", "ready_to_test", "done"];
		for (let index = 0; index < path.length - 1; index += 1) {
			expect(canMove(path[index], path[index + 1])).toBe(true);
		}
	});

	test("a rejected review returns to the implementer: ready_to_test → fix and fix → working → ready_to_test", () => {
		expect(canMove("ready_to_test", "fix")).toBe(true);
		expect(canMove("fix", "working")).toBe(true);
		expect(canMove("fix", "ready_to_test")).toBe(true);
	});

	test("backwards drags that would fake progress are refused", () => {
		expect(canMove("done", "working")).toBe(false);
		expect(canMove("ready_to_test", "backlog")).toBe(false);
		expect(canMove("backlog", "done")).toBe(false);
		expect(canMove("blocked", "done")).toBe(false);
	});

	test("every lane is reachable from backlog by some path of legal moves", () => {
		const seen = new Set<Lane>(["backlog"]);
		const queue: Lane[] = ["backlog"];
		while (queue.length > 0) {
			const lane = queue.shift() as Lane;
			for (const next of moveTargets(lane)) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		expect([...seen].sort()).toEqual([...LANES].sort());
	});

	test("cards come back ordered by position and never lose or duplicate one", () => {
		const cards = [card("b", "working", 2), card("a", "working", 1), card("c", "done", 0)];
		expect(laneCards(cards, "working").map((item) => item.id)).toEqual(["a", "b"]);
		expect(laneCards(cards, "working")).toHaveLength(2);
	});
});

describe("drag payloads", () => {
	test("a payload survives the trip through dataTransfer", () => {
		const payload = { id: "c-1", lane: "working" as Lane };
		expect(decodeDrag(encodeDrag(payload))).toEqual(payload);
	});

	test("garbage in dataTransfer is ignored instead of throwing", () => {
		expect(decodeDrag("not json")).toBeNull();
		expect(decodeDrag(JSON.stringify({ id: 3 }))).toBeNull();
	});

	test("the drop highlight agrees with the lane graph for every pair", () => {
		for (const from of LANES) {
			for (const to of LANES) {
				expect(acceptsDrop(from, to)).toBe(canMove(from, to));
				expect(dropTone(from, to)).toBe(canMove(from, to) ? "ok" : "bad");
			}
		}
		expect(acceptsDrop("done", "working")).toBe(false);
		expect(dropTone("done", "working")).toBe("bad");
		expect(dropTone(null, "working")).toBe("idle");
	});
});
