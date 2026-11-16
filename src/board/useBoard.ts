import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, BoardSnapshot, Card, Lane, ScannedAgent, Settings } from "../../shared/board";
import {
	addAgent as addAgentCall,
	answerCard,
	attachImage,
	detachImage,
	connectAgent as connectAgentCall,
	createCard,
	deleteCard,
	disconnectAgent as disconnectAgentCall,
	fetchSnapshot,
	scanAgents as scanAgentsCall,
	moveCard,
	removeAgent as removeAgentCall,
	saveSettings as saveSettingsCall,
	startCard,
	updateCard,
	type AgentInput,
	type BoardClient,
	type CardPatch,
	type NewCardInput,
} from "./client";
import { fileToBase64, forget, MAX_BYTES } from "./media";

const POLL_MS = 1200;

const replaceCard = (snapshot: BoardSnapshot | null, card: Card): BoardSnapshot | null => {
	if (!snapshot) return snapshot;
	const existing = snapshot.cards.some((item) => item.id === card.id);
	return {
		...snapshot,
		cards: existing ? snapshot.cards.map((item) => (item.id === card.id ? card : item)) : [...snapshot.cards, card],
	};
};

export interface BoardState {
	snapshot: BoardSnapshot | null;
	scanned: ScannedAgent[];
	scanning: boolean;
	error: string | null;
	toast: string | null;
	banner: string | null;
	clearToast: () => void;
	dismissBanner: () => void;
	refresh: () => Promise<void>;
	move: (id: string, lane: Lane, position?: number) => Promise<boolean>;
	create: (input: NewCardInput) => Promise<Card | null>;
	update: (id: string, patch: CardPatch) => Promise<Card | null>;
	answer: (id: string, text: string) => Promise<Card | null>;
	attach: (id: string, file: File) => Promise<boolean>;
	detach: (id: string, attachmentId: string) => Promise<boolean>;
	start: (id: string) => Promise<Card | null>;
	remove: (id: string) => Promise<void>;
	addAgent: (input: AgentInput) => Promise<Agent | null>;
	removeAgent: (id: string) => Promise<void>;
	saveSettings: (patch: Partial<Settings>) => Promise<void>;
	rescan: () => Promise<void>;
	connect: (kind: string) => Promise<void>;
	disconnect: (kind: string) => Promise<void>;
}

