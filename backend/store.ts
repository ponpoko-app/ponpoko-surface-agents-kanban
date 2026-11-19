import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Agent, type Card, type Settings } from "../shared/board";

interface Row {
	json: string;
}

type StoredCard = Omit<Card, "question"> & { question?: Card["question"] | string };

const readCard = (row: Row): Card => {
	const card = JSON.parse(row.json) as StoredCard;
	const question = card.lane === "blocked" ? card.question : null;
	return {
		...card,
		attachments: card.attachments ?? [],
		question: typeof question === "string"
			? { text: question, options: [], recommend: "", kind: "problem", askedAt: card.updatedAt }
			: question ?? null,
	};
};

export class BoardStore {
	readonly db: Database;

	readonly root: string;

	constructor(directory: string) {
		this.root = directory;
		mkdirSync(directory, { recursive: true });
		this.db = new Database(join(directory, "agents-kanban.sqlite3"), { create: true, strict: true });
		this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
			CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, lane TEXT NOT NULL, position INTEGER NOT NULL, updated_at INTEGER NOT NULL, json TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, last_seen_at INTEGER NOT NULL, json TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
	}

	cards(): Card[] {
		const rows = this.db.query("SELECT json FROM cards ORDER BY position, updated_at, id").all() as Row[];
		return rows.map(readCard);
	}

	card(id: string): Card | null {
		const row = this.db.query("SELECT json FROM cards WHERE id = ?").get(id) as Row | null;
		return row ? readCard(row) : null;
	}

	putCard(card: Card): void {
		this.db
			.query("INSERT INTO cards (id, lane, position, updated_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lane=excluded.lane, position=excluded.position, updated_at=excluded.updated_at, json=excluded.json")
			.run(card.id, card.lane, card.position, card.updatedAt, JSON.stringify(card));
	}

	removeCard(id: string): void {
		this.db.query("DELETE FROM cards WHERE id = ?").run(id);
	}

	agents(): Agent[] {
		const rows = this.db.query("SELECT json FROM agents ORDER BY last_seen_at DESC").all() as Row[];
		return rows.map((row) => JSON.parse(row.json) as Agent);
	}

	agent(id: string): Agent | null {
		const row = this.db.query("SELECT json FROM agents WHERE id = ?").get(id) as Row | null;
		return row ? (JSON.parse(row.json) as Agent) : null;
	}

	putAgent(agent: Agent): void {
		this.db
			.query("INSERT INTO agents (id, last_seen_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, json=excluded.json")
			.run(agent.id, agent.lastSeenAt, JSON.stringify(agent));
	}

	removeAgent(id: string): void {
		this.db.query("DELETE FROM agents WHERE id = ?").run(id);
	}

	settings(): Settings {
		const row = this.db.query("SELECT value FROM settings WHERE key = 'board'").get() as { value: string } | null;
		if (!row) return { ...DEFAULT_SETTINGS };
		try {
			return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) };
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}

	putSettings(settings: Settings): void {
		this.db
			.query("INSERT INTO settings (key, value) VALUES ('board', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
			.run(JSON.stringify(settings));
	}

	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn).immediate();
	}

	close(): void {
		this.db.close();
	}
}
