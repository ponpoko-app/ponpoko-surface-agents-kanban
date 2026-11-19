import { useEffect, useMemo, useRef, useState } from "react";
import { AgentsPanel } from "./AgentsPanel";
import { Attention } from "./Attention";
import { Board } from "./Board";
import { CardDrawer } from "./CardDrawer";
import { FirstRun } from "./FirstRun";
import { QuickAdd } from "./QuickAdd";
import { useBoard } from "./useBoard";
import { filterCards } from "./search";
import type { BoardClient } from "./client";

interface Props {
	client: BoardClient;
}

export function App({ client }: Props) {
	const board = useBoard(client);
	const [openId, setOpenId] = useState<string | null>(null);
	const [agentsOpen, setAgentsOpen] = useState(false);
	const [adding, setAdding] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [repoDraft, setRepoDraft] = useState<string | null>(null);
	const search = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const dispose = client.onPalette((tokens) => {
			for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value);
		});
		return dispose;
	}, [client]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement | null;
			const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
			if (event.key === "Escape") {
				setOpenId(null);
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
				shortcuts={!openCard && !adding && !agentsOpen && !settingsOpen}
				onAnswer={board.answer}
				onOpen={setOpenId}
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
				onOpen={setOpenId}
				onStart={(id) => void board.start(id)}
				onAnswer={setOpenId}
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
					onClose={() => setOpenId(null)}
					onSave={(id, patch) => void board.update(id, patch)}
					onMove={(id, lane) => void board.move(id, lane)}
					onAnswer={(id, text) => void board.answer(id, text)}
					onStart={(id) => void board.start(id)}
					onDelete={(id) => {
						void board.remove(id);
						setOpenId(null);
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
