import "./dom.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FormDatTen } from "./sol.mjs";
afterEach(cleanup);
function hoan() { let ok: any, loi: any; const p = new Promise<string>((a, b) => { ok = a; loi = b; }); return { p, ok, loi }; }
const nut = () => screen.getByRole("button", { name: "Lưu" }) as HTMLButtonElement;
test("thanh cong: trim, cho (disabled), hien status, lam trong o nhap", async () => {
  const h = hoan(); const goi: string[] = [];
  render(<FormDatTen luu={(t: string) => { goi.push(t); return h.p; }} />);
  const o = screen.getByLabelText("Tên") as HTMLInputElement;
  fireEvent.change(o, { target: { value: "  Máy 01  " } });
  await act(async () => { fireEvent.click(nut()); });
  // ⚠ React 19 VƯỚNG mọi transition vào action async còn treo ⇒ luôn giải hứa trong finally, kẻo các test sau kẹt theo.
  let dangCho: boolean;
  try {
    assert.deepEqual(goi, ["Máy 01"]);
    dangCho = nut().disabled;
  } finally {
    await act(async () => { h.ok("Đã lưu Máy 01"); });
  }
  assert.equal(dangCho, true, "nut phai disabled khi dang cho");
  assert.equal(screen.getByRole("status").textContent, "Đã lưu Máy 01");
  assert.equal(nut().disabled, false);
  assert.equal((screen.getByLabelText("Tên") as HTMLInputElement).value, "");
  assert.equal(screen.queryByRole("alert"), null);
});
test("rong sau trim: Thieu ten, khong goi luu", async () => {
  const goi: string[] = [];
  render(<FormDatTen luu={async (t: string) => { goi.push(t); return "x"; }} />);
  fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "   " } });
  await act(async () => { fireEvent.click(nut()); });
  assert.equal(goi.length, 0);
  assert.equal(screen.getByRole("alert").textContent, "Thiếu tên");
});
test("luu nem loi: alert = message, roi gui lai thanh cong thi alert bien mat", async () => {
  let lan = 0;
  render(<FormDatTen luu={async (t: string) => { lan++; if (lan === 1) throw new Error("Trùng tên " + t); return "OK " + t; }} />);
  fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "A" } });
  await act(async () => { fireEvent.click(nut()); });
  assert.equal(screen.getByRole("alert").textContent, "Trùng tên A");
  fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "B" } });
  await act(async () => { fireEvent.click(nut()); });
  assert.equal(screen.getByRole("status").textContent, "OK B");
  assert.equal(screen.queryByRole("alert"), null);
});
