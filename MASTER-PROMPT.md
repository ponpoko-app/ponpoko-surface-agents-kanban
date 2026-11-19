# MASTER-PROMPT — Agents Kanban

อ่านไฟล์นี้ก่อนแตะโค้ดใด ๆ แล้วเปิด `TRACKER.md` เพื่อดูว่าตอนนี้อยู่ lap ไหน
ไฟล์นี้อธิบาย **หลักการและกรอบ** ไม่ใช่ task list — task list อยู่ใน `TRACKER.md`

---

## 1. ผลิตภัณฑ์นี้คืออะไร

มนุษย์บอกว่าอยากได้อะไร → agent ตัวใดตัวหนึ่งที่ต่อกับบอร์ดผ่าน MCP grill มนุษย์จนเข้าใจตรงกัน → ทำงานใน worktree ของการ์ดใบนั้น → board รัน check ที่ agent ระบุเองใน worktree นั้น → ผ่าน = ส่งมอบพร้อมหลักฐานที่มนุษย์กดดูได้

surface นี้เป็น **บอร์ดกลาง + MCP server** agent ทุกค่าย (codex, pi, claude, gemini) ต่อเข้ามาแบบเดียวกัน ไม่มีใครพิเศษ
ผู้ใช้คือคนเดียว ไม่ใช่ทีม: ทุกอย่างต้องตอบคำถามเดียว — "ตอนนี้มีอะไรให้ฉันตัดสินใจ และใช้เวลากี่นาที"

---

## 2. หลักการเดียวที่ทุกอย่างตามมา

> **surface ไม่รู้ว่าอะไร "ถูก" — check ของการ์ดใบนั้นรู้**
> หน้าที่ของ surface คือทำให้คำโกหกไม่มีที่อยู่ และทำให้ agent สองตัวชนกันไม่ได้ทางกายภาพ จากนั้น **เชื่อ agent**

เกณฑ์ตัดสินทุก control ที่จะเพิ่ม:

> **"ถ้าเอาออก agent เก่ง ๆ จะทำระบบพังไหม"** — ไม่พัง = over-control = **ห้ามเพิ่ม**

ผลที่ตามมา: อย่าใส่ validation, schema, state machine, หรือ workflow engine เพื่อ "กัน agent ทำผิด" ถ้าพื้นที่ทำงานกันให้แล้ว

---

## 3. กรอบที่บังคับ — มี 4 ข้อเท่านั้น

| # | กรอบ | ทำอะไร | ถ้าเอาออก |
|---|---|---|---|
| 1 | **ARENA** | การ์ด 1 ใบ = `git worktree` 1 อัน | 2 ใบขนานกันพัง build จริง |
| 2 | **LEASE** | การ์ด 1 ใบ = agent 1 ตัว (TTL จาก mtime ของ event) | 2 agent ทำใบเดียวกัน จ่ายซ้ำ |
| 3 | **GATE** | board รัน check ที่ agent เขียนไว้เอง ใน worktree นั้น | "เสร็จ" = คำพูดล้วน |
| 4 | **HUMAN** | agent ถามได้ที่เดียว มนุษย์ตอบได้ที่เดียว | agent เดาเงียบ ๆ หรือตัน |

**ไม่บังคับเลย** (agent เก่งพอ และมันคือหน้าที่ของมัน): จะแตะไฟล์ไหน · จะเทสต์ยังไง · จะลองกี่ครั้ง · จะใช้โมเดลไหน · จะแบ่งงานยังไง · จะ grill กี่รอบ · spec ยาวแค่ไหน · merge ยังไง

### สิ่งที่เคยเสนอแล้วถูกตัดออก — ห้ามฟื้นกลับมาโดยไม่อ่านเหตุผล

| ของที่ห้ามเพิ่ม | เหตุผล |
|---|---|
| `paths[]` owned paths ต่อการ์ด | worktree กันให้แล้ว |
| reviewer 2 คน + consensus vote | check ตัดสินอยู่แล้ว, เพิ่มต้นทุนและ bias |
| grill engine / `decisions[]` / state machine ใน backend | grill เป็นทักษะของ agent ไม่ใช่ตารางใน DB |
| cost table + cascade engine | ใช้ `used_fraction` + "fail → ตัวถัดไป" ก็พอ |
| heartbeat protocol / idempotency key | mtime check พอ |
| hygiene gate ใน surface | ใส่ข้อ 8 ของไฟล์นี้ใน prompt ของ agent พอ |

