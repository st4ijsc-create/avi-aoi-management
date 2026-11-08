// Chạy: node --test scripts/ai-eval/tasks/lib/maDon.test.mjs (không CSDL, không GPU)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

test("thư mục đang bị tiến trình giữ: không ném, trả false, kết quả chấm giữ nguyên", { skip: process.platform !== "win32" }, async () => {
  const d = moi();
  // Đúng tình huống lượt đo 09/11: tiến trình còn sống với thư mục làm việc nằm trong thư mục chấm.
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: d, stdio: "ignore" });
  await new Promise((r) => c.once("spawn", r));
  try {
    assert.equal(donThuMuc(d, { maxRetries: 0 }), false);
  } finally {
    c.kill();
    await new Promise((r) => c.once("close", r));
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
