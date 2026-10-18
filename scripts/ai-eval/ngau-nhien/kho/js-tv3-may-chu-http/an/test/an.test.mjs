import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
const postJson = (goc, duong, than, kieu = "application/json") =>
  fetch(`${goc}${duong}`, { method: "POST", headers: { "content-type": kieu }, body: than });

/** POST thân theo từng mảnh (Transfer-Encoding: chunked, KHÔNG có Content-Length). */
function guiManh(goc, duong, manhs) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(duong, goc), { method: "POST", agent: false, headers: { "content-type": "application/json" } }, (res) => {
      const ds = [];
      res.on("data", (c) => ds.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, than: Buffer.concat(ds).toString("utf8") }));
    });
    req.on("error", reject);
    for (const m of manhs) req.write(m);
    req.end();
  });
}

test("405 kèm header Allow đúng thứ tự cho từng đường", async () => {
  await voiMayChu({}, async (goc) => {
    for (const [method, duong, allow] of [["POST", "/suc-khoe", "GET"], ["DELETE", "/suc-khoe", "GET"], ["PUT", "/ghi-chu", "GET, POST"],
      ["DELETE", "/ghi-chu", "GET, POST"], ["POST", "/ghi-chu/1", "GET, DELETE"], ["PATCH", "/ghi-chu/42", "GET, DELETE"]]) {
      const r = await fetch(`${goc}${duong}`, { method });
      assert.equal(r.status, 405, `${method} ${duong}`);
      assert.equal(r.headers.get("allow"), allow);
      assert.equal(r.headers.get("content-type"), JSON_UTF8);
      assert.deepEqual(await r.json(), { loi: "phuong-thuc-khong-ho-tro" });
    }
  });
});

test("GET/DELETE theo id: 204 thân rỗng, sau đó 404; id không dùng lại", async () => {
  await voiMayChu({}, async (goc) => {
    await postJson(goc, "/ghi-chu", '{"noiDung":"a"}');
    await postJson(goc, "/ghi-chu", '{"noiDung":"b"}');
    const g = await fetch(`${goc}/ghi-chu/2`);
    assert.equal(g.status, 200);
    assert.deepEqual(await g.json(), { id: 2, noiDung: "b" });
    const x = await fetch(`${goc}/ghi-chu/2`, { method: "DELETE" });
    assert.equal(x.status, 204);
    assert.equal(await x.text(), "");
    const g2 = await fetch(`${goc}/ghi-chu/2`);
    assert.equal(g2.status, 404);
    assert.deepEqual(await g2.json(), { loi: "khong-tim-thay" });
    assert.equal((await fetch(`${goc}/ghi-chu/2`, { method: "DELETE" })).status, 404);
    const c = await postJson(goc, "/ghi-chu", '{"noiDung":"c"}');
    assert.deepEqual(await c.json(), { id: 3, noiDung: "c" });
    assert.deepEqual(await (await fetch(`${goc}/ghi-chu`)).json(), [{ id: 1, noiDung: "a" }, { id: 3, noiDung: "c" }]);
  });
});

test("id sai dạng là đường lạ (404 cả với POST); query string bị bỏ qua khi khớp đường", async () => {
  await voiMayChu({}, async (goc) => {
    for (const duong of ["/ghi-chu/01", "/ghi-chu/0", "/ghi-chu/abc", "/ghi-chu/", "/ghi-chu/1/x", "/suc-khoe/"]) {
      const r = await fetch(`${goc}${duong}`, { method: "POST" });
      assert.equal(r.status, 404, duong);
      assert.deepEqual(await r.json(), { loi: "khong-tim-thay" });
    }
    const q = await fetch(`${goc}/ghi-chu?trang=2`);
    assert.equal(q.status, 200);
    assert.deepEqual(await q.json(), []);
    assert.equal((await fetch(`${goc}/suc-khoe?a=b`)).status, 200);
  });
});

test("415 khi Content-Type không phải application/json (so loại media không phân biệt hoa/thường)", async () => {
  await voiMayChu({}, async (goc) => {
    const r = await postJson(goc, "/ghi-chu", '{"noiDung":"x"}', "text/plain");
    assert.equal(r.status, 415);
    assert.deepEqual(await r.json(), { loi: "can-json" });
    const r2 = await fetch(`${goc}/ghi-chu`, { method: "POST", body: '{"noiDung":"x"}' });
    assert.equal(r2.status, 415);
    const ok = await postJson(goc, "/ghi-chu", '{"noiDung":"x"}', "Application/JSON; charset=utf-8");
    assert.equal(ok.status, 201);
  });
});

test("400 khi JSON hỏng hoặc thân rỗng", async () => {
  await voiMayChu({}, async (goc) => {
    for (const than of ["{hỏng", "", "{\"noiDung\":\"a\"", "undefined"]) {
      const r = await postJson(goc, "/ghi-chu", than);
      assert.equal(r.status, 400, JSON.stringify(than));
      assert.equal(r.headers.get("content-type"), JSON_UTF8);
      assert.deepEqual(await r.json(), { loi: "json-hong" });
    }
  });
});

