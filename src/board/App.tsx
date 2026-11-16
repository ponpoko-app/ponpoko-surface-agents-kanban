import { useEffect, useState } from "react";
import { AgentsPanel } from "./AgentsPanel";
import { Board } from "./Board";
import { CardDrawer } from "./CardDrawer";
import { FirstRun } from "./FirstRun";
import { ConnectHelp } from "./ConnectHelp";
import { useBoard } from "./useBoard";
import type { BoardClient } from "./client";

interface Props {
	client: BoardClient;
}

export function App({ client }: Props) {
	const board = useBoard(client);
	const [openId, setOpenId] = useState<string | null>(null);
	const [agentsOpen, setAgentsOpen] = useState(false);
	const [hintClosed, setHintClosed] = useState(false);
	const [repoDraft, setRepoDraft] = useState<string | null>(null);

	useEffect(() => {
		const dispose = client.onPalette((tokens) => {
			for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value);
		});
		return dispose;
	}, [client]);

	const snapshot = board.snapshot;
	if (!snapshot) {
		return (
			<main className="shell loading">
				<p>{board.error ? `โหลดบอร์ดไม่ได้ — ${board.error}` : "กำลังโหลดบอร์ด…"}</p>
			</main>
		);
	}

	const openCard = snapshot.cards.find((card) => card.id === openId) ?? null;
	const online = snapshot.agents.filter((agent) => agent.state !== "offline").length;
	const firstRun = snapshot.agents.length === 0;
	const hasCards = snapshot.cards.length > 0;
	const repoPath = repoDraft ?? snapshot.settings.repoPath;

	const saveRepo = (): void => {
		if (repoDraft === null) return;
		board.saveSettings({ repoPath: repoDraft });
		setRepoDraft(null);
	};

	return (
		<main className="shell">
			<header className="topbar">
				<div className="brand">
					<h1>Agents Kanban</h1>
					<span className="hint small">{online} agent ออนไลน์ · {snapshot.cards.length} การ์ด</span>
				</div>
				<label className="repo">
					<span className="hint small">repo path</span>
					<input
						value={repoPath}
						placeholder="/Users/you/project"
						onChange={(event) => setRepoDraft(event.target.value)}
						onBlur={saveRepo}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								saveRepo();
							}
						}}
					/>
				</label>
				<div className="toggles">
					<label className="toggle">
						<input
							type="checkbox"
							checked={snapshot.settings.autoAssign}
							onChange={(event) => board.saveSettings({ autoAssign: event.target.checked })}
						/>
						มอบหมายอัตโนมัติ
					</label>
					<label className="toggle">
						<input
							type="checkbox"
							checked={snapshot.settings.autoResume}
							onChange={(event) => board.saveSettings({ autoResume: event.target.checked })}
						/>
						ทำต่ออัตโนมัติหลังเปิดแอป
					</label>
				</div>
				<div className="top-actions">
					<button type="button" className="ghost" onClick={() => setAgentsOpen(true)}>
						agent ({snapshot.agents.length})
					</button>
					<button type="button" className="ghost" onClick={() => void board.refresh()}>
						รีเฟรช
					</button>
				</div>
			</header>

			{board.error && <p className="banner error">ต่อ backend ไม่ได้: {board.error}</p>}

			{firstRun ? (
				<FirstRun mcp={snapshot.mcp} onAddAgent={(input) => void board.addAgent(input)} />
			) : (
				<>
					{!hasCards && !hintClosed && (
						<p className="banner hint-banner">
							ยังไม่มีการ์ด — พิมพ์ชื่อการ์ดในช่อง “+ การ์ดใหม่” ที่คอลัมน์ Backlog แล้วกด Enter
							<button type="button" className="ghost small" onClick={() => setHintClosed(true)}>
								เข้าใจแล้ว
							</button>
						</p>
					)}
					<Board
						cards={snapshot.cards}
						agents={snapshot.agents}
						onMove={(id, lane) => void board.move(id, lane)}
						onCreate={(title) => void board.create({ title })}
						onOpen={setOpenId}
						onStart={(id) => void board.start(id)}
						onAnswer={setOpenId}
					/>
					{!hasCards && <ConnectHelp mcp={snapshot.mcp} />}
				</>
			)}

			{openCard && (
				<CardDrawer
					card={openCard}
					agents={snapshot.agents}
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

			{agentsOpen && (
				<AgentsPanel
					agents={snapshot.agents}
					cards={snapshot.cards}
					mcp={snapshot.mcp}
					onClose={() => setAgentsOpen(false)}
					onAdd={(input) => void board.addAgent(input)}
					onRemove={(id) => void board.removeAgent(id)}
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
