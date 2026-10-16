// TEST ẨN bộ F (js-cli-viec) — chép vào dự án lúc chấm, xoá sau khi chấm. Không phải tệp của dự án.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chay } from "../src/cli.mjs";
import { dongCsv, bangCsv } from "../src/csv.mjs";

function moiTruong() {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "viec-an-"));
  const out = [];
  const err = [];
  const io = { ghi: (s) => out.push(s), loi: (s) => err.push(s), duongKho: path.join(thuMuc, "viec.json") };
  return { thuMuc, io, out: () => out.join(""), err: () => err.join(""), xoaDem: () => { out.length = 0; err.length = 0; } };
}

async function napMau(m) {
  await chay(["add", "Mua sữa"], m.io);
  await chay(["add", "Họp, chốt \"kế hoạch\" Q4", "--han", "2026-11-01"], m.io);
  await chay(["add", "Gửi báo cáo"], m.io);
  await chay(["done", "1"], m.io);
  m.xoaDem();
}

test("[ẩn] dongCsv bọc nháy kép theo RFC 4180", () => {
  assert.equal(dongCsv(["a", "b c", ""]), "a,b c,");
  assert.equal(dongCsv(["x,y"]), '"x,y"');
  assert.equal(dongCsv(['nói "chào"']), '"nói ""chào"""');
  assert.equal(dongCsv(["dòng 1\ndòng 2", "z"]), '"dòng 1\ndòng 2",z');
});

test("[ẩn] bangCsv ngăn dòng bằng \\n và có \\n cuối", () => {
  assert.equal(bangCsv([["a", "b"], ["1", "2"]]), "a,b\n1,2\n");
});

test("[ẩn] export --csv in ra stdout đủ cột, xong = 1/0, hạn rỗng nếu không có", async () => {
  const m = moiTruong();
  await napMau(m);
  assert.equal(await chay(["export", "--csv"], m.io), 0);
  assert.equal(
    m.out(),
    'id,tieuDe,xong,han\n1,Mua sữa,1,\n2,"Họp, chốt ""kế hoạch"" Q4",0,2026-11-01\n3,Gửi báo cáo,0,\n',
  );
  assert.equal(m.err(), "");
});

test("[ẩn] export --csv --chua-xong bỏ việc đã xong", async () => {
  const m = moiTruong();
  await napMau(m);
  assert.equal(await chay(["export", "--chua-xong", "--csv"], m.io), 0);
  assert.equal(m.out(), 'id,tieuDe,xong,han\n2,"Họp, chốt ""kế hoạch"" Q4",0,2026-11-01\n3,Gửi báo cáo,0,\n');
});

test("[ẩn] export --csv --out ghi ra tệp và báo số việc", async () => {
  const m = moiTruong();
  await napMau(m);
  const dich = path.join(m.thuMuc, "xuat.csv");
  assert.equal(await chay(["export", "--csv", "--out", dich, "--chua-xong"], m.io), 0);
  assert.equal(fs.readFileSync(dich, "utf8"), 'id,tieuDe,xong,han\n2,"Họp, chốt ""kế hoạch"" Q4",0,2026-11-01\n3,Gửi báo cáo,0,\n');
  assert.equal(m.out(), `Đã xuất 2 việc ra ${dich}\n`);
});

test("[ẩn] export kho rỗng chỉ có dòng tiêu đề", async () => {
  const m = moiTruong();
  assert.equal(await chay(["export", "--csv"], m.io), 0);
  assert.equal(m.out(), "id,tieuDe,xong,han\n");
});

test("[ẩn] export thiếu --csv ⇒ mã 2 và thông báo lỗi ra stderr", async () => {
  const m = moiTruong();
  await napMau(m);
  assert.equal(await chay(["export"], m.io), 2);
  assert.equal(m.err(), "Thiếu định dạng xuất: dùng --csv\n");
  assert.equal(m.out(), "");
});

test("[ẩn] help liệt kê export", async () => {
  const m = moiTruong();
  assert.equal(await chay(["help"], m.io), 0);
  assert.ok(m.out().includes("  export "), "trợ giúp thiếu export");
});
