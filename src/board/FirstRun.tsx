import { useState } from "react";
import type { ScannedAgent, Settings } from "../../shared/board";
import { ConnectPanel } from "./ConnectPanel";

interface Props {
	scanned: ScannedAgent[];
	scanning: boolean;
	settings: Settings;
	onRescan: () => void;
	onConnect: (kind: string) => void;
	onDisconnect: (kind: string) => void;
	onSaveSettings: (patch: Partial<Settings>) => void;
}

export function FirstRun({ scanned, scanning, settings, onRescan, onConnect, onDisconnect, onSaveSettings }: Props) {
	const [repo, setRepo] = useState(settings.repoPath);
	const ready = scanned.some((agent) => agent.connected) && repo.trim().length > 0;

	return (
		<section className="first-run">
			<div className="hero">
				<h2>บอร์ดที่ agent ดึงงานไปทำเอง</h2>
				<p>
					การ์ดอยู่ใน Backlog → agent ที่เชื่อมไว้ดึงไปทำในโฟลเดอร์ที่คุณตั้ง → พอเสร็จส่งให้ agent อีกตัวตรวจ →
					ผ่านก็ปิดงาน ไม่ผ่านก็กลับไปแก้ที่คนเดิม ถ้าติดคำถาม การ์ดจะหยุดที่ Blocked รอคุณตอบ
				</p>
			</div>
			<div className="steps">
				<div className={`step ${repo.trim() ? "done" : ""}`}>
					<span className="step-no">1</span>
					<div className="step-body">
						<strong>เลือกโฟลเดอร์ที่ agent จะทำงาน</strong>
						<input
							value={repo}
							placeholder="/Users/you/project"
							onChange={(event) => setRepo(event.target.value)}
							onBlur={() => onSaveSettings({ repoPath: repo.trim() })}
							onKeyDown={(event) => {
								if (event.key === "Enter") onSaveSettings({ repoPath: repo.trim() });
							}}
						/>
					</div>
				</div>
				<div className={`step ${ready ? "done" : ""}`}>
					<span className="step-no">2</span>
					<div className="step-body">
						<strong>เชื่อม agent ที่ติดตั้งอยู่แล้ว</strong>
						<ConnectPanel
							scanned={scanned}
							scanning={scanning}
							onRescan={onRescan}
							onConnect={onConnect}
							onDisconnect={onDisconnect}
						/>
					</div>
				</div>
				<div className="step">
					<span className="step-no">3</span>
					<div className="step-body">
						<strong>สร้างการ์ดใบแรก</strong>
						<p className="hint small">
							พิมพ์ชื่อการ์ดในช่อง “+ การ์ดใหม่” ที่คอลัมน์ Backlog ด้านล่าง — ใส่ deliverable ให้ปิดจบได้จริง
							เช่น “tag v0.2 แล้ว publish”
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
