import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Attachment } from "../shared/board";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export interface IncomingAttachment {
	name?: string;
	mime?: string;
	data_base64?: string;
}

const MAGIC: { mime: string; ext: string; test: (bytes: Uint8Array) => boolean }[] = [
	{ mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
	{ mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
	{ mime: "image/gif", ext: "gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
	{
		mime: "image/webp",
		ext: "webp",
		test: (b) =>
			b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
	},
];

export const detectImage = (bytes: Uint8Array): { mime: string; ext: string } | null => {
	if (bytes.length < 12) return null;
	for (const entry of MAGIC) if (entry.test(bytes)) return { mime: entry.mime, ext: entry.ext };
	return null;
};

const safeName = (value: string | undefined, ext: string): string => {
	const base = [...(value ?? "").trim()]
		.filter((character) => character !== "\\" && character !== "/" && (character.codePointAt(0) ?? 0) > 31)
		.join("")
		.slice(0, 80);
	if (!base) return `screenshot.${ext}`;
	return base.includes(".") ? base : `${base}.${ext}`;
};

const newId = (at: number): string => `att-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class Attachments {
	private readonly directory: string;

	constructor(directory: string) {
		this.directory = join(directory, "attachments");
	}

	private cardDir(cardId: string): string {
		return join(this.directory, cardId.replace(/[^a-zA-Z0-9_-]/g, "_"));
	}

	fileFor(cardId: string, attachment: Attachment): string {
		const ext = attachment.mime.split("/")[1] ?? "png";
		return join(this.cardDir(cardId), `${attachment.id}.${ext}`);
	}

	save(cardId: string, incoming: IncomingAttachment): { attachment: Attachment; path: string } {
		const raw = (incoming.data_base64 ?? "").trim();
		if (!raw) throw new Error("ไม่มีข้อมูลรูปมาให้บันทึก");
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(Buffer.from(raw.replace(/^data:[^,]*,/, ""), "base64"));
		} catch {
			throw new Error("อ่านข้อมูลรูปไม่ได้ — ส่งมาเป็น base64 หรือไม่ก็รูปเสีย");
		}
		if (bytes.length === 0) throw new Error("ไฟล์รูปว่างเปล่า");
		if (bytes.length > MAX_ATTACHMENT_BYTES) {
			throw new Error(`รูปใหญ่เกิน ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB (ได้มา ${Math.round(bytes.length / 1024 / 1024)}MB)`);
		}
		const detected = detectImage(bytes);
		if (!detected) throw new Error("ไฟล์นี้ไม่ใช่รูปที่รองรับ — ใช้ PNG, JPEG, GIF หรือ WebP");
		const at = Date.now();
		const attachment: Attachment = {
			id: newId(at),
			name: safeName(incoming.name, detected.ext),
			mime: detected.mime,
			bytes: bytes.length,
			createdAt: at,
		};
		const path = this.fileFor(cardId, attachment);
		mkdirSync(this.cardDir(cardId), { recursive: true });
		writeFileSync(path, bytes);
		return { attachment, path };
	}

	read(cardId: string, attachment: Attachment): { mime: string; data_base64: string } {
		const path = this.fileFor(cardId, attachment);
		if (!existsSync(path)) throw new Error(`ไม่พบไฟล์ ${attachment.name} ในเครื่องแล้ว`);
		return { mime: attachment.mime, data_base64: readFileSync(path).toString("base64") };
	}

	remove(cardId: string, attachment: Attachment): void {
		const path = this.fileFor(cardId, attachment);
		if (existsSync(path)) rmSync(path, { force: true });
	}

	removeCard(cardId: string): void {
		const dir = this.cardDir(cardId);
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	}

	cardFiles(cardId: string): string[] {
		const dir = this.cardDir(cardId);
		return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
	}
}
