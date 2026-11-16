import type { Attachment } from "../../shared/board";
import { readAttachment, type BoardClient } from "./client";

export const MAX_BYTES = 2 * 1024 * 1024;

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;

export const isImage = (file: File): boolean => IMAGE.test(file.type);

export const fileTooBig = (file: File): boolean => file.size > MAX_BYTES;

export const fileToBase64 = async (file: File): Promise<string> => {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
};

const cache = new Map<string, string>();

export const dataUrlFor = async (client: BoardClient, cardId: string, attachment: Attachment): Promise<string> => {
	const key = `${cardId}:${attachment.id}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const payload = await readAttachment(client, cardId, attachment.id);
	const url = `data:${payload.mime};base64,${payload.data_base64}`;
	cache.set(key, url);
	return url;
};

export const forget = (cardId: string, attachmentId: string): void => {
	cache.delete(`${cardId}:${attachmentId}`);
};

export const filesFromClipboard = (event: ClipboardEvent): File[] => {
	const items = event.clipboardData?.items ?? null;
	if (!items) return [];
	const files: File[] = [];
	for (const item of items) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file && isImage(file)) files.push(file);
	}
	return files;
};

export const filesFromDrop = (event: DragEvent): File[] => {
	const list = event.dataTransfer?.files ?? null;
	if (!list) return [];
	return [...list].filter((file) => isImage(file));
};
