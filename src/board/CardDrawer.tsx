import { useEffect, useState } from "react";
import { LANE_LABELS, moveTargets, type Agent, type Card, type Lane } from "../../shared/board";
import { Attachments } from "./Attachments";
import { CardAnswer } from "./CardAnswer";
import type { BoardClient } from "./client";
import type { ConsultationService } from "./consult";
import { filesFromClipboard } from "./media";

interface Props {
	client: BoardClient;
	card: Card;
	agents: Agent[];
	onAttachFiles: (cardId: string, files: File[]) => void;
	onDetachFile: (cardId: string, attachmentId: string) => void;
	onClose: () => void;
	onSave: (id: string, patch: { title?: string; deliverable?: string; spec?: string; acceptance?: string; tags?: string[] }) => void;
	onMove: (id: string, lane: Lane) => void;
	onAnswer: (id: string, text: string, askedAt?: number) => Promise<Card | null>;
	consult?: ConsultationService;
	initialAnswer?: string;
	onStart: (id: string) => void;
	onDelete: (id: string) => void;
}

const nameOf = (agents: Agent[], id: string | null): string => (id ? (agents.find((a) => a.id === id)?.name ?? id) : "—");

const when = (at: number): string => new Date(at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export function CardDrawer({
	client,
	card,
	agents,
	onAttachFiles,
	onDetachFile,
	onClose,
	onSave,
	onMove,
	onAnswer,
	consult,
	initialAnswer,
	onStart,
	onDelete,
}: Props) {
	const [title, setTitle] = useState(card.title);
	const [deliverable, setDeliverable] = useState(card.deliverable);
	const [spec, setSpec] = useState(card.spec);
	const [acceptance, setAcceptance] = useState(card.acceptance);
	const [tags, setTags] = useState(card.tags.join(", "));
	const [confirming, setConfirming] = useState(false);
	const [saved, setSaved] = useState(true);

	useEffect(() => {
		setTitle(card.title);
		setDeliverable(card.deliverable);
		setSpec(card.spec);
		setAcceptance(card.acceptance);
		setTags(card.tags.join(", "));
		setConfirming(false);
		setSaved(true);
	}, [card.id, card.title, card.deliverable, card.spec, card.acceptance, card.tags]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(() => {
		if (saved) return;
		const timer = setTimeout(() => {
			onSave(card.id, {
				title,
				deliverable,
				spec,
				acceptance,
				tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
			});
			setSaved(true);
		}, 500);
		return () => clearTimeout(timer);
	}, [saved, title, deliverable, spec, acceptance, tags, card.id, onSave]);

	const touch = (): void => setSaved(false);

	return (
		<aside
			className="panel drawer"
			aria-label={`การ์ด ${card.title}`}
			onPaste={(event) => {
				const files = filesFromClipboard(event.nativeEvent);
				if (files.length === 0) return;
				event.preventDefault();
				onAttachFiles(card.id, files);
			}}
		>
			<header className="panel-head">
				<span className="pill">{LANE_LABELS[card.lane]}</span>
				<span className={`saved ${saved ? "quiet" : "busy"}`}>{saved ? "บันทึกแล้ว" : "กำลังบันทึก…"}</span>
				<button type="button" className="ghost small" onClick={onClose} aria-label="ปิด">
					ปิด
				</button>
			</header>

			<input className="title-input" value={title} onChange={(event) => { setTitle(event.target.value); touch(); }} />

			<label>
				deliverable ที่ปิดให้จบ
				<input
					value={deliverable}
					placeholder="เช่น tag v0.2 ที่ publish แล้ว"
					onChange={(event) => {
						setDeliverable(event.target.value);
						touch();
					}}
				/>
			</label>
			<label>
				สเปก
				<textarea
					value={spec}
					rows={3}
					onChange={(event) => {
						setSpec(event.target.value);
						touch();
					}}
				/>
			</label>
			<label>
				เกณฑ์ผ่าน
				<textarea
					value={acceptance}
					rows={2}
					onChange={(event) => {
						setAcceptance(event.target.value);
						touch();
					}}
				/>
			</label>
			<label>
				ถนัดที่ต้องการ (คั่นด้วย ,)
				<input
					value={tags}
					onChange={(event) => {
						setTags(event.target.value);
						touch();
					}}
				/>
			</label>

			<Attachments
				client={client}
				cardId={card.id}
				attachments={card.attachments}
				onAttach={(files) => onAttachFiles(card.id, files)}
				onDetach={(attachmentId) => onDetachFile(card.id, attachmentId)}
			/>

			<div className="row">
				{card.lane === "backlog" && (
					<button type="button" className="primary" onClick={() => onMove(card.id, "working")}>
						เริ่มทำงาน
					</button>
				)}
				{(card.lane === "working" || card.lane === "fix") && (
					<button type="button" className="primary" onClick={() => onStart(card.id)}>
						{card.sessions.implementer ? "ทำงานต่อใน session เดิม" : "เริ่ม session"}
					</button>
				)}
				{card.lane === "ready_to_test" && (
					<button type="button" className="ghost" onClick={() => onMove(card.id, "done")}>
						ปิดงาน
					</button>
				)}
			</div>

			<p className="hint small">
				ทำ: {nameOf(agents, card.assignee)} · ตรวจ: {nameOf(agents, card.reviewer)} · session:{" "}
				{card.sessions.implementer ? "มีแล้ว" : "ยังไม่มี"}
			</p>

			{card.lane === "blocked" && (
				<CardAnswer key={`${card.id}:${card.question?.askedAt}`} card={card} onAnswer={onAnswer} consult={consult} initialAnswer={initialAnswer} />
			)}

			<div className="moves">
				<span className="hint small">ย้ายไป</span>
				{moveTargets(card.lane).map((lane) => (
					<button key={lane} type="button" className="ghost small" onClick={() => onMove(card.id, lane)}>
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
							<span className="note-time">{when(note.at)}</span>
							<span>{note.text}</span>
						</li>
					))}
				</ul>
			</div>

			<footer className="panel-foot">
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
					<button type="button" className="ghost small" onClick={() => setConfirming(true)}>
						ลบการ์ด
					</button>
				)}
			</footer>
		</aside>
	);
}
