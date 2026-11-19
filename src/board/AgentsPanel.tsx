import { useEffect, useState } from "react";
import { AGENT_LABELS, AGENT_KINDS, type Agent, type AgentKind, type AgentUsage, type Card, type ScannedAgent } from "../../shared/board";
import { ConnectPanel } from "./ConnectPanel";

interface Props {
	agents: Agent[];
	cards: Card[];
	usage: AgentUsage[];
	scanned: ScannedAgent[];
	scanning: boolean;
	onClose: () => void;
	onAdd: (input: { name: string; kind: AgentKind; capabilities?: string[] }) => void;
	onRemove: (id: string) => void;
	onRescan: () => void;
	onConnect: (kind: string) => void;
	onDisconnect: (kind: string) => void;
}

export function AgentsPanel({
	agents,
	cards,
	usage,
	scanned,
	scanning,
	onClose,
	onAdd,
	onRemove,
	onRescan,
	onConnect,
	onDisconnect,
}: Props) {
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
		<aside className="panel" aria-label="agent ที่ต่ออยู่">
			<header className="panel-head">
				<h2>agent</h2>
				<button type="button" className="ghost small" onClick={onClose}>
					ปิด
				</button>
			</header>
			<ul className="agents">
				{agents.length === 0 && <li className="hint small">ยังไม่มี agent ในบอร์ดนี้</li>}
				{agents.map((agent) => {
					const card = cards.find((item) => item.id === agent.cardId);
					return (
						<li key={agent.id} className="agent">
							<span className={`dot ${agent.state}`} aria-hidden="true" />
							<div className="agent-main">
								<strong>{agent.name}</strong>
								<span className="hint small">
									{AGENT_LABELS[agent.kind]} ·{" "}
									{agent.state === "working" ? `กำลังทำ: ${card?.title ?? agent.cardId}` : agent.state === "idle" ? "ว่าง" : "ออฟไลน์"}
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
			{usage.length > 0 && (
				<section className="vendor-usage" aria-labelledby="vendor-usage-title">
					<h3 id="vendor-usage-title">โควตาผู้ให้บริการ</h3>
					<ul>
						{usage.map(({ kind, used_fraction, runs, saturatedUntil }) => (
							<li key={kind}>
								<strong>{AGENT_LABELS[kind]}</strong>
								{used_fraction !== null && <progress aria-label={`โควตาที่ใช้ของ ${AGENT_LABELS[kind]}`} value={used_fraction} max={1} />}
								<span className="hint small">
									{used_fraction === null ? "ยังไม่มีตัวเลขโควตา" : `ใช้ไป ${Math.round(used_fraction * 100)}%`}
									{` · รัน ${runs} ครั้ง`}
									{saturatedUntil && ` · พักถึง ${new Date(saturatedUntil).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
			<div className="join">
				<label>
					ชื่อ agent ในบอร์ด
					<input value={name} placeholder="เช่น codex-1" onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					ถนัดอะไร (คั่นด้วย ,)
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
			<ConnectPanel
				scanned={scanned}
				scanning={scanning}
				onRescan={onRescan}
				onConnect={onConnect}
				onDisconnect={onDisconnect}
			/>
		</aside>
	);
}
