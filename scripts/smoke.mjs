import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  env: { ...process.env, PONPOKO_SURFACE_DATA_DIR: directory, PONPOKO_SURFACE_ID: "agents-kanban", AGENTS_KANBAN_NO_AGENT_CONFIG: "1" },
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

  await rpc("agent.add", { name: "pi-1", kind: "pi", capabilities: ["backend"] });
  const ready = await rpc("card.move", { id: created.id, lane: "ready_to_test" });
  check(
    "การ์ดพร้อมรันคำสั่งตรวจโดยไม่ต้องจอง agent เพิ่ม",
    ready.lane === "ready_to_test" && ready.reviewer === null,
  );

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const attached = await rpc("card.attach", { id: created.id, name: "bug.png", data_base64: png });
  check("card.attach stores an image on the card", attached.attachments?.length === 1 && attached.attachments[0].mime === "image/png", JSON.stringify(attached.attachments?.[0]?.name));
  const image = await rpc("attachment.read", { id: created.id, attachment_id: attached.attachments[0].id });
  check("attachment.read gives the bytes back", image.data_base64 === png, image.mime);
  let refused = false;
  try {
    await rpc("card.attach", { id: created.id, name: "notes.txt", data_base64: Buffer.from("hello").toString("base64") });
  } catch {
    refused = true;
  }
  check("card.attach refuses a file that is not an image", refused);

  const scan = await rpc("agent.scan");
  check(
    "agent.scan lists the coding agents this machine could connect",
    Array.isArray(scan.agents) && ["codex", "pi", "claude", "gemini", "opencode", "qwen"].every((kind) => scan.agents.some((agent) => agent.kind === kind)),
    (scan.agents ?? []).map((agent) => `${agent.kind}:${agent.installed ? "found" : "missing"}`).join(","),
  );

  const snapshot = await rpc("board.snapshot");
  check(
    "board.snapshot carries cards, agents and the mcp endpoint",
    Array.isArray(snapshot.cards) && snapshot.agents.length >= 2 && typeof snapshot.mcp?.url === "string",
  );
  check("แสดงโควตาของทั้งสี่ชนิดและแสดงค่าที่ยังไม่มีเป็น null",
    snapshot.usage.length === 4 && snapshot.usage.every((row) => row.used_fraction === null));

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

  const decision = await rpc("card.create", { title: "เลือกผู้ชมของรายงาน" });
  await rpc("card.move", { id: decision.id, lane: "working" });
  const question = { text: "ให้ใครเห็นรายงาน", options: ["ทีมภายใน", "ลูกค้า"], recommend: "ทีมภายใน" };
  const ask = async (id, args) => (await post({
    jsonrpc: "2.0", id, method: "tools/call",
    params: { name: "board_ask", arguments: { card_id: decision.id, ...args } },
  })).body?.result;
  const noChoice = await ask(5, { ...question, options: ["ทีมภายใน"] });
  const noRecommendation = await ask(6, { text: question.text, options: question.options });
  const beforeAsk = (await rpc("board.snapshot")).cards.find((card) => card.id === decision.id);
  check("board_ask ปฏิเสธคำถามที่ตัวเลือกไม่ครบหรือขาดคำแนะนำ", noChoice?.isError === true && noRecommendation?.isError === true && beforeAsk?.lane === "working" && beforeAsk?.question === null);

  const asked = await ask(7, question);
  const afterAsk = (await rpc("board.snapshot")).cards.find((card) => card.id === decision.id);
  const reply = await rpc("card.answer", { id: decision.id, answer: "ลูกค้า" });
  check(
    "การ์ดแสดงคำถามจาก MCP และกลับมาทำงานหลังผู้ใช้เลือกคำตอบ",
    !asked?.isError && afterAsk?.lane === "blocked" && afterAsk?.question?.text === question.text &&
      afterAsk.question.options.join("|") === question.options.join("|") && afterAsk.question.recommend === question.recommend &&
      reply.lane === "working" && reply.question === null && reply.answer === "ลูกค้า",
  );

  const attachedViaMcp = await post({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "board_attach", arguments: { card_id: created.id, name: "from-tester.png", data_base64: png } },
  });
  const attachedText = attachedViaMcp.body?.result?.content?.[0]?.text ?? "";
  check("mcp board_attach lets a tester paste a screenshot onto the card", attachedText.includes("from-tester.png") || attachedText.includes("att-"), attachedText.slice(0, 120));

  const called = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "board_list", arguments: {} } });
  const content = called.body?.result?.content?.[0]?.text ?? "";
  check("mcp tools/call board_list returns the cards", content.includes(created.id), content.slice(0, 160));

  const repo = join(directory, "repo");
  await mkdir(repo);
  await writeFile(join(repo, "proof.txt"), "ต้นฉบับ");
  const git = (...args) => {
    const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString();
  };
  git("init", "-q");
  git("add", "proof.txt");
  git("-c", "user.name=Kanban", "-c", "user.email=kanban@example.test", "commit", "-qm", "เริ่มต้น");
  await rpc("board.settings", { patch: { repoPath: repo } });
  const gate = await rpc("card.create", { title: "พิสูจน์ก่อนปิด", lane: "working" });
  const submit = async (checks) => {
    const reply = (await post({ jsonrpc: "2.0", id: 8, method: "tools/call", params: {
      name: "board_submit", arguments: { card_id: gate.id, checks },
    } })).body.result;
    return reply.isError ? reply : JSON.parse(reply.content[0].text);
  };
  check("board_submit ต้องมีคำสั่งตรวจ", (await submit([])).isError === true);
  const red = await submit(["printf 'ตรวจพบข้อผิดพลาด'; exit 7"]);
  check("คำสั่งตรวจไม่ผ่านแล้วการ์ดยังเปิดและเก็บ output", red.lane === "working" && red.notes.some((note) => note.includes("exit 7") && note.includes("ตรวจพบข้อผิดพลาด")));
  const green = await submit([`test "$(git branch --show-current)" = "agents-kanban/${gate.id}" && cat proof.txt`]);
  check("บอร์ดรันคำสั่งใน worktree จริงและปิดการ์ดเมื่อผ่าน", green.lane === "done" && green.notes.some((note) => note.includes("exit 0") && note.includes("ต้นฉบับ")) && git("status", "--porcelain") === "");

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
