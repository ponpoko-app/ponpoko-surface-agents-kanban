# Agents Kanban

บอร์ด kanban ที่ coding agent ดึงการ์ดไปทำเองผ่าน MCP แล้วส่งให้ agent อีกตัวตรวจก่อนปิดงาน — การ์ดหนึ่งใบมี session ของ agent ติดไปตลอด รวมถึงตอนแก้รอบสอง

## ติดตั้ง

```sh
bun install
bun run build
ponpoko surface-install --bundle dist
```

จากนั้นเปิด Ponpoko → เมนู surface → **Agents Kanban**

## ใช้ครั้งแรก

1. เปิด surface แล้ววาง **repo path** ที่แถบด้านบน (โฟลเดอร์ที่ agent จะทำงาน)
2. เพิ่ม agent อย่างน้อยสองตัว — ตัวหนึ่งทำ ตัวหนึ่งตรวจ — หรือกดปุ่มคำสั่งที่หน้าแรกเพื่อคัดลอกคำสั่งไปต่อใน terminal:
   ```sh
   export KANBAN_TOKEN=...
   codex mcp add agents-kanban --url http://127.0.0.1:<port>/mcp --bearer-token-env-var KANBAN_TOKEN
   pi mcp add agents-kanban --url http://127.0.0.1:<port>/mcp --bearer-token-env-var KANBAN_TOKEN
   ```
3. พิมพ์ชื่อการ์ดในช่อง **+ การ์ดใหม่** ที่คอลัมน์ Backlog แล้วกด Enter — เพิ่ม deliverable/เกณฑ์ผ่านได้ในหน้าการ์ด

token เปลี่ยนทุกครั้งที่เปิด Ponpoko ใหม่ เพราะ MCP server อยู่ใน backend ของ surface นี้ และตายพร้อมแอป (ตั้งใจ — ไม่มี process ค้างหลังปิด Ponpoko)

## คอลัมน์

| คอลัมน์ | ความหมาย |
| --- | --- |
| Backlog | ยังไม่มีใครทำ ลากไป Working เพื่อเริ่ม |
| Working | agent กำลังทำบน session ของการ์ดนี้ |
| Blocked | รอคำตอบจากคุณ — ตอบในหน้าการ์ดแล้ว agent ทำต่อ |
| Ready to test | งานเสร็จ รอ agent อีกตัว (ที่ไม่ใช่คนทำ) ตรวจ |
| Fix | ตรวจไม่ผ่าน กลับไปแก้ที่ agent คนเดิม |
| Done | ปิดงาน |

ลากการ์ดด้วยเมาส์ได้เฉพาะเส้นทางที่มีความหมาย (Working → Ready to test, Ready to test → Fix/Done, ฯลฯ) คอลัมน์ที่รับไม่ได้จะจางลง ถ้ากดผิดทาง backend จะตอบเป็นข้อความไทย

## agent ที่ไม่ใช่ codex/pi

MCP เป็น streamable HTTP มาตรฐาน — client ตัวไหนที่ต่อ HTTP MCP ได้ก็ใช้ได้ เพิ่ม kind ใหม่ได้ใน `shared/board.ts` + `backend/agents.ts`

## ตรวจงานเอง

```sh
bun run typecheck
bun run test
bun run lint
bun run build && bun run check:bundle
bun run smoke
```

`check:bundle` ตรวจว่า dist มี entry document, backend executable ที่ตอบ `app.info` ได้จริง, ไม่มี path ของ checkout หลุดเข้า bundle และ manifest ผ่าน `checkSurface` ของ SDK