---

## 4. กติกา grill (สำคัญที่สุดของ UX)

ยึด `/grill-me` ของ Matt Pocock ตรง ๆ:

- **design tree** — ทุกการตัดสินใจแตกแขนงเป็นการตัดสินใจที่ขึ้นกับมัน
- **frontier** — ชุดคำถามที่ prerequisite ถูกตัดสินหมดแล้ว ถาม **ทั้ง frontier ทีละรอบ** ไม่ใช่ทีละข้อรัว ๆ
- **รูปแบบ**: `❓Q1 <หัวข้อ>: <คำถาม>` แล้วบรรทัด `➡️ <คำตอบที่แนะนำ>` ⇒ มนุษย์ตอบด้วยหมายเลขได้ ("1 yes, 2 ข้อสอง")
- **facts vs decisions**: fact เป็นงานของ agent (ไปอ่านโค้ดเอง **ห้ามถาม**), decision เป็นของมนุษย์ (agent ต้องรอ)
  - agent ที่ตอบ decision ตัวเอง = พังกติกานี้
- **ungrillable** (ความรู้สึก, หน้าตา, high fidelity) → หยุด grill ไปทำ prototype บาง ๆ ก่อน แล้วกลับมาตอบบรรทัดเดียว
- จบเมื่อ **frontier ว่าง** และมนุษย์ยืนยันความเข้าใจร่วมแล้วเท่านั้น

**คำถามที่ห้ามถาม (ห้ามเด็ดขาด):** "จะพิสูจน์ด้วยอะไร npm test หรือ bun test", "ไฟล์อยู่ไหน", "ใช้ framework อะไร", "จะใช้โมเดลไหน" — ทั้งหมดนี้ agent หาเองได้จาก repo และมนุษย์ไม่มีมูลค่าทางธุรกิจที่จะตอบ

**คำถามที่ต้องถาม:** ใครได้ประโยชน์ · "เสร็จ" แปลว่าอะไรในภาษาธุรกิจ · tradeoff ที่มนุษย์เป็นเจ้าของ (เวลา/เงิน/ขอบเขต) · อะไรที่ห้ามพัง

ขั้นตอนบังคับก่อนสร้าง: grill → เขียน spec + acceptance ลงการ์ด → ระบุ check ที่จะพิสูจน์ (agent เลือกเอง จาก repo) → ลงมือ

---

## 5. GUI — สองโจทย์ที่ต้องแก้ให้ได้

### 5.1 มนุษย์ตอบไม่ได้ ต้องมีที่ให้คิดก่อน

ใน `src/board/CardDrawer.tsx` วันนี้คำถามเป็นการ์ดแสดง `card.question` + `answerBox` เปล่า ๆ ⇒ เปลี่ยนเป็น 3 ชั้นในที่เดียว:

```
┌─ ถาม 1 ข้อ · จะปิดงานนี้ได้ยังไง ──────────────────┐
│ ลูกค้าเห็นหน้านี้เอง หรือเห็นแค่หน้าสรุป?             │
│  (A) ลูกค้าเห็นเอง — ต้องมี auth + copy ภาษาลูกค้า   │
│  (B) ทีมภายในเห็น — ตัด auth ออก ประหยัด 1 slice     │
│  (C) เห็นผ่านลิงก์แชร์ ไม่ต้อง login                 │
│  ⬤ แนะนำ C — เพราะบอร์ดนี้ยังไม่มีระบบผู้ใช้เลย       │
│  [ เอา C ]  [ ยังไม่รู้ — อธิบายให้ฟังหน่อย ]        │
│  ถ้าไม่ตอบ: ฉันจะทำตาม C ให้ และใบนี้เสร็จใน ~10 นาที│
└──────────────────────────────────────────────────────┘
```

| ชั้น | รายละเอียด |
|---|---|
| ปิดได้ในคลิกเดียว | ตัวเลือกเป็นปุ่ม + ตัวที่แนะนำทำเครื่องหมายไว้ |
| "อธิบายให้ฟังหน่อย" | เรียก **Host AI ที่มีอยู่แล้ว** ไม่ต้องเพิ่ม key |
| "ตอบให้หน่อย" | เติมข้อความที่แนะนำลงช่องคำตอบ **ให้แก้ได้** แล้วมนุษย์กดส่งเอง — ห้าม auto-submit |

