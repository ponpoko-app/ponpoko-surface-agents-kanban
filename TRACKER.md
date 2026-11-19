# TRACKER — Agents Kanban

คู่กับ `MASTER-PROMPT.md` (หลักการ) ไฟล์นี้คือ **สถานะงาน** — อัปเดตทุกครั้งที่ปิด lap

อ่าน `MASTER-PROMPT.md` ก่อน แล้วกลับมาที่นี่

---

## 0. สถานะ ณ วันที่เขียน (baseline วัดจริงในเครื่อง)

| อย่าง | ค่า |
|---|---|
| `bun run typecheck` | ผ่าน (0 error) |
| `bun test` | **62 pass / 8 ไฟล์ / 0 fail** |
| `bun run lint` | ผ่าน (0 warning) |
| version | 0.1.0 |
| bundle ล่าสุด | ~89 MB (backend bundle พา runtime ไปด้วย) |

ข้อเท็จจริงของโค้ดวันนี้ (อ่านจากไฟล์จริง ไม่ใช่ความจำ):

| เรื่อง | ความจริง |
|---|---|
| lane | 6: `backlog / working / blocked / ready_to_test / fix / done` + `MOVES` ใน `shared/board.ts` |
| MCP | 9 tools: `agents_join`, `board_list`, `board_claim`, `board_attach`, `board_note`, `board_block`, `board_ask`, `board_submit`, `board_review` |
| MCP transport | `http://127.0.0.1:<port>/mcp` + bearer token, protocol `2025-06-18`, port/token เก็บใน binding file |
| backend ↔ UI | JSON-RPC 2.0 ทาง stdin/stdout, method ทั้งหมดประกาศใน `surface.json` (21 methods) |
| storage | `bun:sqlite` ที่ `PONPOKO_SURFACE_DATA_DIR/agents-kanban.sqlite3` (WAL) |
| supervisor | spawn agent ต่อการ์ด, resume session ได้, ตัดที่ `settings.maxConcurrent` (default 2) |
| agent kind | `codex`, `pi`, `manual` เท่านั้น (`AGENT_COMMANDS`) — claude/opencode/qwen แค่ถูก *สแกน* เจอ ยัง spawn ไม่ได้ |
| ที่ทำงานของ agent | `settings.repoPath` **ตัวเดียว** ไม่มี worktree |
| `board_review` | รับ verdict เป็นข้อความ ⇒ **เชื่อคำพูด** |
| Host AI | `BoardClient.call` ส่งคำขอผ่าน Host AI v1 โดยคิวและหน้าการ์ดใช้ผลคำอธิบายเดียวกันต่อคำถาม |

---

## 1. Decision log — ห้ามกลับข้อเหล่านี้โดยไม่อ่านเหตุผล

| # | ข้อตัดสิน | เหตุผล |
|---|---|---|
| D1 | **ไม่มี "หัวหน้า agent"** — backend (โค้ดธรรมดา) เป็นผู้ถือ ledger, LLM เป็น worker | "หัว" คือสถานะบนดิสก์ ไม่ใช่บทบาทของโมเดล |
| D2 | บังคับแค่ 4 กรอบ: ARENA, LEASE, GATE, HUMAN | เกณฑ์ "เอาออกแล้ว agent เก่ง ๆ พังไหม" |
| D3 | grill ตาม `/grill-me`: design tree + frontier + rounds, facts เป็นของ agent | มนุษย์ตอบ "จะพิสูจน์ด้วยอะไร" ไม่ได้ — นั่นคือ fact ไม่ใช่ decision |
| D4 | 6 lane → 3 สถานะ + 2 badge **ยังไม่ทำ** | ต้องมี GATE จริงก่อน ไม่งั้นตัด lane แล้วได้แค่ความสวย |
| D5 | reviewer ไม่ใช่ gate — board รัน check เอง | check เป็นผู้ตัดสิน, reviewer เพิ่มต้นทุนและ bias |
| D6 | GUI = คิวคำถามเดียว + ตัวเลขที่ลดลง + รางวัลคือความว่าง | คนเดียวดู 5 attention ต้องรู้สึกว่าปิดได้ในไม่กี่คลิก |
| D7 | AI consult ผ่าน Host AI ของ Ponpoko, เติมคำตอบให้แก้ได้, **ห้าม auto-submit** | ใช้ plan/BYOK เดิม ไม่ต้องเพิ่ม key; auto-submit ทำให้มนุษย์ตอบโดยไม่ตัดสิน |
| D8 | quota = `used_fraction` + `saturatedUntil` + ถูกสุดก่อน, fail→ตัวถัดไป | ไม่มีข้อมูลพอทำ cost engine และไม่คุ้ม |
| D9 | merge/publish เป็นคำสั่งของมนุษย์ | run ไม่มีสิทธิ์ปิดงานแทนเจ้าของ |
| D10 | ไม่ทำ A2A / cloud / ข้ามเครื่องในรอบนี้ | publish เดียว `.surface` ไฟล์เดียว |

