import { useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "../../shared/board";
import { adjacentIndex, attentionItems, attentionShortcut, recommendedAnswers, rememberQuestions } from "./attention-queue";

interface Props {
	cards: readonly Card[];
	shortcuts: boolean;
	onAnswer: (id: string, text: string, askedAt: number) => Promise<Card | null>;
	onOpen: (id: string) => void;
}

export function Attention({ cards, shortcuts, onAnswer, onOpen }: Props) {
	const decisions = useMemo(() => attentionItems(cards, "decision"), [cards]);
	const problems = useMemo(() => attentionItems(cards, "problem"), [cards]);
	const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
	const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
	const [cursor, setCursor] = useState("");
	const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(0);
	const busy = useRef(false);
	const queue = useMemo(() => decisions.filter(({ key }) => !deferred.has(key)), [decisions, deferred]);
	const index = Math.max(0, queue.findIndex(({ key }) => key === cursor));
	const current = queue[index];
	const chosen = current && selection?.key === current.key ? selection.index : null;
	const total = Math.max(seen.size, queue.length);
	const suggested = recommendedAnswers(queue);

	useEffect(() => {
		setSeen((previous) => rememberQuestions(previous, queue));
		if (!queue.length) setCollapsed(false);
	}, [queue]);

	const move = (offset: number): void => {
		setCursor(queue[adjacentIndex(index, offset, queue.length)].key);
		setSelection(null);
	};

	const submit = async (answers: typeof suggested): Promise<void> => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setFailed(0);
		setSelection(null);
		let failures = 0;
		try {
			for (const { id, answer, askedAt } of answers) {
				if (!await onAnswer(id, answer, askedAt)) failures++;
			}
		} finally {
			busy.current = false;
			setFailed(failures);
			setPending(false);
		}
	};

	const answer = (value: string): void => {
		if (current) void submit([{ id: current.id, answer: value, askedAt: current.question.askedAt }]);
	};

	useEffect(() => {
		if (!shortcuts || !current || collapsed) return;
		const onKey = (event: KeyboardEvent): void => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
			const action = attentionShortcut(event.key, current.question.options.length);
			if (!action) return;
			if (action.action !== "collapse" && (busy.current || target?.isContentEditable || target?.closest("input, textarea, select"))) return;
			if (action.action === "confirm" && chosen === null) return;
			if (event.repeat && action.action !== "move") return;
			event.preventDefault();
			event.stopPropagation();
			switch (action.action) {
				case "move": move(action.offset); break;
				case "select": setSelection({ key: current.key, index: action.index }); break;
				case "confirm": if (chosen !== null) answer(current.question.options[chosen]); break;
				case "accept-all": void submit(suggested); break;
				case "collapse": setCollapsed(true); setSelection(null); break;
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	return (
		<>
			{current && (
				<section className="attention" aria-labelledby="attention-title">
					<header className="attention-header">
						<h2 id="attention-title">ต้องตัดสินใจ</h2>
						<progress aria-label="จำนวนคำถามที่เหลือ" value={queue.length} max={total} />
						<span className="attention-count" aria-live="polite">{queue.length}/{total}</span>
						<div className="attention-actions">
							{!collapsed && <button type="button" className="ghost small" disabled={pending} onClick={() => void submit(suggested)}>ยอมรับทั้งหมด <kbd>a</kbd></button>}
							<button type="button" className="ghost small" aria-expanded={!collapsed} onClick={() => { setCollapsed(!collapsed); setSelection(null); }}>
								{collapsed ? "เปิดคิว" : "ย่อคิว"}
							</button>
						</div>
					</header>
					{!collapsed && (
						<div className="attention-content" key={current.key}>
							<div className="attention-card">
								<button type="button" className="ghost small" aria-label="คำถามก่อนหน้า" disabled={pending || queue.length < 2} onClick={() => move(-1)}>‹</button>
								<button type="button" className="ghost small" aria-label="คำถามถัดไป" disabled={pending || queue.length < 2} onClick={() => move(1)}>›</button>
								<button type="button" className="ghost small attention-card-link" onClick={() => onOpen(current.id)}>{current.title}</button>
							</div>
							<p className="attention-question">{current.question.text}</p>
							<div className="attention-options">
								{current.question.options.map((option, optionIndex) => (
									<button type="button" key={option} className="attention-option" aria-pressed={optionIndex === chosen}
										disabled={pending} onClick={() => answer(option)}>
										{optionIndex < 9 && <kbd>{optionIndex + 1}</kbd>}
										<span>{option}</span>
										{option === current.question.recommend && <span className="attention-recommended">แนะนำ</span>}
									</button>
								))}
							</div>
							<footer className="attention-footer">
								<p>ถ้ายังไม่ตอบ การ์ดจะรอคุณ</p>
								<p className="attention-keys"><kbd>j</kbd>/<kbd>k</kbd> เลื่อน · <kbd>1-{Math.min(current.question.options.length, 9)}</kbd> เลือก · <kbd>Enter</kbd> ยืนยัน</p>
								<button type="button" className="ghost small" disabled={pending} onClick={() => {
									setDeferred((previous) => new Set([...previous, current.key]));
									setSelection(null);
								}}>ไว้ก่อน</button>
							</footer>
							{failed > 0 && <p className="attention-error" role="status">ส่งคำตอบไม่สำเร็จ {failed} ข้อ ลองตอบอีกครั้ง</p>}
						</div>
					)}
				</section>
			)}
			{problems.length > 0 && (
				<section className="attention attention-problems" aria-labelledby="attention-problems-title">
					<h2 id="attention-problems-title">ต้องแก้ไข</h2>
					<ul>
						{problems.map(({ key, id, title, question }) => (
							<li key={key}>
								<p><strong>{title}</strong> <span>{question.text}</span></p>
								<button type="button" className="ghost small" onClick={() => onOpen(id)}>แก้ให้</button>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}
