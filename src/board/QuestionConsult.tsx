import { useState } from "react";
import type { Consultation } from "./consult";

interface Props {
	ask: () => Promise<Consultation>;
	onDraft: (draft: string) => void;
}

export function QuestionConsult({ ask, onDraft }: Props) {
	const [result, setResult] = useState<Consultation | null>(null);
	const [loading, setLoading] = useState(false);
	const [unavailable, setUnavailable] = useState(false);

	const explain = async (): Promise<void> => {
		setLoading(true);
		try {
			setResult(await ask());
		} catch {
			setUnavailable(true);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="question-consult">
			{!result && !unavailable && (
				<button type="button" className="ghost small" disabled={loading} onClick={() => void explain()}>
					{loading ? "กำลังเตรียมคำอธิบาย…" : "อธิบายให้ฟังหน่อย"}
				</button>
			)}
			{unavailable && <p className="hint small" role="status">ขอคำอธิบายไม่ได้ตอนนี้ คุณยังเลือกหรือเขียนคำตอบได้</p>}
			{result && (
				<>
					<dl className="consult-result">
						<dt>คำถามนี้หมายถึงอะไร</dt>
						<dd>{result.meaning}</dd>
						<dt>แต่ละทางมีผลอย่างไร</dt>
						<dd>{result.consequences}</dd>
						<dt>คำแนะนำและเหตุผล</dt>
						<dd>{result.recommendation}</dd>
						<dt>ถ้ายังไม่แน่ใจ</dt>
						<dd>{result.fallback}</dd>
					</dl>
					<button type="button" className="ghost small" onClick={() => onDraft(result.draft)}>ตอบให้หน่อย</button>
				</>
			)}
		</div>
	);
}
