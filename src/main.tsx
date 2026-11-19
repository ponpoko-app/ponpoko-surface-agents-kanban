import { createRoot } from "react-dom/client";
import "./styles/app.css";
import "./styles/cards.css";
import "./styles/panels.css";
import "./styles/attention.css";
import { App } from "./board/App";
import { connect } from "./board/client";

async function main(): Promise<void> {
	const node = document.getElementById("app");
	if (!node) throw new Error("the Agents Kanban surface has no #app element");
	const root = createRoot(node);
	try {
		const client = await connect();
		addEventListener("pagehide", () => client.dispose(), { once: true });
		root.render(<App client={client} />);
	} catch (error) {
		root.render(
			<main className="shell loading">
				<h1>เปิด surface นี้ใน Ponpoko</h1>
				<p>{String(error)}</p>
			</main>,
		);
	}
}

void main();
