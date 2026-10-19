import { test } from "node:test";
import assert from "node:assert/strict";
import { taoMayChu } from "../src/mayChu.mjs";

/** Chạy `fn(goc)` với một máy chủ mới nghe ở cổng ngẫu nhiên; luôn đóng máy chủ sau đó. */
async function voiMayChu(tuyChon, fn) {
  const sv = taoMayChu(tuyChon);
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${sv.address().port}`);
  } finally {
    sv.closeAllConnections();
    await new Promise((r) => sv.close(r));
  }
}
const JSON_UTF8 = "application/json; charset=utf-8";

test("GET /suc-khoe trả JSON", async () => {
  await voiMayChu({}, async (goc) => {
    const r = await fetch(`${goc}/suc-khoe`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), JSON_UTF8);
    assert.deepEqual(await r.json(), { ok: true });
  });
});

test("POST rồi GET danh sách ghi chú", async () => {
  await voiMayChu({}, async (goc) => {
    const r = await fetch(`${goc}/ghi-chu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noiDung: "mua sữa" }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("location"), "/ghi-chu/1");
    assert.deepEqual(await r.json(), { id: 1, noiDung: "mua sữa" });
    const ds = await fetch(`${goc}/ghi-chu`);
    assert.equal(ds.status, 200);
    assert.deepEqual(await ds.json(), [{ id: 1, noiDung: "mua sữa" }]);
  });
});

test("đường không tồn tại ⇒ 404 JSON", async () => {
  await voiMayChu({}, async (goc) => {
    const r = await fetch(`${goc}/khong-co`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("content-type"), JSON_UTF8);
    assert.deepEqual(await r.json(), { loi: "khong-tim-thay" });
  });
});
