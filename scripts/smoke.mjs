import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINARY = join(PROJECT, "dist", "bin", "agents-kanban-backend");

const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    console.log(`ok   ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

const directory = await mkdtemp(join(tmpdir(), "kanban-smoke-"));
const child = Bun.spawn([BINARY], {
  cwd: PROJECT,
  env: { ...process.env, PONPOKO_SURFACE_DATA_DIR: directory, PONPOKO_SURFACE_ID: "agents-kanban" },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

const waiting = new Map();
let nextId = 0;
const onLine = (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const pending = waiting.get(message.id);
  if (!pending) return;
  waiting.delete(message.id);
  pending(message);
};
const reader = child.stdout.getReader();
const decoder = new TextDecoder();
let tail = "";
void (async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    tail += decoder.decode(value, { stream: true });
    let at = tail.indexOf("\n");
    while (at >= 0) {
      const line = tail.slice(0, at).trim();
      tail = tail.slice(at + 1);
      if (line) onLine(line);
      at = tail.indexOf("\n");
    }
  }
})();

const rpc = (method, params = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const id = ++nextId;
    const timer = setTimeout(() => rejectPromise(new Error(`timeout: ${method}`)), 15000);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) rejectPromise(new Error(`${method}: ${message.error.message}`));
      else resolvePromise(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    child.stdin.flush();
  });

let exitCode = 1;
try {
  const info = await rpc("app.info");
  check("app.info answers the surface identity", info.id === "agents-kanban", JSON.stringify(info));

  const created = await rpc("card.create", {
    title: "ปล่อย v0.1 ของบอร์ด",
    deliverable: "tag v0.1 published",
    spec: "บอร์ดใช้งานได้จริง",
    acceptance: "bun run build ผ่าน",
    tags: ["backend"],
  });
  check("card.create returns a backlog card", created.lane === "backlog" && created.id.startsWith("c-"), JSON.stringify(created.lane));

  const agent = await rpc("agent.add", { name: "codex-1", kind: "codex", capabilities: ["backend"] });
  check("agent.add registers a codex worker", agent.kind === "codex" && agent.id.startsWith("a-"), JSON.stringify(agent));

  const moved = await rpc("card.move", { id: created.id, lane: "working" });
  check("card.move backlog→working assigns the free agent", moved.lane === "working" && moved.assignee === agent.id, `${moved.lane}/${moved.assignee}`);

  const blocked = await rpc("card.move", { id: created.id, lane: "blocked" });
  const answered = await rpc("card.answer", { id: created.id, answer: "ใช้ NPM_TOKEN ที่มีอยู่" });
  check(
    "card.answer returns a blocked card to working",
    blocked.lane === "blocked" && answered.lane === "working",
    `${blocked.lane} → ${answered.lane}`,
  );

  let rejected = false;
  try {
    await rpc("card.move", { id: created.id, lane: "done" });
  } catch {
    rejected = true;
  }
  check("card.move rejects an illegal transition (working → done)", rejected);

  const reviewerAgent = await rpc("agent.add", { name: "pi-1", kind: "pi", capabilities: ["backend"] });
  const ready = await rpc("card.move", { id: created.id, lane: "ready_to_test" });
  check(
    "ready_to_test picks a reviewer that is not the implementer",
    ready.reviewer !== null && ready.reviewer !== ready.assignee,
    `${ready.assignee} vs ${ready.reviewer} (${reviewerAgent.id})`,
  );

  const snapshot = await rpc("board.snapshot");
  check(
    "board.snapshot carries cards, agents and the mcp endpoint",
    Array.isArray(snapshot.cards) && snapshot.agents.length >= 2 && typeof snapshot.mcp?.url === "string",
  );

  const mcp = await rpc("mcp.info");
  check("mcp.info exposes a loopback url and a bearer token", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(mcp.url) && mcp.token.length >= 32);

  const unauthenticated = await fetch(mcp.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("mcp rejects a request without the bearer token", unauthenticated.status === 401, String(unauthenticated.status));

  const post = async (body) => {
    const response = await fetch(mcp.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${mcp.token}` },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!text) return { status: response.status, body: null };
    const payload = text.startsWith("event:") || text.startsWith("data:")
      ? JSON.parse(text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join(""))
      : JSON.parse(text);
    return { status: response.status, body: payload };
  };

  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
  check("mcp initialize answers a protocol version", init.body?.result?.protocolVersion === "2025-06-18", JSON.stringify(init.body).slice(0, 200));

  const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = listed.body?.result?.tools ?? [];
  check("mcp tools/list exposes the board tools", tools.length >= 5 && tools.some((tool) => tool.name === "board_claim"), tools.map((tool) => tool.name).join(","));

  const called = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "board_list", arguments: {} } });
  const content = called.body?.result?.content?.[0]?.text ?? "";
  check("mcp tools/call board_list returns the cards", content.includes(created.id), content.slice(0, 160));

  exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
  check("smoke run", false, String(error));
  exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await child.exited;
  await rm(directory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`);
  process.exit(exitCode);
}
console.log("smoke: backend JSON-RPC and MCP round trips hold");
process.exit(0);
