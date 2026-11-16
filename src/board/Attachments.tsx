import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../../shared/board";
import { dataUrlFor } from "./media";
import type { BoardClient } from "./client";

interface Props {
	client: BoardClient;
	cardId: string;
	attachments: Attachment[];
	onAttach: (files: File[]) => void;
	onDetach: (attachmentId: string) => void;
}

const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);

function Thumb({
	client,
	cardId,
	attachment,
	onOpen,
}: {
	client: BoardClient;
	cardId: string;
	attachment: Attachment;
	onOpen: (url: string) => void;
}) {
	const [url, setUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let live = true;
		dataUrlFor(client, cardId, attachment)
			.then((value) => {
				if (live) setUrl(value);
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, [client, cardId, attachment]);

	if (failed) return <span className="thumb broken">โหลดไม่ได้</span>;
	if (!url) return <span className="thumb loading" aria-hidden="true" />;
	return (
		<button type="button" className="thumb" onClick={() => onOpen(url)} title={attachment.name}>
			<img src={url} alt={attachment.name} />
		</button>
	);
}

export function Attachments({ client, cardId, attachments, onAttach, onDetach }: Props) {
	const [preview, setPreview] = useState<string | null>(null);
	const [over, setOver] = useState(false);
	const input = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!preview) return;
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setPreview(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [preview]);

	return (
		<section
			className={`attachments${over ? " over" : ""}`}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(event) => {
				event.preventDefault();
				setOver(false);
				const files = [...(event.dataTransfer.files ?? [])].filter((file) => file.type.startsWith("image/"));
				if (files.length > 0) onAttach(files);
			}}
		>
			<header className="attachments-head">
				<h3>รูปแนบ {attachments.length > 0 ? `(${attachments.length})` : ""}</h3>
				<button type="button" className="ghost small" onClick={() => input.current?.click()}>
					แนบรูป
				</button>
				<input
					ref={input}
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp"
					multiple
					hidden
					onChange={(event) => {
						const files = [...(event.target.files ?? [])];
						if (files.length > 0) onAttach(files);
						event.target.value = "";
					}}
				/>
			</header>
			{attachments.length === 0 ? (
				<p className="hint small">วางรูปด้วย Cmd/Ctrl+V หรือลากไฟล์มาวางตรงนี้ — ใช้แนบ UI ที่ต้องการ หรือ screenshot ของบั๊กให้ agent ดู</p>
			) : (
				<ul className="thumbs">
					{attachments.map((attachment) => (
						<li key={attachment.id}>
							<Thumb client={client} cardId={cardId} attachment={attachment} onOpen={setPreview} />
							<div className="thumb-meta">
								<span title={attachment.name}>{attachment.name}</span>
								<span className="hint small">{size(attachment.bytes)}</span>
							</div>
							<button
								type="button"
								className="ghost small remove"
								title="ลบรูปนี้"
								onClick={() => onDetach(attachment.id)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
			{preview && (
				<div className="lightbox" onClick={() => setPreview(null)} role="presentation">
					<img src={preview} alt="" />
				</div>
			)}
		</section>
	);
}
