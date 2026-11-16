import type { Card } from "../../shared/board";

export const haystack = (card: Card): string =>
	[card.title, card.deliverable, card.spec, card.acceptance, card.tags.join(" "), card.lane].join(" ").toLowerCase();

export const matches = (card: Card, query: string): boolean => {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const body = haystack(card);
	return words.every((word) => body.includes(word));
};

export const filterCards = (cards: readonly Card[], query: string): Card[] => {
	if (!query.trim()) return [...cards];
	return cards.filter((card) => matches(card, query));
};
