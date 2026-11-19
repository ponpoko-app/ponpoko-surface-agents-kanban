# Agents Kanban

บอร์ด kanban ที่ agent ทำงานใน Git worktree แยกต่อการ์ด บอร์ดรันคำสั่งตรวจของการ์ดและเก็บผลไว้ก่อนปิดงาน

## ติดตั้ง

```sh
bun install
bun run build
ponpoko surface-install --bundle dist
```

จากนั้นเปิด Ponpoko → เมนู surface → **Agents Kanban**

## ใช้ครั้งแรก — ไม่มีการคัดลอกคำสั่ง

1. วาง **repo path** ของ Git repository ที่มี commit แล้วในแถบด้านบน บอร์ดจะแยก worktree ให้เมื่อเริ่มทำการ์ด
2. หน้าการ์ดแรกจะ**สแกนหา agent ที่ติดตั้งในเครื่อง** แล้วโชว์ปุ่ม **เชื่อมต่อ** สำหรับ Codex และ pi
   กดปุ่มเดียวจบ — surface เขียน config ให้เอง (สำรองไฟล์เดิมไว้เป็น `.bak-…`):
   - `~/.codex/config.toml` → `[mcp_servers.agents-kanban]`
   - `~/.pi/agent/mcp.json` → `mcpServers.agents-kanban`
   ไม่ต้อง paste คำสั่ง ไม่ต้อง export token — token และ port ถูกเก็บไว้ใน data dir ของ surface
3. เพิ่ม agent ในบอร์ด (ชั้นทำงาน/ชั้นตรวจ) แล้วกด **+ การ์ด** หรือพิมพ์ `n`

หลังปิดแล้วเปิด Ponpoko ใหม่ port/token เดิมถูกใช้ซ้ำ และ config ที่ชี้มาที่บอร์ดถูกเขียนซ้ำให้อัตโนมัติ
ถ้า port เดิมถูกใช้อยู่ บอร์ดจะเลือก port ใหม่แล้วอัปเดต config ให้เอง

บอร์ดตั้ง MCP ให้ Claude Code และ Gemini CLI ตอนเริ่มทำการ์ดโดยใช้บัญชีที่ตั้งไว้ใน CLI นั้น ส่วน opencode และ Qwen แสดงในรายการตรวจพบ

## ตรวจงานก่อนปิด

ใส่คำสั่งตรวจในหน้าการ์ดบรรทัดละคำสั่ง หรือให้ agent ส่ง `checks` ผ่าน `board_submit` บอร์ดจะรันตามลำดับใน worktree เดิมและปิดการ์ดเมื่อผ่านทุกคำสั่ง หากไม่ผ่าน ให้ดู exit code และท้าย output ในบันทึกการ์ด คำสั่งหนึ่งมีเวลาสูงสุด 120 วินาที

บอร์ดตั้ง branch `agents-kanban/<card-id>` ให้แต่ละใบ ผู้ใช้ตัดสินใจว่าจะ merge หรือ publish เมื่อไร Git จะเก็บ branch ไว้หลังลบการ์ด การลบการ์ดที่ยังมีไฟล์แก้ไขค้างจะรอให้เก็บงานก่อน

## โควตาผู้ให้บริการ

แผง agent แสดงสัดส่วนที่ผู้ให้บริการรายงาน จำนวนรัน และเวลาที่โควตาจะเปิดใหม่ เมื่อพบ rate limit บอร์ดข้ามผู้ให้บริการนั้นและเลือก agent ที่ถนัดงานจากตัวที่เหลือ งานใช้ worktree เดิม ส่วน session เปิดใหม่ถ้าเปลี่ยน CLI

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
| Ready to test | พร้อมรันคำสั่งตรวจจากการ์ด |
| Fix | ส่งกลับไปแก้ใน worktree เดิม |
| Done | ผ่านคำสั่งตรวจและปิดงานแล้ว |

ลากการ์ดด้วยเมาส์ได้เฉพาะเส้นทางที่มีความหมาย (Working → Ready to test, Ready to test → Fix/Done, ฯลฯ) คอลัมน์ที่รับไม่ได้จะจางลง ถ้ากดผิดทาง backend จะตอบเป็นข้อความไทย

รายละเอียดคำสั่ง headless และการตั้งค่า MCP ของแต่ละ CLI ดูได้จากเอกสารผู้ให้บริการ [Claude Code](https://code.claude.com/docs/en/cli-reference) · [Gemini CLI](https://geminicli.com/docs/cli/headless/)

## ตรวจงานเอง

```sh
bun run typecheck
bun run test
bun run lint
bun run build && bun run check:bundle
bun run smoke
```

`check:bundle` ตรวจว่า dist มี entry document, backend executable ที่ตอบ `app.info` ได้จริง, ไม่มี path ของ checkout หลุดเข้า bundle และ manifest ผ่าน `checkSurface` ของ SDK
