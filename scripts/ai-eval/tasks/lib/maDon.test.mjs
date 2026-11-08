// Chạy: node --test scripts/ai-eval/tasks/lib/maDon.test.mjs (không CSDL, không GPU)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { donThuMuc } from "./maDon.mjs";

const moi = () => fs.mkdtempSync(path.join(os.tmpdir(), "ai-eval-don-"));

test("donThuMuc xoá thư mục bình thường, trả true", () => {
  const d = moi();
  fs.writeFileSync(path.join(d, "a"), "x");
  assert.equal(donThuMuc(d), true);
  assert.ok(!fs.existsSync(d));
});

test("xoá lỗi EPERM như lượt đo 09/11: không ném, trả false, thư mục để lại", () => {
  const d = moi();
  try {
    const xoa = () => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    };
    assert.equal(donThuMuc(d, xoa), false);
    assert.ok(fs.existsSync(d));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
