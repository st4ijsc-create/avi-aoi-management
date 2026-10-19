import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { kiemLenh, LenhMay } from "./sol.mjs";
test("hop le", () => {
  assert.deepEqual(kiemLenh({ may: "M01", lenh: "chay" }), { ok: true, lenh: { may: "M01", lenh: "chay" } });
  assert.deepEqual(kiemLenh({ may: "M12", lenh: "dat_toc_do", tocDo: 1500 }), { ok: true, lenh: { may: "M12", lenh: "dat_toc_do", tocDo: 1500 } });
  assert.equal(kiemLenh({ may: "M12", lenh: "dung", tocDo: 0 }).ok, true);
});
test("rang buoc cheo: dung chuoi prettifyError", () => {
  const r = kiemLenh({ may: "M01", lenh: "dat_toc_do" });
  assert.equal(r.ok, false);
  assert.equal((r as any).loi, "✖ can tocDo\n  → at tocDo");
});
test("khoa la + regex: dung z.prettifyError tren chinh loi do", () => {
  const x = { may: "X1", lenh: "chay", them: 1 };
  const r = kiemLenh(x) as any;
  assert.equal(r.ok, false);
  const kq = LenhMay.safeParse(x);
  assert.equal(kq.success, false);
  assert.equal(r.loi, z.prettifyError((kq as any).error));
  assert.ok(r.loi.includes("Unrecognized key"), "phai la doi tuong NGHIEM");
  assert.ok(r.loi.includes("✖ ma may sai\n  → at may"));
});
test("tocDo nguyen 0..3000", () => {
  assert.equal(kiemLenh({ may: "M01", lenh: "dat_toc_do", tocDo: 3001 }).ok, false);
  assert.equal(kiemLenh({ may: "M01", lenh: "dat_toc_do", tocDo: 1.5 }).ok, false);
  assert.equal(kiemLenh({ may: "M01", lenh: "dat_toc_do", tocDo: -1 }).ok, false);
  assert.equal(kiemLenh({ may: "M01", lenh: "quay" }).ok, false);
  assert.equal(kiemLenh(null).ok, false);
});