**สัญญาของ AI consult** — ตอบ ≤120 คำ ภาษาคน ไม่มี jargon มี 4 ส่วนตายตัว:
1. คำถามนี้หมายถึงอะไรในชีวิตจริง
2. เลือกแต่ละทางแล้วเกิดอะไรขึ้น (ผลต่อเนื่อง ไม่ใช่คำนิยาม)
3. ฉันแนะนำอะไร เพราะอะไร
4. "ถ้ายังไม่แน่ใจ เลือก C ได้ ไม่เสียหาย" ← ทำให้คนที่ไม่รู้เรื่องตอบได้โดยไม่ต้องกลัว

**วิธีเรียก (มีของอยู่แล้วใน repo):**
```ts
const ai = createHostAi((envelope) => client.call("host.platform", "ai.request", envelope));
await ai.invoke({
  request_id: `ask:${card.id}:${askedAt}`,
  io: { inputs: ["text"], outputs: ["text"] },
  input: [{ type: "text", text: prompt }],
  budget: { seconds: 30, output_bytes: 32768 },
});
```
ตอนใช้จริง `BoardClient.call` ส่งคำขอผ่าน broker และอ่านสถานะด้วย request ID เดิมเมื่อ Host ยังประมวลผล
cache ผลต่อคำถาม (คำถามเดิม = ไม่เรียกซ้ำ) และห้ามเรียกตอน render

### 5.2 5 attention จาก 10 การ์ด ต้องไม่ทำให้อยากปิดแอป

มันคือ **คิวเดียว** ไม่ใช่ 5 ของที่กระจัดกระจาย:

```
┌──────────────────────────────────────────────────────────┐
│  ต้องตัดสินใจ  ●●○○○  2/5          [ ยอมรับทั้งหมด (a) ] │
│  1  การ์ด: หน้าสมัครสมาชิก                                │
│     ลูกค้าเห็นหน้านี้เอง หรือเห็นแค่หน้าสรุป?              │
│     [A]  [B]  [C ✓แนะนำ]   ⓘ อธิบายก่อน                 │
│  j/k เลื่อน · 1-3 เลือก · Enter ยืนยัน · a ยอมรับทั้งหมด │
└──────────────────────────────────────────────────────────┘
```

6 กติกา:

1. **ตัวเลขต้องลดลงให้เห็น** `●●○○○ 2/5` — ไม่มี badge ที่เพิ่มขึ้น ความรู้สึกควบคุมมาจากการที่มันลด
2. **ปิดได้ใน 2 interaction** — ไม่มีข้อไหนบังคับพิมพ์
3. **`a` = ยอมรับคำแนะนำทั้งหมดที่เหลือ** ⇒ ต้องมี `recommend` ทุกข้อ (บังคับใน schema)
4. **แยก 2 ชนิด ห้ามปนกัน**: `decision` (มีตัวเลือก) กับ `problem` (repo path ว่าง, สิทธิ์ไม่พอ, agent ตาย) — problem มีปุ่มเดียว "แก้ให้" และไม่เข้าไปอยู่ในคิวคำถาม
5. **"ถ้าไม่ตอบจะเกิดอะไร"** เขียนใต้ทุกข้อ ⇒ ความกดดันหายเพราะมี default ที่ปลอดภัย
6. **รางวัล = ความว่าง ไม่ใช่ confetti** — ปิดข้อสุดท้ายแล้ว tray ยุบหาย เหลือบรรทัดเดียว แล้วจางเป็นบรรทัดใน topbar ภายในไม่กี่วินาที

"ไว้ก่อน" ทำได้ แต่ **ห้ามกลายเป็นสมมุติฐานเงียบ** — ใบนั้นหยุด, ย้ายไป "รอคุณ" แบบเงียบ, ไม่โผล่ใน tray

### 5.3 Anti-pattern ที่ห้ามทำ

| ❌ | ✅ |
|---|---|
| โชว์ log agent ในคิวคำถาม | 1 บรรทัดสรุป + ปุ่ม "ดูรายละเอียด" |
| modal บล็อกทั้งจอทีละใบ | tray ที่ข้าม/พักได้ |
| toast stacking / badge เพิ่มขึ้น | ตัวเลขคิวที่ลดลงเท่านั้น |
| ให้ AI ตอบแล้ว submit เอง | เติมให้แก้ แล้วมนุษย์กดส่ง |
| ปน problem กับ decision | แยกคนละ tray |
| ข้อความอังกฤษใน UI | ภาษาไทยทุกคำที่มนุษย์อ่าน (โค้ด/path คงเดิม) |

