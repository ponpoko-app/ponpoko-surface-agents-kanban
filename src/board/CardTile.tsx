import type { Agent, Card } from "../../shared/board";
import { DRAG_MIME, encodeDrag, type DragPayload } from "./dnd";

interface Props {
	card: Card;
	agents: Agent[];
	onOpen: (id: string) => void;
	onStart: (id: string) => void;
	onAnswer: (id: string) => void;
	onDragStart: (payload: DragPayload) => void;
	onDragEnd: () => void;
}

const nameOf = (agents: Agent[], id: string | null): string =>
	id ? (agents.find((agent) => agent.id === id)?.name ?? id) : "";

const latest = (card: Card): string => {
	for (let index = card.notes.length - 1; index >= 0; index -= 1) {
		const note = card.notes[index];
		if (note.kind !== "system") return note.text;
	}
	return card.notes[card.notes.length - 1]?.text ?? "";
};

export function CardTile({ card, agents, onOpen, onStart, onAnswer, onDragStart, onDragEnd }: Props) {
	const worker = nameOf(agents, card.assignee);
	const reviewer = nameOf(agents, card.reviewer);
	return (
		<article
			className={`card lane-${card.lane}`}
			draggable
			onDragStart={(event) => {
				event.dataTransfer.setData(DRAG_MIME, encodeDrag({ id: card.id, lane: card.lane }));
				event.dataTransfer.effectAllowed = "move";
				onDragStart({ id: card.id, lane: card.lane });
			}}
			onDragEnd={onDragEnd}
			onClick={() => onOpen(card.id)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen(card.id);
				}
			}}
			tabIndex={0}
			role="button"
			aria-label={`การ์ด ${card.title} ในคอลัมน์ ${card.lane}`}
		>
			<header className="card-head">
				<h3>{card.title}</h3>
				{card.verdict === "pass" && <span className="badge pass">PASS</span>}
				{card.verdict === "fail" && <span className="badge fail">FAIL</span>}
			</header>
			{card.deliverable && <p className="card-deliverable">ปิดให้จบ: {card.deliverable}</p>}
			{card.lane === "blocked" && card.question && <p className="card-question">ถาม: {card.question}</p>}
			{card.tags.length > 0 && (
				<ul className="chips">
					{card.tags.map((tag) => (
						<li key={tag} className="chip">
							{tag}
						</li>
					))}
				</ul>
			)}
			<p className="card-note">{latest(card)}</p>
			<footer className="card-foot">
				<span className="who">{worker ? `ทำ: ${worker}` : "ยังไม่มีคนทำ"}</span>
				{reviewer && <span className="who">ตรวจ: {reviewer}</span>}
			</footer>
			<div className="card-actions">
				{(card.lane === "working" || card.lane === "blocked") && card.interrupted && (
					<button
						type="button"
						className="ghost"
						onClick={(event) => {
							event.stopPropagation();
							onStart(card.id);
						}}
					>
						ทำต่อ
					</button>
				)}
				{card.lane === "blocked" && (
					<button
						type="button"
						className="primary small"
						onClick={(event) => {
							event.stopPropagation();
							onAnswer(card.id);
						}}
					>
						ตอบ
					</button>
				)}
			</div>
		</article>
	);
}