---

## 2. Gap ที่ยังบล็อก "ของจริง"

| # | Gap | หลักฐานในโค้ด | ปิดด้วย |
|---|---|---|---|
| **G1** | ทุกการ์ดเขียน repo เดียวกัน ⇒ **ขนานไม่ได้** | Supervisor เปิด agent ใน worktree ของการ์ด | L5 · ปิดแล้ว |
| **G2** | board ไม่รัน check เอง ⇒ "เสร็จ" ไม่มีความหมาย | `backend/mcp.ts` → `reviewVerdict(card_id, "PASS\n…")` | L6 |
| **G3** | agent ถามพร้อมตัวเลือกไม่ได้ ⇒ มนุษย์ต้องพิมพ์คำตอบเอง | `board_ask` บันทึก `CardQuestion` และหน้าการ์ดให้กดตัวเลือกได้ | L1 · ปิดแล้ว |
| **G4** | agent ตายแล้วการ์ดค้าง `working` ไม่มี reclaim | sweep ตรวจ mtime กับสถานะ process และคืนการ์ดไป Backlog | L5 · ปิดแล้ว |
| **G5** | ไม่มีตัวเลข usage/quota ต่อ vendor | ไม่มี parser usage ที่ไหนเลย | L7 |
| **G6** | UI เรียก Host AI ไม่ได้ | `src/board/consult.ts` ใช้ `BoardClient.call` กับ `host.platform / ai.request` | L3 · ปิดแล้ว |
| G7 | spawn ได้แค่ codex/pi | `AGENT_COMMANDS` มี 2 kind | L7 |

G1, G2 คือสองข้อที่ทำให้ระบบยังเป็นเดโม — ที่เหลือคือการทำให้ใช้จริงสะดวก

---

## 3. Lap plan

สถานะ: `todo` / `doing` / `done` / `blocked` — ปิด lap แล้วต้องมี **evidence: คำสั่ง + ผล**

### L1 — `board_ask`: คำถามมีตัวเลือกและคำแนะนำ

- **ทำ**: `shared/board.ts` เพิ่ม `CardQuestion { text, options[], recommend, kind: "decision"|"problem", askedAt }`; `backend/mcp.ts` เพิ่ม tool `board_ask`; `backend/board.ts` method ภายใน; `Card.question` เปลี่ยนจาก `string|null`
- **acceptance**: `board_ask` รับ 3 ฟิลด์และปฏิเสธเมื่อ `options.length < 2` หรือไม่มี `recommend`; การ์ดที่ถูกถามเข้าสถานะรอคำตอบ; ตอบแล้วคำถามหาย
- **proof**: `bun test`
- **สถานะ**: done (ดูหลักฐาน L1 ด้านล่าง)

### L2 — คิวความสนใจ (Attention tray)

- **ทำ**: `src/board/Attention.tsx` + `src/styles/attention.css` (แยกเพื่อคงเพดาน 500 บรรทัด); `App.tsx` ต่อ tray; คีย์บอร์ด `j/k`, `1-9`, `Enter`, `a` (ยอมรับทั้งหมด), `Esc`
- **acceptance**: 5 ข้อปิดครบด้วย ≤10 interaction และ 0 การพิมพ์บังคับ; ตัวเลข `n/5` ลดลงทุกครั้ง; `a` ปิดทั้งคิวโดยใช้ `recommend` ของทุกข้อ
- **proof**: `bun test` (ตรรกะคิว/คีย์บอร์ดเป็น pure function ที่ทดสอบได้) + `bun run typecheck`
- **สถานะ**: done (ดูหลักฐาน L2 ด้านล่าง)