---

## 6. สถานะการ์ดและ MCP tool

**สถานะเป้าหมาย:** 3 สถานะ + 2 badge (ดู `TRACKER.md` D4 — ยังไม่ทำ)
`todo → doing → done` · badge `needs_human` · badge `rejected ×n`
วันนี้ยังเป็น 6 lane เดิม (`backlog / working / blocked / ready_to_test / fix / done`) — **อย่าเพิ่งรื้อ** รอให้ GATE จริงก่อน

**MCP surface เป้าหมาย: 5 tools**

```
agents_join(name, kind, capabilities[])
board_next(agent)                              ← claim + note รวมกัน
board_say(card_id, text | question | reject)   ← question = {text, options[], recommend, kind}
board_submit(card_id, artifact)                ← doing → done (ผ่าน GATE ก่อน)
board_review(card_id, verdict, command, exit)  ← เก็บไว้เฉพาะเมื่อมี GATE จริง (ดู TRACKER G2)
```

วันนี้ backend มี 9 tools (`agents_join`, `board_list`, `board_claim`, `board_attach`, `board_note`, `board_ask`, `board_block`, `board_submit`, `board_review`) โดย `board_submit` รันคำสั่งของการ์ดและ `board_review` เก็บความเห็นเสริม
`board_ask` ต้องเป็น field 3 ตัว ห้าม parse prose จาก note

---

## 7. Quota — ห้ามสร้าง cost engine

ต้องการแค่: gauge ต่อ vendor (`used_fraction` ต่อหน้าต่างเวลา) + จับ rate-limit error เป็น `saturatedUntil` + dispatch = "ตัวที่ used_fraction ต่ำสุดที่ยังไม่ saturated และผ่าน capability"
ของถูกสุดก่อน, fail → ตัวถัดไป (นี่คือ cascade ที่ได้ฟรีจากการที่ board รัน check เอง)
**ห้าม** สร้าง cost table, expected-cost model, หรือตัวคำนวณ cascade — ไม่มีข้อมูลพอจะทำและไม่คุ้ม

---

## 8. กติกาโค้ด

1. **ไม่มีความคิดเห็นในโค้ด** — ไม่มี `//` ไม่มี `/* */` ใน `.ts/.tsx/.mjs` ชื่อและโครงสร้างทำหน้าที่นั้น
2. ไฟล์ ≤ 500 บรรทัด และ ≤ 48KB — เกินให้แยก
3. **เทสต์คือหลักฐาน ไม่ใช่ coverage** — เขียนน้อย ๆ ที่พิสูจน์ property จริง (ขอบเขตแน่นอน, ลำดับรวม, invariant) ห้ามเทสต์ที่ผ่านแม้ logic พัง (tautology, แค่ assert ว่ามีอยู่)
4. ภาษาไทยในทุกข้อความที่มนุษย์อ่าน
5. ก่อนบอกว่าเสร็จ ต้องรัน:
```sh
bun run typecheck
bun test
bun run lint
```

## 9. โครงสร้างจริงของ repo

ตารางนี้คือ **ดัชนีไฟล์จริง** — ทุก path ที่ไม่ใช่ glob (`*`) ต้องมีอยู่จริงใน repo ถ้าเพิ่มไฟล์ใหม่ ให้เพิ่มแถวในตารางนี้ด้วย

