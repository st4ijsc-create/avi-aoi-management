import "./dom.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Suspense } from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ThongTinMay, KhungMay } from "./sol.mjs";
afterEach(cleanup);
type TT = { ten: string; trangThai: string };
function hoan() { let ok: any; const p = new Promise<TT>((a) => { ok = a; }); return { p, ok }; }
test("ThongTinMay SUSPEND trong Suspense cua nguoi goi", async () => {
  const h = hoan();
  await act(async () => { render(<Suspense fallback={<i>CHO</i>}><ThongTinMay duLieu={h.p} /></Suspense>); });
  const coFallback = !!screen.queryByText("CHO");
  await act(async () => { h.ok({ ten: "M01", trangThai: "CHAY" }); });
  assert.ok(coFallback, "phai hien fallback cua Suspense ben ngoai khi promise chua xong");
  assert.equal(screen.queryByText("CHO"), null);
  assert.ok(screen.getByText("M01 — CHAY"));
});
test("KhungMay: fallback Dang tai… roi noi dung; promise moi ⇒ lai Dang tai…", async () => {
  const a = hoan();
  let r: any;
  await act(async () => { r = render(<KhungMay duLieu={a.p} />); });
  assert.ok(screen.getByText("Đang tải…"));
  await act(async () => { a.ok({ ten: "M02", trangThai: "DUNG" }); });
  assert.ok(screen.getByText("M02 — DUNG"));
  const b = hoan();
  await act(async () => { r.rerender(<KhungMay duLieu={b.p} />); });
  const coFallback = !!screen.queryByText("Đang tải…");
  await act(async () => { b.ok({ ten: "M03", trangThai: "LOI" }); });
  assert.ok(coFallback, "promise moi chua xong ⇒ fallback");
  assert.ok(screen.getByText("M03 — LOI"));
  assert.equal(screen.queryByText("M02 — DUNG"), null);
});
test("promise da xong san ⇒ hien noi dung", async () => {
  const p = Promise.resolve({ ten: "M09", trangThai: "CHAY" });
  await act(async () => { render(<KhungMay duLieu={p} />); });
  assert.ok(screen.getByText("M09 — CHAY"));
});
