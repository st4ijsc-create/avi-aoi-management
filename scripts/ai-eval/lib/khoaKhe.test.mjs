// node --test scripts/ai-eval/lib/khoaKhe.test.mjs — người GIỮ khoá khe (phép đo) ↔ định dạng mà server đọc.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { giuKhoaKhe } from "./khoaKhe.mjs";

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