### L3 — AI consult (Host AI) + cache

- **ทำ**: `BoardClient` เพิ่ม `call(namespace, operation, payload)`; `src/board/consult.ts` ใหม่ ใช้ `createHostAi`; cache ต่อ `card.id + askedAt`
- **acceptance**: เรียก `host.platform` `ai.request` 1 ครั้งต่อคำถาม (cache hit ไม่เรียกซ้ำ); คำตอบถูกเติมลงช่องให้แก้ได้; ไม่มีการ submit อัตโนมัติ; ถ้า Host ไม่มี AI ⇒ ปุ่มถูกซ่อน ไม่ใช่ error
- **proof**: `bun test test/consult.test.ts` (cache + prompt shape) + `bun run build` (รวม typecheck)
- **สถานะ**: done (ดูหลักฐาน L3 ด้านล่าง)

### L4 — สถานะว่าง/รางวัล + การ์ดในบอร์ด

- **ทำ**: empty state ของ tray ("ไม่มีอะไรต้องตัดสินใจ · N งานกำลังทำ"), `CardTile` badge "ถาม 1 ข้อ"/"⚠ ต้องแก้", `CardDrawer` แสดงบล็อกคำถามแบบใหม่
- **acceptance**: ปิดข้อสุดท้ายแล้ว tray ว่างภายใน 1 เฟรมและแสดงบรรทัด "ที่เหลือเป็นเรื่องของ agent"; การ์ดชนิด `problem` ไม่ปรากฏในคิวคำถาม
- **proof**: `bun test test/attention.test.ts` + `bun run build` และทดสอบ UI ใน Chromium
- **สถานะ**: done (ดูหลักฐาน L4 ด้านล่าง)

### L5 — ARENA + LEASE (การ์ด 1 ใบ = worktree 1 อัน)

- **ทำ**: `backend/worktree.ts` ใหม่ (สร้าง/ลบ worktree ใต้ data dir), `supervisor.start()` ใช้ cwd ของ worktree ใบนั้น, lease TTL จาก mtime ของ event + sweep คืนใบที่ค้าง
- **acceptance**: การ์ด 2 ใบรันพร้อมกันได้โดย cwd ต่างกัน; repo หลักไม่ถูกแตะ; ใบที่ agent ตายเกิน TTL ถูกคืนเป็น `todo` พร้อม note; `bun test` เขียว
- **proof**: `bun test` + `bun run typecheck`
- **สถานะ**: done (ใช้ Backlog ในบอร์ดหกคอลัมน์ปัจจุบัน)

### L6 — GATE: board รัน check เอง

- **ทำ**: `backend/checks.ts` ใหม่ — รัน command ใน worktree ของใบนั้น (timeout, เก็บ exit + stdout ท้าย ๆ), เรียกจากตอนปิดใบ; `board_review` เปลี่ยนเป็นทางเลือก ไม่ใช่ประตู
- **acceptance**: check fail ⇒ ใบไม่ปิด + output ถูกบันทึกใน note; check pass ⇒ `done`; command มาจากการ์ด ไม่ใช่จาก board; ไม่มี check ⇒ ใบปิดไม่ได้ (ต้องมีอย่างน้อย 1)
- **proof**: `bun test` (runner เป็น injection ได้เหมือน `Runner`)
- **สถานะ**: todo

### L7 — kind ใหม่ + usage gauge

- **ทำ**: `AGENT_COMMANDS` เพิ่ม `claude`/`gemini` (argv ที่รันได้จริงบนเครื่อง), `usage.ts` นับ run + จับ rate-limit error เป็น `saturatedUntil`
- **acceptance**: spawn claude ได้ 1 ครั้งจริง; `used_fraction` ต่อ kind แสดงบน UI; kind ที่ saturated ถูกข้ามโดยไม่ต้องมี cost table
- **proof**: `bun test` + `bun run typecheck`
- **สถานะ**: todo

**ลำดับ**: L1 → L2 → L3 → L4 (มนุษย์ได้ผลก่อน) แล้ว L5 → L6 (ความจริงของ "เสร็จ") แล้ว L7
L5/L6 ทำสลับก่อนได้ถ้าต้องการพิสูจน์ parallelism แต่ L6 ต้องมี L5 ก่อน

