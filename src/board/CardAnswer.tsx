import { useEffect, useRef, useState } from "react";
import type { Card } from "../../shared/board";
import type { ConsultationService } from "./consult";
import { QuestionConsult } from "./QuestionConsult";

interface Props {
	card: Card;
	consult?: ConsultationService;
	initialAnswer?: string;
	onAnswer: (id: string, text: string, askedAt?: number) => Promise<Card | null>;
}

export function CardAnswer({ card, consult, initialAnswer, onAnswer }: Props) {
	const { id, question } = card;
	const [answer, setAnswer] = useState(initialAnswer ?? "");
	const [sending, setSending] = useState(false);
	const answerBox = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (initialAnswer !== undefined) setAnswer(initialAnswer);
		answerBox.current?.focus();
	}, [initialAnswer]);

	const submit = async (text: string): Promise<void> => {
		setSending(true);
		try {
			if (await onAnswer(id, text, question?.askedAt)) setAnswer("");
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="blocked-box">
			<p>{question?.text ?? "การ์ดนี้รอคำตอบจากคุณ"}</p>
			{question?.options.map((option) => (
				<button key={option} type="button" disabled={sending} className={option === question.recommend ? "primary" : "ghost"}
					onClick={() => void submit(option)}>
					{option}{option === question.recommend && " (แนะนำ)"}
				</button>
			))}
			{consult && question?.kind === "decision" && (
				<QuestionConsult
					ask={() => consult.ask(id, question)}
					onDraft={(draft) => {
						setAnswer(draft);
						answerBox.current?.focus();
					}}
				/>
			)}
			<textarea
				ref={answerBox}
				aria-label="คำตอบที่แก้ไขได้"
				value={answer}
				rows={3}
				placeholder="ตอบให้ agent ทำต่อ (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)"
				onChange={(event) => setAnswer(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !sending && answer.trim()) {
						event.preventDefault();
						void submit(answer.trim());
					}
				}}
			/>
			<button type="button" className="primary" disabled={sending || !answer.trim()} onClick={() => void submit(answer.trim())}>
				ส่งคำตอบ
			</button>
		</div>
	);
}
