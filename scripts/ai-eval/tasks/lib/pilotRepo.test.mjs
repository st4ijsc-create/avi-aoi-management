// Chạy: node --test scripts/ai-eval/tasks/lib/pilotRepo.test.mjs (không CSDL, không GPU)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { apDotBien, docTongKet, tepNgoaiThe } from "./pilotRepo.mjs";

test("docTongKet đọc đúng dòng Tests, bỏ mã màu, không lấy dòng Test Files", () => {
  assert.deepEqual(docTongKet(" Test Files  1 passed (1)\n      Tests  34 passed (34)\n"), { pass: 34, fail: 0, dong: "Tests  34 passed (34)" });
  const r = docTongKet("\x1b[2m      Tests \x1b[22m \x1b[31m2 failed\x1b[39m | \x1b[32m32 passed\x1b[39m (34)\n");
  assert.equal(r.fail, 2);
  assert.equal(r.pass, 32);
});

test("docTongKet: không có dòng Tests ⇒ null (lỗi nạp, không phải kết quả)", () => {
  assert.equal(docTongKet(" Test Files  1 failed (1)\n Error: Transform failed\n"), null);
  assert.equal(docTongKet("No test files found, exiting with code 1\n"), null);
});

test("apDotBien thay đúng một chỗ, giữ nguyên ký tự $ trong chuỗi thay", () => {
  assert.equal(apDotBien("a X b", { ma: "m", tep: "t", tim: "X", thay: "$&${y}" }), "a $&${y} b");
});

test("apDotBien: tìm thấy 0 hoặc nhiều chỗ ⇒ ném (thước hỏng, không âm thầm bỏ qua)", () => {
  assert.throws(() => apDotBien("abc", { ma: "m", tep: "t", tim: "X", thay: "Y" }), /khớp 0 chỗ/);
  assert.throws(() => apDotBien("X X", { ma: "m", tep: "t", tim: "X", thay: "Y" }), /khớp 2 chỗ/);
});

test("apDotBien json: xoá khoá, đặt khoá, khoá vắng ⇒ ném", () => {
  const goc = JSON.stringify({ a: { b: "1", c: "2" } });
  assert.deepEqual(JSON.parse(apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.b" } })), { a: { c: "2" } });
  assert.deepEqual(JSON.parse(apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.b", dat: "" } })), { a: { b: "", c: "2" } });
  assert.throws(() => apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.z" } }), /không có khoá/);
});

test("tepNgoaiThe: tệp sửa hoặc tạo ngoài thẻ bị nêu tên, tệp được phép thì không", () => {
  const cay = fs.mkdtempSync(path.join(os.tmpdir(), "ai-eval-tasks-git-")).split(path.sep).join("/");
  try {
    const git = (...a) => assert.equal(spawnSync("git", ["-C", cay, ...a]).status, 0, a.join(" "));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(`${cay}/nguon.ts`, "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    assert.deepEqual(tepNgoaiThe(cay, ["a.test.ts"]), []);
    fs.mkdirSync(`${cay}/thu`);
    fs.writeFileSync(`${cay}/thu/a.test.ts`, "x");
    assert.deepEqual(tepNgoaiThe(cay, ["thu/a.test.ts"]), [], "tệp mới trong thư mục con phải hiện đúng đường");
    fs.writeFileSync(`${cay}/nguon.ts`, "2\n");
    fs.writeFileSync(`${cay}/lai.ts`, "x");
    assert.deepEqual(tepNgoaiThe(cay, ["thu/a.test.ts"]).sort(), ["lai.ts", "nguon.ts"]);
  } finally {
    fs.rmSync(cay, { recursive: true, force: true });
  }
});
