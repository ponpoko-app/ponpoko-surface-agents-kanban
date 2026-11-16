import { useState } from "react";
import { LANE_HINTS, LANE_LABELS, type Agent, type Card, type Lane } from "../../shared/board";
import { CardTile } from "./CardTile";
import { acceptsDrop, dropTone, type DragPayload } from "./dnd";

interface Props {
	lane: Lane;
	cards: Card[];
	agents: Agent[];
	dragging: DragPayload | null;
	onDropCard: (id: string, lane: Lane) => void;
	onDragStart: (payload: DragPayload) => void;
	onDragEnd: () => void;
	onOpen: (id: string) => void;
	onStart: (id: string) => void;
	onAnswer: (id: string) => void;
	onCreate: (title: string) => void;
}

export function Column({
	lane,
	cards,
	agents,
	dragging,
	onDropCard,
	onDragStart,
	onDragEnd,
	onOpen,
	onStart,
	onAnswer,
	onCreate,
}: Props) {
	const [hover, setHover] = useState(false);
	const [dropAt, setDropAt] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const [composing, setComposing] = useState(false);
	const tone = hover && dragging ? dropTone(dragging.lane, lane) : "idle";
	const legal = dragging ? acceptsDrop(dragging.lane, lane) : false;

	const submit = (): void => {
		const title = draft.trim();
		if (!title) return;
		onCreate(title);
		setDraft("");
	};

	const drop = (): void => {
		setHover(false);
		setDropAt(null);
		if (!dragging || !legal) return;
		onDropCard(dragging.id, lane);
	};

	return (
		<section
			className={`column tone-${tone}${legal ? " legal" : ""}`}
			onDragOver={(event) => {
				if (!dragging) return;
				if (!legal) {
					event.dataTransfer.dropEffect = "none";
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				setHover(true);
			}}
			onDragLeave={() => {
				setHover(false);
				setDropAt(null);
			}}
			onDrop={(event) => {
				event.preventDefault();
				drop();
			}}
			aria-label={`คอลัมน์ ${LANE_LABELS[lane]}`}
		>
			<header className="column-head">
				<h2>{LANE_LABELS[lane]}</h2>
				<span className="count">{cards.length}</span>
			</header>

			{lane === "backlog" && (
				<div className="composer">
					{composing ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								submit();
							}}
						>
							<input
								autoFocus
								value={draft}
								placeholder="ชื่อการ์ด แล้วกด Enter"
								onChange={(event) => setDraft(event.target.value)}
								onBlur={() => {
									if (!draft.trim()) setComposing(false);
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										setDraft("");
										setComposing(false);
									}
								}}
							/>
						</form>
					) : (
						<button type="button" className="ghost wide" onClick={() => setComposing(true)}>
							+ การ์ดใหม่
						</button>
					)}
				</div>
			)}

			<div className="column-body">
				{cards.length === 0 && <p className="empty">{LANE_HINTS[lane]}</p>}
				{cards.map((card, index) => (
					<div key={card.id} className="slot">
						{dropAt === index && legal && <span className="drop-line" aria-hidden="true" />}
						<CardTile
							card={card}
							agents={agents}
							onOpen={onOpen}
							onStart={onStart}
							onAnswer={onAnswer}
							onDragStart={onDragStart}
							onDragEnd={() => {
								onDragEnd();
								setDropAt(null);
							}}
							onDragOver={() => {
								if (legal) setDropAt(index);
							}}
						/>
					</div>
				))}
				{cards.length > 0 && dropAt === cards.length && legal && <span className="drop-line" aria-hidden="true" />}
				{cards.length > 0 && (
					<div
						className="column-tail"
						onDragOver={(event) => {
							if (!legal) return;
							event.preventDefault();
							setDropAt(cards.length);
						}}
						onDrop={(event) => {
							event.preventDefault();
							drop();
						}}
					/>
				)}
			</div>
		</section>
	);
}