| path | คืออะไร |
|---|---|
| `shared/board.ts` | ชนิดข้อมูล + lane + `MOVES` + `pickAssignee`/`pickReviewer` (browser/backend ใช้ร่วม) |
| `backend/main.ts` | entry: เปิด store, supervisor, MCP, JSON-RPC ทาง stdin/stdout |
| `backend/app.ts` | method ทั้งหมดที่ `surface.json` ประกาศ |
| `backend/store.ts` | sqlite (`bun:sqlite`) เก็บใน data dir ของ surface ไม่ใช่ใน repo |
| `backend/board.ts` | business logic ของบอร์ด (สร้าง/ย้าย/ตอบ/รีวิว) |
| `backend/mcp.ts` | MCP server — HTTP บน localhost + bearer token |
| `backend/supervisor.ts` | spawn agent ต่อการ์ด, session resume, `maxConcurrent` |
| `backend/board-input.ts` | ชนิดข้อมูลและตัวช่วยอ่านค่าการ์ดและ agent |
| `backend/worktree.ts` | เปิดและลบ Git worktree ของการ์ดโดยเก็บ branch ไว้ |
| `backend/leases.ts` | สิทธิ์เขียนของแต่ละการ์ดและ mtime ของเหตุการณ์ล่าสุด |
| `backend/checks.ts` | รันคำสั่งตรวจใน worktree จำกัดเวลาและเก็บท้าย output |
| `backend/usage.ts` | อ่านสัดส่วนโควตาจาก CLI เก็บจำนวนรันและเวลาพัก |
| `backend/agent-mcp.ts` | ตั้ง MCP ให้ Claude และ Gemini ตอนเปิดการ์ด |
| `backend/agents.ts` | argv ต่อ agent kind + อ่าน event จาก stdout |
| `backend/agent-config.ts` | เขียน config ของ codex/pi ให้ต่อ MCP (สำรอง `.bak`) |
| `src/board/*.tsx` | UI: `App`, `Board`, `Column`, `CardTile`, `CardDrawer`, `AgentsPanel`, `QuickAdd`, `FirstRun` |
| `src/board/Attention.tsx` | คิวคำถาม ปุ่มตอบ และรายการปัญหาที่ต้องแก้ |
| `src/board/attention-queue.ts` | เรียงคำถาม นับความคืบหน้า และแปลคีย์ลัดของคิว |
| `src/styles/attention.css` | รูปแบบคิวคำถามและรายการปัญหา |
| `src/board/consult.ts` | ตรวจความพร้อมของ Host AI และใช้ผลเดิมต่อคำถาม |
| `src/board/QuestionConsult.tsx` | เปิดคำอธิบายและส่งร่างให้ช่องคำตอบ |
| `src/board/CardAnswer.tsx` | แก้ไขและส่งคำตอบจากหน้าการ์ด |
| `ai-contract.json`, `ai-requests.json` | สัญญา Host AI และคำขอตัวอย่างที่ใช้ตรวจ bundle |
| `src/sdk/host-ai.d.mts` | ชนิดข้อมูลของส่วน SDK ที่ UI เรียกใช้ |
| `src/board/client.ts` | ต่อกับ backend (surface client) |
| `src/board/useBoard.ts` | poll snapshot + action ทั้งหมดของ UI |
| `src/sdk/*.mjs` | ก๊อปของ `ponpoko-surface-sdk` (ห้ามแก้ ยกเว้นจำเป็นจริง) |
| `test/*.test.ts` | `bun test` — ดูจำนวนล่าสุดใน `TRACKER.md` โดยมีเทสต์คิว คำอธิบาย คำสั่งตรวจ และโควตาแยกตามงาน |

คำสั่ง: `bun run typecheck` · `bun test` · `bun run lint` · `bun run build` (vite + `scripts/bundle.mjs` → `dist/`) · `bun run check:bundle` · `bun run smoke`

## 10. นอกขอบเขต — ห้ามทำในรอบนี้

A2A protocol · cloud sync · ข้ามเครื่อง · host AI เป็น orchestrator · reviewer gate · consensus vote · grill engine ใน backend · 6 lane → 3 lane (รอ G1/G2 ก่อน) · agent kind ใหม่ก่อน G1 เสร็จ

## 11. วิธีเริ่มงานจาก clean context

1. อ่านไฟล์นี้ แล้วอ่าน `TRACKER.md` — อยู่ lap ไหน, อะไรเสร็จแล้ว
2. อ่านไฟล์ที่ lap นั้นอ้างถึงจริง (ไฟล์ละ ≤500 บรรทัด อ่านจบในครั้งเดียว)
3. ยืนยันว่า `bun test` เขียวก่อนแก้ (baseline: 62 pass / 8 ไฟล์)
4. ปิด lap เดียวต่อครั้ง แล้วพิสูจน์ด้วยคำสั่งของ repo เอง — ไม่มี script ใหม่เพื่อพิสูจน์
5. อัปเดต `TRACKER.md` ทุกครั้งที่ปิด lap (ช่อง status + evidence)
