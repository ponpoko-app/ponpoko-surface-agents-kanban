import type { ScannedAgent } from "../../shared/board";

interface Props {
	scanned: ScannedAgent[];
	scanning: boolean;
	onRescan: () => void;
	onConnect: (kind: string) => void;
	onDisconnect: (kind: string) => void;
}

const stateOf = (agent: ScannedAgent): { tone: string; text: string } => {
	if (!agent.installed) return { tone: "muted", text: "ไม่พบในเครื่องนี้" };
	if (!agent.supported) return { tone: "muted", text: "ยังเชื่อมต่ออัตโนมัติไม่ได้" };
	if (agent.connected) return { tone: "on", text: "เชื่อมกับบอร์ดนี้แล้ว" };
	return { tone: "ready", text: "พร้อมเชื่อม" };
};

export function ConnectPanel({ scanned, scanning, onRescan, onConnect, onDisconnect }: Props) {
	const found = scanned.filter((agent) => agent.installed);
	return (
		<section className="connect-panel">
			<header className="connect-head">
				<h3>agent ในเครื่องนี้</h3>
				<button type="button" className="ghost small" onClick={onRescan} disabled={scanning}>
					{scanning ? "กำลังสแกน…" : "สแกนใหม่"}
				</button>
			</header>
			<ul className="scan">
				{scanned.map((agent) => {
					const state = stateOf(agent);
					return (
						<li key={agent.kind} className={`scan-row ${state.tone}`}>
							<span className={`dot ${state.tone}`} aria-hidden="true" />
							<div className="scan-main">
								<strong>{agent.label}</strong>
								<span className="hint small">{state.text}</span>
							</div>
							{agent.supported && agent.installed && (
								<button
									type="button"
									className={agent.connected ? "ghost small" : "primary small"}
									onClick={() => (agent.connected ? onDisconnect(agent.kind) : onConnect(agent.kind))}
								>
									{agent.connected ? "ยกเลิกการเชื่อมต่อ" : "เชื่อมต่อ"}
								</button>
							)}
						</li>
					);
				})}
			</ul>
			<p className="hint small">
				{found.length === 0
					? "ยังไม่พบ coding agent ในเครื่อง — ติดตั้ง codex หรือ pi ก่อน แล้วกดสแกนใหม่"
					: "กดเชื่อมต่อแล้วเปิด agent ใหม่หนึ่งครั้ง config จะถูกเขียนให้เอง ไม่ต้องคัดลอกคำสั่ง"}
			</p>
		</section>
	);
}
