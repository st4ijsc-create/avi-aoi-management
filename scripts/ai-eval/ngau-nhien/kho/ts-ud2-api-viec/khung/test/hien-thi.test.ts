import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { taoMayChu } from "../src/mayChu.ts";

async function moMayChu() {
  const may = taoMayChu();
  await new Promise<void>((ok) => may.listen(0, "127.0.0.1", ok));
  const { port } = may.address() as AddressInfo;
  const dong = () =>
    new Promise<void>((ok) => {
      may.close(() => ok());
      may.closeAllConnections();
    });
  return { goc: `http://127.0.0.1:${port}`, dong };
}

test("POST /viec ⇒ 201 + Location, áp mặc định", async () => {
  const { goc, dong } = await moMayChu();
  try {
    const r = await fetch(`${goc}/viec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tieuDe: "Hiệu chuẩn AOI" }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("location"), "/viec/1");
    assert.deepEqual(await r.json(), { id: 1, tieuDe: "Hiệu chuẩn AOI", xong: false, uuTien: "vua", nhan: [] });
  } finally {
    await dong();
  }
});

test("GET /viec trả danh sách JSON", async () => {
  const { goc, dong } = await moMayChu();
  try {
    await fetch(`${goc}/viec`, { method: "POST", body: JSON.stringify({ tieuDe: "A", uuTien: "cao" }) });
    const r = await fetch(`${goc}/viec`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await r.json(), [{ id: 1, tieuDe: "A", xong: false, uuTien: "cao", nhan: [] }]);
  } finally {
    await dong();
  }
});

test("GET /viec/99 không có ⇒ 404", async () => {
  const { goc, dong } = await moMayChu();
  try {
    const r = await fetch(`${goc}/viec/99`);
    assert.equal(r.status, 404);
    await r.arrayBuffer();
  } finally {
    await dong();
  }
});
