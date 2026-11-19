import type { Card, CardQuestion } from "../../shared/board";

export interface AttentionItem {
	key: string;
	id: string;
	title: string;
	question: CardQuestion;
}

export function attentionItems(cards: readonly Card[], kind: CardQuestion["kind"]): AttentionItem[] {
	return cards.flatMap(({ id, title, question, lane }) =>
		lane === "blocked" && question?.kind === kind ? [{ key: `${id}:${question.askedAt}`, id, title, question }] : [],
	).sort((first, second) => first.question.askedAt - second.question.askedAt || first.id.localeCompare(second.id));
}

export function rememberQuestions(previous: ReadonlySet<string>, items: readonly AttentionItem[]): ReadonlySet<string> {
	if (!items.length) return previous.size ? new Set() : previous;
	const added = items.filter(({ key }) => !previous.has(key));
	return added.length ? new Set([...previous, ...added.map(({ key }) => key)]) : previous;
}

export const adjacentIndex = (index: number, offset: number, count: number): number => (index + offset + count) % count;

export const recommendedAnswers = (items: readonly AttentionItem[]) =>
	items.map(({ id, question }) => ({ id, answer: question.recommend, askedAt: question.askedAt }));

type Shortcut =
	| { action: "move"; offset: number }
	| { action: "select"; index: number }
	| { action: "confirm" | "accept-all" | "collapse" };

export function attentionShortcut(key: string, optionCount: number): Shortcut | null {
	if (key === "Escape") return { action: "collapse" };
	if (key === "j") return { action: "move", offset: 1 };
	if (key === "k") return { action: "move", offset: -1 };
	if (key === "a") return { action: "accept-all" };
	if (key === "Enter") return { action: "confirm" };
	if (!/^[1-9]$/.test(key) || Number(key) > optionCount) return null;
	return { action: "select", index: Number(key) - 1 };
}
