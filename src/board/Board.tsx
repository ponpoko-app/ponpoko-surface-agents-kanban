import { useState } from "react";
import { LANES, laneCards, type Agent, type Card, type Lane } from "../../shared/board";
import { Column } from "./Column";
import type { DragPayload } from "./dnd";

interface Props {
	cards: Card[];
	agents: Agent[];
	onMove: (id: string, lane: Lane) => void;
	onCreate: (title: string) => void;
	onOpen: (id: string) => void;
	onStart: (id: string) => void;
	onAnswer: (id: string) => void;
}

export function Board({ cards, agents, onMove, onCreate, onOpen, onStart, onAnswer }: Props) {
	const [dragging, setDragging] = useState<DragPayload | null>(null);
	return (
		<div className="board" onDragEnd={() => setDragging(null)}>
			{LANES.map((lane) => (
				<Column
					key={lane}
					lane={lane}
					cards={laneCards(cards, lane)}
					agents={agents}
					dragging={dragging}
					onDropCard={onMove}
					onDragStart={setDragging}
					onDragEnd={() => setDragging(null)}
					onOpen={onOpen}
					onStart={onStart}
					onAnswer={onAnswer}
					onCreate={onCreate}
				/>
			))}
		</div>
	);
}
