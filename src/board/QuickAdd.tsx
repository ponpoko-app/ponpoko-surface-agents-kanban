import { useEffect, useRef, useState } from "react";

interface Props {
	onClose: () => void;
	onCreate: (input: { title: string; deliverable?: string; spec?: string; acceptance?: string; tags?: string[] }) => void;
}

export function QuickAdd({ onClose, onCreate }: Props) {
	const [title, setTitle] = useState("");
	const [deliverable, setDeliverable] = useState("");
	const [acceptance, setAcceptance] = useState("");
	const [tags, setTags] = useState("");
	const [showMore, setShowMore] = useState(false);
	const titleBox = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		titleBox.current?.focus();
	}, []);

	const submit = (): void => {
		const clean = title.trim();
		if (!clean) return;
		onCreate({
			title: clean,
			deliverable: deliverable.trim(),
			acceptance: acceptance.trim(),
			tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
		});
	};

	return (
		<div className="scrim" onClick={onClose} role="presentation">
			<form
				className="quick-add"
				onClick={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<h2>การ์ดใหม่</h2>
				<input
					ref={titleBox}
					value={title}
					placeholder="ทำอะไรให้เสร็จ — เช่น “ปล่อย v0.2 ขึ้น npm”"
					onChange={(event) => setTitle(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !showMore) {
							event.preventDefault();
							submit();
						}
					}}
				/>
				{showMore ? (
					<>
						<label>
							deliverable ที่ปิดจบได้
							<input
								value={deliverable}
								placeholder="tag v0.2 แล้ว publish"
								onChange={(event) => setDeliverable(event.target.value)}
							/>
						</label>
						<label>
							เกณฑ์ผ่าน
							<input
								value={acceptance}
								placeholder="bun run build ผ่าน และ tag อยู่บน origin"
								onChange={(event) => setAcceptance(event.target.value)}
							/>
						</label>
						<label>
							ถนัดที่ต้องการ
							<input value={tags} placeholder="backend, release" onChange={(event) => setTags(event.target.value)} />
						</label>
					</>
				) : (
					<button type="button" className="ghost small left" onClick={() => setShowMore(true)}>
						+ ใส่ deliverable / เกณฑ์ผ่าน
					</button>
				)}
				<div className="row end">
					<button type="button" className="ghost" onClick={onClose}>
						ยกเลิก
					</button>
					<button type="submit" className="primary" disabled={!title.trim()}>
						สร้างการ์ด
					</button>
				</div>
			</form>
		</div>
	);
}
