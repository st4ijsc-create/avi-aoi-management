// node --test scripts/ai-eval/lib/khoaKhe.test.mjs — người GIỮ khoá khe (phép đo) ↔ định dạng mà server đọc.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dungQuaCo, giuKhoaKhe, theoDoiCoDung } from "./khoaKhe.mjs";

test("giữ ⇒ tệp JSON {chu, lyDo, hetHan ~ +5 phút, token}; gỡ ⇒ xoá; tệp đã bị người khác ghi đè ⇒ KHÔNG xoá", () => {
  const duong = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khoa-khe-giu-")), "p.pause");
  const k = giuKhoaKhe({ chu: "lưới", lyDo: "thử", duong });
  const j = JSON.parse(fs.readFileSync(duong, "utf8"));
  assert.equal(j.chu, "lưới");
  assert.equal(j.token, k.token);
  const conLai = Date.parse(j.hetHan) - Date.now();
  assert.ok(conLai > 4 * 60_000 && conLai <= 5 * 60_000, `hetHan còn ${conLai} ms`);
  k.go();
  assert.equal(fs.existsSync(duong), false);

  const k2 = giuKhoaKhe({ chu: "lưới 2", duong });
  fs.writeFileSync(duong, JSON.stringify({ chu: "doi-model.ps1", hetHan: new Date(Date.now() + 60_000).toISOString() }));
  k2.go();
  assert.equal(fs.existsSync(duong), true, "không được xoá khoá của người khác");
});

test("gỡ khoá BÀN GIAO của doi-model -GiuKhoa (đúng chủ, chưa token) ⇒ xoá; chủ khác không token ⇒ KHÔNG xoá", () => {
  const duong = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khoa-khe-bg-")), "p.pause");
  const k = giuKhoaKhe({ chu: "phép đo X", duong });
  fs.writeFileSync(duong, "﻿" + JSON.stringify({ chu: "phép đo X", hetHan: new Date(Date.now() + 120_000).toISOString() }));
  k.go();
  assert.equal(fs.existsSync(duong), false, "bản bàn giao cho chính ta phải được gỡ");

  const k2 = giuKhoaKhe({ chu: "phép đo Y", duong });
  fs.writeFileSync(duong, JSON.stringify({ chu: "doi-model.ps1 PID 1", hetHan: new Date(Date.now() + 120_000).toISOString() }));
  k2.go();
  assert.equal(fs.existsSync(duong), true);
});

test("dừng qua CỜ TỆP: dungQuaCo ⇒ người giữ gỡ khoá + xoá cờ ⇒ true; không ai theo dõi ⇒ false sau hạn, cờ bị dọn", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khoa-khe-co-"));
  const duong = path.join(dir, "p.pause");
  const co = path.join(dir, "dung");
  fs.writeFileSync(co, "cờ cũ sót lại");
  const k = giuKhoaKhe({ chu: "cờ", duong });
  let daGo = 0;
  const huy = theoDoiCoDung(k, co, () => daGo++, 20);
  assert.equal(fs.existsSync(co), false, "cờ cũ phải bị xoá lúc bắt đầu theo dõi");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fs.existsSync(duong), true, "chưa có cờ ⇒ vẫn giữ");
  assert.equal(await dungQuaCo(co, 2000), true);
  assert.equal(daGo, 1);
  assert.equal(fs.existsSync(duong), false);
  assert.equal(fs.existsSync(co), false);
  huy();

  assert.equal(await dungQuaCo(co, 300), false);
  assert.equal(fs.existsSync(co), false, "hết hạn ⇒ dọn cờ");
});
