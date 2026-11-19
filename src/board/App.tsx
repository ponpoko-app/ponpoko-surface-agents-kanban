import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentsPanel } from "./AgentsPanel";
import { Attention } from "./Attention";
import { Board } from "./Board";
import { CardDrawer } from "./CardDrawer";
import { FirstRun } from "./FirstRun";
import { QuickAdd } from "./QuickAdd";
import { useBoard } from "./useBoard";
import { attentionSummary } from "./attention-queue";
import { filterCards } from "./search";
import type { BoardClient } from "./client";
import { createConsultation } from "./consult";

interface Props {
	client: BoardClient;
}

export function App({ client }: Props) {
	const board = useBoard(client);
	const consult = useMemo(() => createConsultation(client), [client]);
	const [consultReady, setConsultReady] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [draft, setDraft] = useState<{ id: string; askedAt: number; text: string } | null>(null);
	const [agentsOpen, setAgentsOpen] = useState(false);
	const [adding, setAdding] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [repoDraft, setRepoDraft] = useState<string | null>(null);
	const search = useRef<HTMLInputElement | null>(null);
	const previousAttention = useRef(false);
	const [cleared, setCleared] = useState(false);
	const { hasDecisions, working } = useMemo(() => attentionSummary(board.snapshot?.cards ?? []), [board.snapshot?.cards]);

	useLayoutEffect(() => {
		if (hasDecisions) setCleared(false);
		else if (previousAttention.current) setCleared(true);
		previousAttention.current = hasDecisions;
	}, [hasDecisions]);

	useEffect(() => {
		if (!cleared) return;
		const timer = window.setTimeout(() => setCleared(false), 2400);
		return () => window.clearTimeout(timer);
	}, [cleared]);

	useEffect(() => {
		const dispose = client.onPalette((tokens) => {
			for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value);
		});
		return dispose;
	}, [client]);

	useEffect(() => {
		let active = true;
		setConsultReady(false);
		void consult.available().then((available) => { if (active) setConsultReady(available); });
		return () => { active = false; };
	}, [consult]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement | null;
			const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
			if (event.key === "Escape") {
				setOpenId(null);
				setDraft(null);
				setAgentsOpen(false);
				setAdding(false);
				setSettingsOpen(false);
				setQuery("");
				return;
			}
			if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "/") {
				event.preventDefault();
				search.current?.focus();
				return;
			}
			if (event.key === "n") {
				event.preventDefault();
				setAdding(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const snapshot = board.snapshot;
	const visible = useMemo(() => (snapshot ? filterCards(snapshot.cards, query) : []), [snapshot, query]);

	if (!snapshot) {
		return (
			<main className="shell loading">
				<p>{board.error ? `โหลดบอร์ดไม่ได้ — ${board.error}` : "กำลังโหลดบอร์ด…"}</p>
			</main>
		);
	}

	const openCard = snapshot.cards.find((card) => card.id === openId) ?? null;
	const showCard = (id: string | null): void => {
		setDraft(null);
		setOpenId(id);
	};
	const online = snapshot.agents.filter((agent) => agent.state !== "offline").length;
	const firstRun = snapshot.cards.length === 0;
	const repoPath = repoDraft ?? snapshot.settings.repoPath;
	const saveRepo = (): void => {
		if (repoDraft === null) return;
		board.saveSettings({ repoPath: repoDraft.trim() });
		setRepoDraft(null);
	};

	return (
		<main className="shell">
			<header className="topbar">
				<div className="brand">
					<span className="mark" aria-hidden="true">
						▦
					</span>
					<div>
						<h1>Agents Kanban</h1>
						<span className="hint small">
							{online} ออนไลน์ · {snapshot.cards.length} การ์ด
							{query.trim() ? ` · กรอง ${visible.length}` : ""}
						</span>
						{!hasDecisions && !cleared && (
							<span className="quiet-attention hint small">ไม่มีอะไรต้องตัดสินใจ · {working} งานกำลังทำ</span>
						)}
					</div>
				</div>

				<div className="search">
					<input
						ref={search}
						value={query}
						placeholder="ค้นหาการ์ด  ( / )"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>

				<div className="repo-field">
					<input
						value={repoPath}
						placeholder="repo path ของ agent"
						onChange={(event) => setRepoDraft(event.target.value)}
						onBlur={saveRepo}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								saveRepo();
							}
						}}
					/>
				</div>

				<div className="top-actions">
					<button type="button" className="primary" onClick={() => setAdding(true)}>
						+ การ์ด <kbd>n</kbd>
					</button>
					<button type="button" className="ghost" onClick={() => setAgentsOpen(true)}>
						agent ({snapshot.agents.length})
					</button>
					<button
						type="button"
						className="ghost icon"
						aria-expanded={settingsOpen}
						onClick={() => setSettingsOpen((open) => !open)}
					>
						ตั้งค่า
					</button>
				</div>

				{settingsOpen && (
					<div className="settings-pop" role="dialog" aria-label="ตั้งค่าบอร์ด">
						<label className="toggle">
							<input
								type="checkbox"
								checked={snapshot.settings.autoAssign}
								onChange={(event) => board.saveSettings({ autoAssign: event.target.checked })}
							/>
							มอบหมาย agent อัตโนมัติ
						</label>
						<label className="toggle">
							<input
								type="checkbox"
								checked={snapshot.settings.autoResume}
								onChange={(event) => board.saveSettings({ autoResume: event.target.checked })}
							/>
							ทำต่ออัตโนมัติเมื่อเปิด Ponpoko ใหม่
						</label>
						<label>
							งานพร้อมกันสูงสุด
							<input
								type="number"
								min={1}
								max={8}
								value={snapshot.settings.maxConcurrent}
								onChange={(event) => board.saveSettings({ maxConcurrent: Number(event.target.value) })}
							/>
						</label>
					</div>
				)}
			</header>

			{board.error && <p className="banner error">ต่อ backend ไม่ได้: {board.error}</p>}

			<Attention
				cards={snapshot.cards}
				cleared={cleared}
				working={working}
				shortcuts={!openCard && !adding && !agentsOpen && !settingsOpen}
				onAnswer={board.answer}
				onOpen={showCard}
				consult={consultReady ? consult : undefined}
				onDraft={(id, askedAt, text) => {
					setDraft({ id, askedAt, text });
					setOpenId(id);
				}}
			/>

			{firstRun ? (
				<FirstRun
					scanned={board.scanned}
					scanning={board.scanning}
					settings={snapshot.settings}
					onRescan={() => void board.rescan()}
					onConnect={(kind) => void board.connect(kind)}
					onDisconnect={(kind) => void board.disconnect(kind)}
					onSaveSettings={(patch) => void board.saveSettings(patch)}
				/>
			) : null}

			<Board
				cards={visible}
				agents={snapshot.agents}
				searching={query.trim().length > 0}
				onMove={(id, lane) => void board.move(id, lane)}
				onCreate={(title) => void board.create({ title })}
				onOpen={showCard}
				onStart={(id) => void board.start(id)}
				onAnswer={showCard}
			/>

			{openCard && (
				<CardDrawer
					client={client}
					card={openCard}
					agents={snapshot.agents}
					onAttachFiles={(id, files) => {
						for (const file of files) void board.attach(id, file);
					}}
					onDetachFile={(id, attachmentId) => void board.detach(id, attachmentId)}
					onClose={() => showCard(null)}
					onSave={board.update}
					onMove={(id, lane) => void board.move(id, lane)}
					onAnswer={board.answer}
					consult={consultReady ? consult : undefined}
					initialAnswer={draft && draft.id === openCard.id && draft.askedAt === openCard.question?.askedAt ? draft.text : undefined}
					onStart={(id) => void board.start(id)}
					onDelete={(id) => {
						void board.remove(id);
						showCard(null);
					}}
				/>
			)}

			{adding && (
				<QuickAdd
					onClose={() => setAdding(false)}
					onCreate={(input) => {
						void board.create(input);
						setAdding(false);
					}}
				/>
			)}

			{agentsOpen && (
				<AgentsPanel
					agents={snapshot.agents}
					cards={snapshot.cards}
					usage={snapshot.usage ?? []}
					scanned={board.scanned}
					scanning={board.scanning}
					onClose={() => setAgentsOpen(false)}
					onAdd={(input) => void board.addAgent(input)}
					onRemove={(id) => void board.removeAgent(id)}
					onRescan={() => void board.rescan()}
					onConnect={(kind) => void board.connect(kind)}
					onDisconnect={(kind) => void board.disconnect(kind)}
				/>
			)}

			{board.toast && (
				<div className="toast" role="status">
					<span>{board.toast}</span>
					<button type="button" className="ghost small" onClick={board.clearToast}>
						ปิด
					</button>
				</div>
			)}
		</main>
	);
}
