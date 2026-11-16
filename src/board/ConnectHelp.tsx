import { useState } from "react";
import type { McpInfo } from "../../shared/board";

interface Props {
	mcp: McpInfo | null;
}

export function ConnectHelp({ mcp }: Props) {
	const [copied, setCopied] = useState<string | null>(null);

	const copy = async (label: string, value: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(label);
			setTimeout(() => setCopied(null), 2000);
		} catch {
			setCopied(null);
		}
	};

	if (!mcp) {
		return <p className="hint">บอร์ดกำลังเปิด MCP server อยู่ — รอสักครู่แล้วกดรีเฟรช</p>;
	}

	const token = `export KANBAN_TOKEN=${mcp.token}`;

	return (
		<div className="connect">
			<p className="hint">ต่อ agent เข้ากับบอร์ดนี้ด้วยคำสั่งเดียว (รันใน terminal ที่แอป agent อยู่):</p>
			{mcp.codex && (
				<div className="cmd">
					<code>{mcp.codex}</code>
					<button type="button" className="ghost small" onClick={() => void copy("codex", `${token}\n${mcp.codex}`)}>
						{copied === "codex" ? "คัดลอกแล้ว" : "คัดลอก"}
					</button>
				</div>
			)}
			{mcp.pi && (
				<div className="cmd">
					<code>{mcp.pi}</code>
					<button type="button" className="ghost small" onClick={() => void copy("pi", `${token}\n${mcp.pi}`)}>
						{copied === "pi" ? "คัดลอกแล้ว" : "คัดลอก"}
					</button>
				</div>
			)}
			<div className="cmd">
				<code>{token}</code>
				<button type="button" className="ghost small" onClick={() => void copy("token", token)}>
					{copied === "token" ? "คัดลอกแล้ว" : "คัดลอก token"}
				</button>
			</div>
			<p className="hint small">token นี้เปลี่ยนทุกครั้งที่เปิด Ponpoko ใหม่ — ต่อใหม่หลังรีสตาร์ทแอป</p>
		</div>
	);
}
