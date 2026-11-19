# AGENTS.md — Agents Kanban

ก่อนแตะโค้ด อ่านสองไฟล์นี้ตามลำดับ:

1. `MASTER-PROMPT.md` — หลักการ, กรอบ 4 ข้อ, กติกา grill, สเปก GUI, สิ่งที่ห้ามทำ, คำสั่งพิสูจน์
2. `TRACKER.md` — สถานะงาน, decision log, gap, lap ถัดไปพร้อม acceptance

## ก่อนแก้โค้ดทุกครั้ง

```sh
bun test
```

baseline ที่ต้องเห็น: **62 pass / 8 ไฟล์ / 0 fail** — ถ้าไม่ตรง ให้รายงานก่อน ไม่ใช่แก้ต่อ

## กติกาที่ไม่มีข้อยกเว้น

- ไม่มีความคิดเห็นในโค้ด (ไม่มี `//` ไม่มี `/* */`) ในไฟล์ `.ts`, `.tsx`, `.mjs`
- ไฟล์ละ ≤ 500 บรรทัด และ ≤ 48KB
- เทสต์คือหลักฐาน ไม่ใช่ coverage — ห้ามเทสต์ที่ผ่านแม้ logic พัง
- ภาษาไทยทุกข้อความที่มนุษย์อ่าน, path/คำสั่ง/โค้ดคงเดิม
- หนึ่ง lap หนึ่งผลลัพธ์ ปิดแล้วอัปเดต `TRACKER.md` พร้อม evidence (คำสั่ง + ผล)

## คำสั่งของ repo นี้

```sh
bun run typecheck
bun test
bun run lint
bun run build
```

## ห้ามทำในรอบนี้

A2A · cloud · ข้ามเครื่อง · grill engine ใน backend · reviewer gate · consensus vote
รายละเอียดและเหตุผลอยู่ใน `MASTER-PROMPT.md` ข้อ 3 และข้อ 10
