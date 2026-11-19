import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckRunner } from "../backend/checks";

const directories: string[] = [];
const open = () => {
	const directory = mkdtempSync(join(tmpdir(), "kanban-check-"));
	directories.push(directory);
	return directory;
};
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true }); });

test("คำสั่งตรวจใช้ cwd ที่กำหนด เก็บปลาย stdout และ stderr แล้วหยุดหลังเจอ exit ที่ไม่ผ่าน", async () => {
	const cwd = open();
	const runner = new CheckRunner();
	const results = await runner.run(cwd, [
		"pwd; printf done > first",
		"printf 'หัวไม่ควรอยู่'; head -c 5000 /dev/zero | tr '\\0' x; printf 'ท้าย'; printf 'ข้อผิดพลาด' >&2; exit 17",
		"touch third",
	], () => {});
	expect(results).toHaveLength(2);
	expect(results[0].output).toMatch(/kanban-check-/);
	expect(existsSync(join(cwd, "first"))).toBe(true);
	expect(results[1].exit).toBe(17);
	expect(results[1].output).toContain("ท้าย");
	expect(results[1].output).toContain("ข้อผิดพลาด");
	expect(results[1].output).not.toContain("หัวไม่ควรอยู่");
	expect(results[1].output.length).toBeLessThanOrEqual(3500);
	expect(existsSync(join(cwd, "third"))).toBe(false);
});

test("หมดเวลาแล้วจบทั้ง process group และไม่เริ่มคำสั่งถัดไป", async () => {
	const cwd = open();
	const runner = new CheckRunner();
	const results = await runner.run(cwd, ["sleep 20 & wait", "touch skipped"], () => {}, 80);
	expect(results).toHaveLength(1);
	expect(results[0].timedOut).toBe(true);
	expect(results[0].exit).not.toBe(0);
	expect(existsSync(join(cwd, "skipped"))).toBe(false);
});
