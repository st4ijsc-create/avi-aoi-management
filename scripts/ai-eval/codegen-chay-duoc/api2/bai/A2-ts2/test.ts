import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { NgayIso, SoThapPhan, BanGhi, giaiMa, maHoa } from "./sol.mjs";
test("NgayIso la codec hai chieu", () => {
  const d = z.decode(NgayIso, "2026-10-18T08:30:00+07:00");
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), Date.UTC(2026, 9, 18, 1, 30));
  assert.equal(z.encode(NgayIso, new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), "2026-01-02T03:04:05.000Z");
  assert.throws(() => z.decode(NgayIso, "2026-10-18T08:30:00"), z.ZodError);
  assert.throws(() => z.decode(NgayIso, "2026-10-18 08:30"), z.ZodError);
});
test("SoThapPhan la codec hai chieu", () => {
  assert.equal(z.decode(SoThapPhan, "12.50"), 12.5);
  assert.equal(z.decode(SoThapPhan, "-3"), -3);
  assert.equal(z.encode(SoThapPhan, 12.5), "12.5");
  assert.throws(() => z.decode(SoThapPhan, "1e3"), z.ZodError);
  assert.throws(() => z.decode(SoThapPhan, "abc"), z.ZodError);
});
test("giaiMa / maHoa khu hoi", () => {
  const v = giaiMa({ ma: "T1", luc: "2026-10-18T00:00:00Z", giaTri: "7.25" });
  assert.equal(v.ma, "T1");
  assert.equal(v.luc.getTime(), Date.UTC(2026, 9, 18));
  assert.equal(v.giaTri, 7.25);
  assert.deepEqual(maHoa(v), { ma: "T1", luc: "2026-10-18T00:00:00.000Z", giaTri: "7.25" });
  assert.deepEqual(BanGhi.parse({ ma: "T2", luc: "2026-10-18T00:00:00Z", giaTri: "1" }).giaTri, 1);
});
test("du lieu sai nem ZodError ca hai chieu", () => {
  assert.throws(() => giaiMa({ ma: "T1", luc: "hom qua", giaTri: "1" }), z.ZodError);
  assert.throws(() => giaiMa({ ma: "T1", luc: "2026-10-18T00:00:00Z", giaTri: 1 }), z.ZodError);
  assert.throws(() => maHoa({ ma: "T1", luc: new Date(0), giaTri: Number.NaN } as any), z.ZodError);
  assert.throws(() => maHoa({ ma: "T1", luc: "2026-10-18" as any, giaTri: 1 } as any), z.ZodError);
});