---

## 4. กติกาการอัปเดตไฟล์นี้

1. หนึ่ง lap = หนึ่ง evidence line: `คำสั่ง` + ผลที่เห็น (เช่น `bun test → 68 pass`)
2. ห้ามเปลี่ยน decision (ข้อ 1) โดยไม่เขียนเหตุผลใหม่ใต้ข้อนั้น
3. เพิ่ม gap ใหม่ได้ แต่ต้องมีหลักฐาน `file:line` — gap ที่ไม่มีหลักฐานคือความเห็น
4. ปิด lap แล้วเปลี่ยน `สถานะ` เป็น `done` พร้อม evidence ก่อนเริ่ม lap ถัดไป
5. ถ้า lap ถูกบล็อก ให้เขียนว่า **ติดอะไร** ไม่ใช่ปล่อยเป็น `todo` เงียบ ๆ

## 5. Evidence log

| lap | คำสั่ง | ผล | เมื่อ |
|---|---|---|---|
| baseline | `bun run typecheck && bun test && bun run lint` | typecheck 0 · 62 pass / 8 ไฟล์ · lint 0 | ก่อนเริ่ม lap ใด ๆ |
| L1 | `bun test` · `bun run lint` · `bun run build` · `bun run smoke` · `bun run check:bundle` · `surface-test` · `surface-inspect` · `surface-act` · `surface-play` · `surface-replay` | 66 ผ่าน / 8 ไฟล์ / 0 fail; typecheck, lint, build, smoke และ SDK ผ่าน; กด «ลูกค้า» ใน Ponpoko แล้วการ์ดกลับไป Working และคำถามหาย; replay ตรง 2 ขั้นและ 1 ข้อสังเกต; headless วัด backend-down และ empty-data ไม่ได้ และ network-down ไม่เข้าเงื่อนไข; หลักฐาน UI ใน `trial-run/l1/` | 2026-11-19 |
| L2 | `bun test` · `bun run lint` · `bun run build` · `bun run smoke` · `bun run check:bundle` · `surface-test` · `surface-inspect` · `surface-act` · `surface-play` · `surface-replay` | 71 ผ่าน / 9 ไฟล์ / 0 fail; typecheck, lint, build, smoke และ SDK ผ่าน; ตอบ 5 ข้อด้วย 5 คลิกโดยไม่พิมพ์ ตัวนับลดจาก 5/5 ถึง 1/5 แล้วคิวหาย; ยอมรับทั้งหมดใช้คำแนะนำรายข้อและเว้นปัญหาไว้; ทดสอบคีย์ลัดและไว้ก่อนใน Chromium; replay ตรง 2 ขั้นและ 1 ข้อสังเกต; headless วัด backend-down และ empty-data ไม่ได้; หลักฐาน UI ใน `trial-run/l2/` | 2026-11-19 |
| L3 | `bun test test/consult.test.ts` · `bun run lint` · `bun run build` · `bun run check:bundle` | เทสต์ใหม่ผ่าน 5/5; typecheck, lint, build และสัญญา Host AI ผ่าน; ลองใน Chromium ด้วย Host AI จำลอง คิวและหน้าการ์ดใช้ผลเดิม ร่างแก้ได้และบันทึกเมื่อกดส่งเท่านั้น; ผล UI ใน `trial-run/l3/draft.log` | 2026-11-19 |
| L4 | `bun test test/attention.test.ts` · `bun run build` · Chromium | 5/5 ผ่านและ build ผ่าน; หลังส่งคำตอบข้อสุดท้าย ตัวเลือกหายและข้อความปรากฏ จากนั้นย้ายไปแถบบน ขณะที่ปัญหายังถูกแสดง | 2026-11-19 |
| L5 | `bun test` · `bun run lint` · `bun run typecheck` | 79 ผ่าน / 10 ไฟล์; process สองตัวเขียนพร้อมกันคนละ worktree ใน Git จริง ต้นฉบับสะอาด; lease ปฏิเสธเจ้าของซ้ำ คืนการ์ดเมื่อครบ TTL และปฏิเสธ token เก่า; งานที่ยังไม่เก็บลบไม่ได้ | 2026-11-19 |
| L6 | | | |
| L7 | | | |