export function useBoard(client: BoardClient | null): BoardState {
	const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [scanned, setScanned] = useState<ScannedAgent[]>([]);
	const [scanning, setScanning] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [banner, setBanner] = useState<string | null>(null);
	const asked = useRef(0);
	const mounted = useRef(true);

	const refresh = useCallback(async () => {
		if (!client) return;
		const ticket = ++asked.current;
		try {
			const next = await fetchSnapshot(client);
			if (!mounted.current || ticket !== asked.current) return;
			setSnapshot(next);
			setError(null);
		} catch (failure) {
			if (!mounted.current) return;
			setError(String(failure));
		}
	}, [client]);

	useEffect(() => {
		mounted.current = true;
		void refresh();
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => {
			mounted.current = false;
			clearInterval(timer);
		};
	}, [refresh]);

	const act = useCallback(
		async (label: string, run: () => Promise<Card | void>): Promise<Card | null> => {
			try {
				const result = await run();
				setToast(null);
				if (result && typeof result === "object" && "id" in result) {
					setSnapshot((current) => replaceCard(current, result as Card));
					void refresh();
					return result as Card;
				}
				void refresh();
				return null;
			} catch (failure) {
				setToast(`${label} ไม่สำเร็จ — ${String(failure)}`);
				void refresh();
				return null;
			}
		},
		[refresh],
	);

	const move = useCallback(
		async (id: string, lane: Lane, position?: number) => {
			if (!client) return false;
			setSnapshot((current) => {
				if (!current) return current;
				return { ...current, cards: current.cards.map((card) => (card.id === id ? { ...card, lane } : card)) };
			});
			if (!["done", "blocked"].includes(lane)) setBanner(null);
			const result = await act("ย้ายการ์ด", () => moveCard(client, id, lane, position));
			return result !== null;
		},
		[act, client],
	);

	const attach = useCallback(
		async (id: string, file: File) => {
			if (!client) return false;
			if (file.size > MAX_BYTES) {
				setToast(`รูปใหญ่เกิน ${Math.round(MAX_BYTES / 1024 / 1024)}MB — ย่อก่อนแนบ`);
				return false;
			}
			try {
				const data = await fileToBase64(file);
				const card = await attachImage(client, id, { name: file.name || "screenshot.png", mime: file.type, data_base64: data });
				setSnapshot((current) => replaceCard(current, card));
				return true;
			} catch (failure) {
				setToast(`แนบรูปไม่สำเร็จ — ${String(failure)}`);
				return false;
			}
		},
		[client],
	);

	const detach = useCallback(
		async (id: string, attachmentId: string) => {
			if (!client) return false;
			try {
				const card = await detachImage(client, id, attachmentId);
				forget(id, attachmentId);
				setSnapshot((current) => replaceCard(current, card));
				return true;
			} catch (failure) {
				setToast(`ลบรูปไม่สำเร็จ — ${String(failure)}`);
				return false;
			}
		},
		[client],
	);

	const create = useCallback(
		async (input: NewCardInput) => (client ? act("สร้างการ์ด", () => createCard(client, input)) : null),
		[act, client],
	);

	const update = useCallback(
		async (id: string, patch: CardPatch) => (client ? act("บันทึกการ์ด", () => updateCard(client, id, patch)) : null),
		[act, client],
	);

	const answer = useCallback(
		async (id: string, value: string) => (client ? act("ส่งคำตอบ", () => answerCard(client, id, value)) : null),
		[act, client],
	);

	const start = useCallback(
		async (id: string) => (client ? act("เริ่มงาน", () => startCard(client, id)) : null),
		[act, client],
	);

	const remove = useCallback(
		async (id: string) => {
			if (!client) return;
			setSnapshot((current) => (current ? { ...current, cards: current.cards.filter((card) => card.id !== id) } : current));
			await act("ลบการ์ด", () => deleteCard(client, id));
		},
		[act, client],
	);

	const addAgent = useCallback(
		async (input: AgentInput) => {
			if (!client) return null;
			try {
				const agent = await addAgentCall(client, input);
				void refresh();
				return agent;
			} catch (failure) {
				setToast(`เพิ่ม agent ไม่สำเร็จ — ${String(failure)}`);
				return null;
			}
		},
		[client, refresh],
	);

	const removeAgent = useCallback(
		async (id: string) => {
			if (!client) return;
			try {
				await removeAgentCall(client, id);
				void refresh();
			} catch (failure) {
				setToast(`ลบ agent ไม่สำเร็จ — ${String(failure)}`);
			}
		},
		[client, refresh],
	);

	const saveSettings = useCallback(
		async (patch: Partial<Settings>) => {
			if (!client) return;
			try {
				const settings = await saveSettingsCall(client, patch);
				setSnapshot((current) => (current ? { ...current, settings } : current));
			} catch (failure) {
				setToast(`บันทึกการตั้งค่าไม่สำเร็จ — ${String(failure)}`);
			}
		},
		[client],
	);

	const rescan = useCallback(async () => {
		if (!client) return;
		setScanning(true);
		try {
			setScanned(await scanAgentsCall(client));
		} catch (failure) {
			setToast(`สแกนหา agent ไม่สำเร็จ — ${String(failure)}`);
		} finally {
			setScanning(false);
		}
	}, [client]);

	const connect = useCallback(
		async (kind: string) => {
			if (!client) return;
			try {
				setScanned(await connectAgentCall(client, kind));
				setToast(`เชื่อมต่อ ${kind} แล้ว — เปิด ${kind} ใหม่หนึ่งครั้งให้อ่าน config`);
			} catch (failure) {
				setToast(`เชื่อมต่อไม่สำเร็จ — ${String(failure)}`);
			}
		},
		[client],
	);

	const disconnect = useCallback(
		async (kind: string) => {
			if (!client) return;
			try {
				setScanned(await disconnectAgentCall(client, kind));
				setToast(`ยกเลิกการเชื่อมต่อ ${kind} แล้ว`);
			} catch (failure) {
				setToast(`ยกเลิกไม่สำเร็จ — ${String(failure)}`);
			}
		},
		[client],
	);

	useEffect(() => {
		void rescan();
	}, [rescan]);

	return {
		snapshot,
		scanned,
		scanning,
		error,
		toast,
		banner,
		clearToast: () => setToast(null),
		dismissBanner: () => setBanner(null),
		refresh,
		move,
		create,
		update,
		answer,
		attach,
		detach,
		start,
		remove,
		addAgent,
		removeAgent,
		saveSettings,
		rescan,
		connect,
		disconnect,
	};
}
