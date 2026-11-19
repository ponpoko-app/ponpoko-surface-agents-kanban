# Agents Kanban

บอร์ด kanban ที่ coding agent ดึงการ์ดไปทำเองผ่าน MCP แล้วส่งให้ agent อีกตัวตรวจก่อนปิดงาน — การ์ดหนึ่งใบมี session ของ agent ติดไปตลอด รวมถึงตอนแก้รอบสอง

## ติดตั้ง

```sh
bun install
bun run build
ponpoko surface-install --bundle dist
```

จากนั้นเปิด Ponpoko → เมนู surface → **Agents Kanban**

## ใช้ครั้งแรก — ไม่มีการคัดลอกคำสั่ง

1. วาง **repo path** ที่แถบด้านบน (โฟลเดอร์ที่ agent จะทำงาน)
2. หน้าการ์ดแรกจะ**สแกนหา agent ที่ติดตั้งในเครื่อง** (codex, pi, claude, opencode, qwen) แล้วโชว์ปุ่ม **เชื่อมต่อ**
   กดปุ่มเดียวจบ — surface เขียน config ให้เอง (สำรองไฟล์เดิมไว้เป็น `.bak-…`):
   - `~/.codex/config.toml` → `[mcp_servers.agents-kanban]`
   - `~/.pi/agent/mcp.json` → `mcpServers.agents-kanban`
   ไม่ต้อง paste คำสั่ง ไม่ต้อง export token — token และ port ถูกเก็บไว้ใน data dir ของ surface
3. เพิ่ม agent ในบอร์ด (ชั้นทำงาน/ชั้นตรวจ) แล้วกด **+ การ์ด** หรือพิมพ์ `n`

หลังปิดแล้วเปิด Ponpoko ใหม่ port/token เดิมถูกใช้ซ้ำ และ config ที่ชี้มาที่บอร์ดถูกเขียนซ้ำให้อัตโนมัติ
ถ้า port เดิมถูกใช้อยู่ บอร์ดจะเลือก port ใหม่แล้วอัปเดต config ให้เอง

Claude Code / opencode / Qwen ถูกตรวจพบแต่ยังเขียน config ให้อัตโนมัติไม่ได้ — หน้ารายการจะบอก url ให้ต่อเอง

## คำถามจาก agent

เมื่อมีเรื่องให้คุณตัดสินใจ agent เรียก MCP tool `board_ask` โดยส่ง `card_id`, `text`, `options` อย่างน้อยสองข้อ และ `recommend` ที่ตรงกับหนึ่งในตัวเลือก การ์ดจะย้ายไปคอลัมน์รอคำตอบ ให้กดตัวเลือกหรือพิมพ์คำตอบเองจากหน้าการ์ด เมื่อส่งแล้วการ์ดจะกลับไปทำงานพร้อมคำตอบของคุณ

## รูปแนบ

ในหน้าการ์ด: **ลากไฟล์มาวาง / Cmd-Ctrl+V / กด “แนบรูป”** — รองรับ PNG, JPEG, GIF, WebP ไม่เกิน 2MB ต่อรูป
ใช้ได้ทั้งแนบ UI ที่อยากได้ (requirement) และให้ tester capture บั๊กมาแปะ

- ไฟล์เก็บที่ `<app data>/surface-data/agents-kanban/attachments/<card-id>/`
- agent เห็นรูปเป็น **พาธไฟล์ใน prompt** ของ session รอบถัดไป (codex ได้ `-i <path>` ด้วย) พร้อมคำสั่งให้เปิดดูก่อนลงมือ
- tester ที่ต่อผ่าน MCP ใช้ tool `board_attach { card_id, name, data_base64 }` แนบ screenshot ได้เอง
- การ์ดแสดงป้าย 📎 จำนวนรูป, กด thumbnail ดูเต็ม, ลบทีละรูปได้, ลบการ์ด = ไฟล์ถูกลบด้วย

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
