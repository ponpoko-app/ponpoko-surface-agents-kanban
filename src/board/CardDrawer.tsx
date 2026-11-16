import { useEffect, useState } from "react";
import { LANE_LABELS, moveTargets, type Agent, type Card, type Lane } from "../../shared/board";

interface Props {
	card: Card;
	agents: Agent[];
	onClose: () => void;
	onSave: (id: string, patch: { title?: string; deliverable?: string; spec?: string; acceptance?: string; tags?: string[] }) => void;
	onMove: (id: string, lane: Lane) => void;
	onAnswer: (id: string, text: string) => void;
	onStart: (id: string) => void;
	onDelete: (id: string) => void;
}

const nameOf = (agents: Agent[], id: string | null): string => (id ? (agents.find((a) => a.id === id)?.name ?? id) : "—");

export function CardDrawer({ card, agents, onClose, onSave, onMove, onAnswer, onStart, onDelete }: Props) {
	const [title, setTitle] = useState(card.title);
	const [deliverable, setDeliverable] = useState(card.deliverable);
	const [spec, setSpec] = useState(card.spec);
	const [acceptance, setAcceptance] = useState(card.acceptance);
	const [tags, setTags] = useState(card.tags.join(", "));
	const [answer, setAnswer] = useState("");
	const [confirming, setConfirming] = useState(false);

	useEffect(() => {
		setTitle(card.title);
		setDeliverable(card.deliverable);
		setSpec(card.spec);
		setAcceptance(card.acceptance);
		setTags(card.tags.join(", "));
		setConfirming(false);
	}, [card.id, card.title, card.deliverable, card.spec, card.acceptance, card.tags]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const dirty =
		title !== card.title ||
		deliverable !== card.deliverable ||
		spec !== card.spec ||
		acceptance !== card.acceptance ||
		tags !== card.tags.join(", ");

	return (
		<aside className="drawer" aria-label={`การ์ด ${card.title}`}>
			<header className="drawer-head">
				<span className="pill">{LANE_LABELS[card.lane]}</span>
				<button type="button" className="ghost" onClick={onClose} aria-label="ปิด">
					ปิด
				</button>
			</header>
			<label>
				ชื่อการ์ด
				<input value={title} onChange={(event) => setTitle(event.target.value)} />
			</label>
			<label>
				deliverable ที่ต้องปิดให้จบ
				<input
					value={deliverable}
					placeholder="เช่น tag v0.1 ที่ publish แล้ว"
					onChange={(event) => setDeliverable(event.target.value)}
				/>
			</label>
			<label>
				สเปก
				<textarea value={spec} rows={3} onChange={(event) => setSpec(event.target.value)} />
			</label>
			<label>
				เกณฑ์ผ่าน
				<textarea value={acceptance} rows={2} onChange={(event) => setAcceptance(event.target.value)} />
			</label>
			<label>
				ถนัดที่ต้องการ (คั่นด้วย ,)
				<input value={tags} onChange={(event) => setTags(event.target.value)} />
			</label>
			<div className="row">
				<button
					type="button"
					className="primary"
					disabled={!dirty}
					onClick={() =>
						onSave(card.id, {
							title,
							deliverable,
							spec,
							acceptance,
							tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
						})
					}
				>
					บันทึก
				</button>
				{card.lane === "backlog" && (
					<button type="button" className="primary" onClick={() => onMove(card.id, "working")}>
						เริ่มทำงาน
					</button>
				)}
				{(card.lane === "working" || card.lane === "fix") && (
					<button type="button" className="primary" onClick={() => onStart(card.id)}>
						ทำงานต่อ
					</button>
				)}
			</div>
			<p className="hint small">
				ทำ: {nameOf(agents, card.assignee)} · ตรวจ: {nameOf(agents, card.reviewer)} · session:{" "}
				{card.sessions.implementer ? "มีแล้ว" : "ยังไม่มี"}
			</p>
			{card.lane === "blocked" && (
				<div className="blocked-box">
					<p>{card.question ?? "การ์ดนี้รอคำตอบจากคุณ"}</p>
					<textarea
						value={answer}
						rows={3}
						placeholder="ตอบให้ agent ทำต่อ"
						onChange={(event) => setAnswer(event.target.value)}
					/>
					<button
						type="button"
						className="primary"
						disabled={!answer.trim()}
						onClick={() => {
							onAnswer(card.id, answer.trim());
							setAnswer("");
						}}
					>
						ส่งคำตอบ
					</button>
				</div>
			)}
			<div className="moves">
				<span className="hint small">ย้ายไป</span>
				{moveTargets(card.lane).map((lane) => (
					<button key={lane} type="button" className="ghost" onClick={() => onMove(card.id, lane)}>
						{LANE_LABELS[lane]}
					</button>
				))}
			</div>
			<div className="notes">
				<h3>บันทึก</h3>
				{card.notes.length === 0 && <p className="hint small">ยังไม่มีอะไรเกิดขึ้นกับการ์ดนี้</p>}
				<ul>
					{card.notes.map((note, index) => (
						<li key={`${note.at}-${index}`} className={`note kind-${note.kind}`}>
							<span className="note-time">{new Date(note.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
							<span>{note.text}</span>
						</li>
					))}
				</ul>
			</div>
			<footer className="drawer-foot">
				{confirming ? (
					<span className="row">
						<span className="hint small">ลบการ์ดนี้ถาวร?</span>
						<button type="button" className="danger" onClick={() => onDelete(card.id)}>
							ลบเลย
						</button>
						<button type="button" className="ghost" onClick={() => setConfirming(false)}>
							ยกเลิก
						</button>
					</span>
				) : (
					<button type="button" className="ghost" onClick={() => setConfirming(true)}>
						ลบการ์ด
					</button>
				)}
			</footer>
		</aside>
	);
}
