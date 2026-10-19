import "./dom.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { BangTab } from "./sol.mjs";
afterEach(cleanup);
const bam = async (ten: string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: ten })); }); };
test("giu state + DOM khi an, don effect khi an, chay lai khi hien", async () => {
  const log: string[] = [];
  await act(async () => { render(<BangTab ghiNhan={(s: string) => log.push(s)} />); });
  assert.deepEqual(log, ["mo"]);
  await bam("Tăng"); await bam("Tăng");
  assert.ok(screen.getByText("Đếm: 2"));
  await bam("Cài đặt");
  assert.deepEqual(log, ["mo", "dong"], "an tab Do phai don effect");
  fireEvent.change(screen.getByLabelText("Ghi chú"), { target: { value: "dầu máy" } });
  await bam("Đo");
  assert.deepEqual(log, ["mo", "dong", "mo"], "hien lai phai chay lai effect");
  assert.ok(screen.getByText("Đếm: 2"), "state dem phai con");
  await bam("Tăng");
  assert.ok(screen.getByText("Đếm: 3"));
  await bam("Cài đặt");
  assert.equal((screen.getByLabelText("Ghi chú") as HTMLInputElement).value, "dầu máy", "o ghi chu phai giu chu da go");
  assert.deepEqual(log, ["mo", "dong", "mo", "dong"]);
});
test("tab an van con trong DOM (khong unmount) nhung bi an", async () => {
  await act(async () => { render(<BangTab ghiNhan={() => {}} />); });
  await bam("Tăng");
  await bam("Cài đặt");
  const span = screen.getByText("Đếm: 1");
  let e: HTMLElement | null = span;
  let an = false;
  while (e) { if (e.style && e.style.display === "none") an = true; e = e.parentElement; }
  assert.ok(an, "noi dung tab an phai bi display:none");
});
