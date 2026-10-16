import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chay } from "../src/cli.mjs";

function moiTruong() {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "viec-"));
  const out = [];
  const err = [];
  const io = { ghi: (s) => out.push(s), loi: (s) => err.push(s), duongKho: path.join(thuMuc, "viec.json") };
  return { io, out: () => out.join(""), err: () => err.join(""), xoaDem: () => (out.length = 0) };
}

test("add rồi list hiện việc chưa xong", async () => {
  const m = moiTruong();
  assert.equal(await chay(["add", "Mua sữa"], m.io), 0);
  assert.equal(await chay(["add", "Gọi điện", "--han", "2026-11-01"], m.io), 0);
  m.xoaDem();
  assert.equal(await chay(["list"], m.io), 0);
  assert.equal(m.out(), "[ ] #1 Mua sữa\n[ ] #2 Gọi điện (hạn 2026-11-01)\n");
});

test("done ẩn việc khỏi list mặc định, --tat-ca hiện lại", async () => {
  const m = moiTruong();
  await chay(["add", "A"], m.io);
  await chay(["add", "B"], m.io);
  assert.equal(await chay(["done", "1"], m.io), 0);
  m.xoaDem();
  await chay(["list"], m.io);
  assert.equal(m.out(), "[ ] #2 B\n");
  m.xoaDem();
  await chay(["list", "--tat-ca"], m.io);
  assert.equal(m.out(), "[x] #1 A\n[ ] #2 B\n");
});

test("lỗi: thiếu tiêu đề, hạn sai, lệnh lạ", async () => {
  const m = moiTruong();
  assert.equal(await chay(["add", "  "], m.io), 1);
  assert.equal(await chay(["add", "X", "--han", "1/11/2026"], m.io), 1);
  assert.equal(await chay(["xoa-het"], m.io), 1);
  assert.match(m.err(), /Lệnh không hợp lệ: xoa-het/);
});

test("help liệt kê các lệnh", async () => {
  const m = moiTruong();
  assert.equal(await chay(["help"], m.io), 0);
  for (const l of ["add", "list", "done"]) assert.ok(m.out().includes(`  ${l} `), `trợ giúp thiếu lệnh ${l}`);
});
