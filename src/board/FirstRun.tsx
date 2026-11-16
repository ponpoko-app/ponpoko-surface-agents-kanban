import { useState } from "react";
import { AGENT_LABELS, type AgentKind, type McpInfo } from "../../shared/board";
import { ConnectHelp } from "./ConnectHelp";

interface Props {
	mcp: McpInfo | null;
	onAddAgent: (input: { name: string; kind: AgentKind; capabilities?: string[] }) => void;
}

const KINDS: AgentKind[] = ["codex", "pi", "manual"];

export function FirstRun({ mcp, onAddAgent }: Props) {
	const [name, setName] = useState("");
	const [tags, setTags] = useState("");

	const add = (kind: AgentKind): void => {
		const typed = name.trim() || (kind === "manual" ? "ฉัน" : kind);
		onAddAgent({
			name: typed,
			kind,
			capabilities: tags
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		});
		setName("");
	};

	return (
		<section className="first-run">
			<h2>บอร์ดนี้ให้ agent ดึงงานไปทำเอง</h2>
			<p>
				สร้างการ์ดไว้ใน Backlog — agent ที่ต่อเข้ามาจะดึงไปทำ พอเสร็จส่งให้ agent อีกตัวตรวจ แล้วปิดงานที่ Done ถ้าติดคำถาม
				การ์ดจะไปค้างที่ Blocked รอคำตอบจากคุณ
			</p>
			<ConnectHelp mcp={mcp} />
			<div className="join">
				<label>
					ชื่อ agent
					<input value={name} placeholder="เช่น codex-1" onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					ถนัดอะไร (คั่นด้วย ,)
					<input value={tags} placeholder="backend, frontend" onChange={(event) => setTags(event.target.value)} />
				</label>
			</div>
			<div className="join-actions">
				{KINDS.map((kind) => (
					<button key={kind} type="button" className="primary" onClick={() => add(kind)}>
						เพิ่ม {AGENT_LABELS[kind]}
					</button>
				))}
			</div>
			<p className="hint small">
				agent ที่เพิ่มเองจะได้ session จริงต่อเมื่อตั้ง repo path ที่แถบด้านบน — ชนิด manual คือคุณลากการ์ดเอง ไม่มี session
			</p>
		</section>
	);
}
