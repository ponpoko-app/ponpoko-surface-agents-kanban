import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

const git = (...argv: string[]): string => {
	const result = Bun.spawnSync(["git", ...argv], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || "คำสั่ง Git ไม่สำเร็จ");
	return result.stdout.toString().trim();
};

function commonDirectory(directory: string): string {
	return realpathSync(git("-C", directory, "rev-parse", "--path-format=absolute", "--git-common-dir"));
}

export class Worktrees {
	private readonly dataDirectory: string;

	constructor(dataDirectory: string) {
		this.dataDirectory = dataDirectory;
	}

	path(cardId: string): string {
		if (!/^[a-z0-9][a-z0-9-]*$/i.test(cardId)) throw new Error("รหัสการ์ดใช้สร้าง worktree ไม่ได้");
		return join(this.dataDirectory, "worktrees", cardId);
	}

	ensure(cardId: string, repository: string): string {
		if (!repository) throw new Error("ยังไม่ได้ตั้งที่เก็บโค้ดของบอร์ด");
		const root = realpathSync(git("-C", repository, "rev-parse", "--show-toplevel"));
		const target = this.path(cardId);
		if (!existsSync(target)) {
			mkdirSync(join(this.dataDirectory, "worktrees"), { recursive: true });
			git("-C", root, "worktree", "add", "-b", `agents-kanban/${cardId}`, "--", target, "HEAD");
		}
		if (this.managedDirectory(cardId) !== commonDirectory(root)) {
			throw new Error("worktree ของการ์ดอยู่คนละที่เก็บโค้ดกับที่ตั้งไว้");
		}
		return realpathSync(target);
	}

	remove(cardId: string): void {
		const target = this.path(cardId);
		if (!existsSync(target)) return;
		const directory = this.managedDirectory(cardId);
		try {
			git(`--git-dir=${directory}`, "worktree", "remove", "--", target);
		} catch (error) {
			throw new Error(`ลบ worktree ไม่ได้ เก็บงานใน ${target} ก่อนแล้วลองใหม่ · ${String(error)}`);
		}
	}

	private managedDirectory(cardId: string): string {
		const target = this.path(cardId);
		if (!lstatSync(target).isDirectory() || !lstatSync(join(target, ".git")).isFile()) {
			throw new Error("พาธของการ์ดไม่ใช่ worktree ที่บอร์ดจัดการ");
		}
		const expected = realpathSync(target);
		const root = realpathSync(git("-C", target, "rev-parse", "--show-toplevel"));
		if (root !== expected) throw new Error("worktree ไม่ตรงกับการ์ด");
		return commonDirectory(target);
	}
}
