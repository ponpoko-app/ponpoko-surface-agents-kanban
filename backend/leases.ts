import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CardRole } from "../shared/board";
import type { BoardStore } from "./store";

export interface Lease {
	cardId: string;
	agentId: string;
	token: string;
	role: CardRole;
	pid: number | null;
}

export const DEFAULT_LEASE_TTL_MS = 90_000;

export class Leases {
	private readonly directory: string;
	private readonly store: BoardStore;

	constructor(store: BoardStore) {
		this.store = store;
		this.directory = join(store.root, "lease-events");
		mkdirSync(this.directory, { recursive: true });
		store.db.exec("CREATE TABLE IF NOT EXISTS leases (cardId TEXT PRIMARY KEY, agentId TEXT NOT NULL UNIQUE, token TEXT NOT NULL, role TEXT NOT NULL, pid INTEGER)");
	}

	get(cardId: string): Lease | null {
		return this.store.db.query("SELECT * FROM leases WHERE cardId = ?").get(cardId) as Lease | null;
	}

	acquire(cardId: string, agentId: string, role: CardRole): Lease | null {
		const lease = { cardId, agentId, role, token: randomUUID(), pid: null };
		return this.store.transaction(() => {
			const { changes } = this.store.db.query("INSERT OR IGNORE INTO leases (cardId, agentId, token, role) VALUES (?, ?, ?, ?)").run(cardId, agentId, lease.token, role);
			if (!changes) return null;
			writeFileSync(this.eventPath(lease), "", { flag: "wx", mode: 0o600 });
			return lease;
		});
	}

	started(lease: Lease, pid: number): void {
		this.store.db.query("UPDATE leases SET pid = ? WHERE cardId = ? AND token = ?").run(pid, lease.cardId, lease.token);
		lease.pid = pid;
	}

	touch(lease: Lease): void {
		const at = new Date();
		try {
			utimesSync(this.eventPath(lease), at, at);
		} catch {
			return;
		}
	}

	release(lease: Lease): boolean {
		const { changes } = this.store.db.query("DELETE FROM leases WHERE cardId = ? AND token = ?").run(lease.cardId, lease.token);
		if (changes) rmSync(this.eventPath(lease), { force: true });
		return changes > 0;
	}

	expired(ttl: number, now = Date.now()): Lease[] {
		const leases = this.store.db.query("SELECT * FROM leases").all() as Lease[];
		return leases.filter((lease) => !processAlive(lease.pid) && now - this.touchedAt(lease) >= ttl);
	}

	eventPath(lease: Lease): string {
		return join(this.directory, `${lease.token}.event`);
	}

	private touchedAt(lease: Lease): number {
		try {
			return statSync(this.eventPath(lease)).mtimeMs;
		} catch {
			return 0;
		}
	}
}

function processAlive(pid: number | null): boolean {
	if (pid === null) return false;
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, 0);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
		}
	}
	return false;
}