test("422 khi dữ liệu không hợp lệ; noiDung được cắt khoảng trắng", async () => {
  await voiMayChu({}, async (goc) => {
    for (const than of ["[]", "null", '"chuỗi"', "5", "{}", '{"noiDung":5}', '{"noiDung":"   "}', '{"noiDung":null}']) {
      const r = await postJson(goc, "/ghi-chu", than);
      assert.equal(r.status, 422, than);
      assert.deepEqual(await r.json(), { loi: "du-lieu-khong-hop-le" });
    }
    const r = await postJson(goc, "/ghi-chu", '{"noiDung":"  a b  ","khac":1}');
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { id: 1, noiDung: "a b" });
  });
});

test("413 khi Content-Length vượt giới hạn; máy chủ vẫn phục vụ tiếp", async () => {
  await voiMayChu({ gioiHanThan: 100 }, async (goc) => {
    const r = await postJson(goc, "/ghi-chu", JSON.stringify({ noiDung: "x".repeat(200) }));
    assert.equal(r.status, 413);
    assert.equal(r.headers.get("content-type"), JSON_UTF8);
    assert.deepEqual(await r.json(), { loi: "than-qua-lon" });
    assert.equal((await fetch(`${goc}/suc-khoe`)).status, 200);
    assert.deepEqual(await (await fetch(`${goc}/ghi-chu`)).json(), []);
  });
});

test("giới hạn tính theo BYTE: đúng bằng giới hạn được nhận, hơn 1 byte bị từ chối", async () => {
  await voiMayChu({ gioiHanThan: 40 }, async (goc) => {
    const vua = JSON.stringify({ noiDung: "x".repeat(40 - 14) }); // {"noiDung":""} dài 14 byte
    assert.equal(Buffer.byteLength(vua), 40);
    assert.equal((await postJson(goc, "/ghi-chu", vua)).status, 201);
    const hon = JSON.stringify({ noiDung: "x".repeat(40 - 13) });
    assert.equal((await postJson(goc, "/ghi-chu", hon)).status, 413);
    const chuViet = JSON.stringify({ noiDung: "ệ".repeat(10) }); // 24 ký tự nhưng 44 byte
    assert.ok(chuViet.length <= 40 && Buffer.byteLength(chuViet) > 40);
    assert.equal((await postJson(goc, "/ghi-chu", chuViet)).status, 413);
  });
});

test("413 khi thân gửi theo mảnh (không Content-Length) vượt giới hạn", async () => {
  await voiMayChu({ gioiHanThan: 20 }, async (goc) => {
    const r = await guiManh(goc, "/ghi-chu", ['{"noiDung":"', "aaaaaaaa", 'aaaa"}']);
    assert.equal(r.status, 413);
    assert.deepEqual(JSON.parse(r.than), { loi: "than-qua-lon" });
    const ok = await guiManh(goc, "/ghi-chu", ['{"noiDung"', ':"ab"}']);
    assert.equal(ok.status, 201);
  });
});

test("ký tự UTF-8 bị cắt giữa hai mảnh vẫn được giải mã đúng", async () => {
  await voiMayChu({}, async (goc) => {
    const buf = Buffer.from('{"noiDung":"Đà Nẵng"}', "utf8");
    const a = buf.indexOf(Buffer.from("Đ")) + 1;
    const b = buf.indexOf(Buffer.from("ẵ")) + 2;
    const r = await guiManh(goc, "/ghi-chu", [buf.subarray(0, a), buf.subarray(a, b), buf.subarray(b)]);
    assert.equal(r.status, 201);
    assert.equal(r.headers["content-type"], JSON_UTF8);
    assert.deepEqual(JSON.parse(r.than), { id: 1, noiDung: "Đà Nẵng" });
  });
});

test("giới hạn mặc định 65536 byte; mỗi máy chủ có kho và id riêng", async () => {
  await voiMayChu(undefined, async (goc) => {
    const lon = JSON.stringify({ noiDung: "y".repeat(70000) });
    assert.equal((await postJson(goc, "/ghi-chu", lon)).status, 413);
    const vua = JSON.stringify({ noiDung: "y".repeat(65536 - 14) });
    const r = await postJson(goc, "/ghi-chu", vua);
    assert.equal(r.status, 201);
    assert.equal((await r.json()).id, 1);
  });
  await voiMayChu({}, async (goc) => {
    assert.deepEqual(await (await fetch(`${goc}/ghi-chu`)).json(), []);
    const r = await postJson(goc, "/ghi-chu", '{"noiDung":"moi"}');
    assert.equal((await r.json()).id, 1);
  });
});
