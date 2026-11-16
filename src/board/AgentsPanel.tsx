import { useEffect, useState } from "react";
import { AGENT_LABELS, AGENT_KINDS, type Agent, type AgentKind, type Card, type McpInfo } from "../../shared/board";
import { ConnectHelp } from "./ConnectHelp";

interface Props {
	agents: Agent[];
	cards: Card[];
	mcp: McpInfo | null;
	onClose: () => void;
	onAdd: (input: { name: string; kind: AgentKind; capabilities?: string[] }) => void;
	onRemove: (id: string) => void;
}

export function AgentsPanel({ agents, cards, mcp, onClose, onAdd, onRemove }: Props) {
	const [name, setName] = useState("");
	const [tags, setTags] = useState("");

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const add = (kind: AgentKind): void => {
		onAdd({
			name: name.trim() || (kind === "manual" ? "ฉัน" : kind),
			kind,
			capabilities: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
		});
		setName("");
	};

	return (
		<aside className="drawer" aria-label="agent ที่ต่ออยู่">
			<header className="drawer-head">
				<h2>agent</h2>
				<button type="button" className="ghost" onClick={onClose}>
					ปิด
				</button>
			</header>
			<ul className="agents">
				{agents.length === 0 && <li className="hint">ยังไม่มี agent ต่อเข้ามา</li>}
				{agents.map((agent) => {
					const card = cards.find((item) => item.id === agent.cardId);
					return (
						<li key={agent.id} className="agent">
							<span className={`dot ${agent.state}`} aria-hidden="true" />
							<div className="agent-main">
								<strong>{agent.name}</strong>
								<span className="hint small">
									{AGENT_LABELS[agent.kind]} · {agent.state === "working" ? `กำลังทำ: ${card?.title ?? agent.cardId}` : agent.state === "idle" ? "ว่าง" : "ออฟไลน์"}
								</span>
								{agent.capabilities.length > 0 && (
									<ul className="chips">
										{agent.capabilities.map((tag) => (
											<li key={tag} className="chip">
												{tag}
											</li>
										))}
									</ul>
								)}
							</div>
							<button type="button" className="ghost small" onClick={() => onRemove(agent.id)}>
								ลบ
							</button>
						</li>
					);
				})}
			</ul>
			<div className="join">
				<label>
					ชื่อ agent
					<input value={name} placeholder="เช่น codex-1" onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					ถนัดอะไร
					<input value={tags} placeholder="backend" onChange={(event) => setTags(event.target.value)} />
				</label>
			</div>
			<div className="join-actions">
				{AGENT_KINDS.map((kind) => (
					<button key={kind} type="button" className="primary small" onClick={() => add(kind)}>
						{AGENT_LABELS[kind]}
					</button>
				))}
			</div>
			<ConnectHelp mcp={mcp} />
		</aside>
	);
}
