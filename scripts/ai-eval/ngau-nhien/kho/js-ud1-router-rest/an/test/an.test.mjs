import { test } from "node:test";
import assert from "node:assert/strict";
import { taoUngDung } from "../src/app.mjs";
import { Router } from "../src/router.mjs";
import { HttpLoi } from "../src/loi.mjs";

const JSON_UTF8 = "application/json; charset=utf-8";
const KHOA = { "x-khoa": "bi-mat" };
const loiJson = (status, loi, them = {}) => ({ status, headers: { "content-type": JSON_UTF8, ...them }, body: { loi } });

test("router: tham số được giải mã, '/' cuối bị bỏ, query lấy giá trị cuối, phương thức không phân biệt hoa/thường", async () => {
  const r = new Router();
  r.them("GET", "/a/:x/b/:y", async (ctx) => {
    ctx.phanHoi.body = { params: ctx.params, query: ctx.query, path: ctx.path, method: ctx.method };
  });
  const kq = await r.xuLy({ method: "get", url: "/a/x%20y/b/%C4%90%C3%A0/?k=1&k=2&z=&t=%C4%91" });
  assert.deepEqual(kq, {
    status: 200,
    headers: { "content-type": JSON_UTF8 },
    body: { params: { x: "x y", y: "Đà" }, query: { k: "2", z: "", t: "đ" }, path: "/a/x%20y/b/%C4%90%C3%A0", method: "GET" },
  });
  assert.deepEqual((await r.xuLy({ method: "GET", url: "/a/1/b/2" })).body.query, {});
});

test("router: tuyến đăng ký trước thắng; 405 với allow không trùng, theo thứ tự đăng ký", async () => {
  const r = new Router();
  const dat = (ten) => async (ctx) => { ctx.phanHoi.body = { ten, params: ctx.params }; };
  r.them("POST", "/r", dat("post"));
  r.them("GET", "/r", dat("get"));
  r.them("POST", "/r", dat("post2"));
  r.them("GET", "/sp/moi", dat("moi"));
  r.them("GET", "/sp/:id", dat("id"));
  r.them("DELETE", "/sp/:ma", dat("xoa"));
  assert.deepEqual((await r.xuLy({ method: "POST", url: "/r" })).body, { ten: "post", params: {} });
  assert.deepEqual(await r.xuLy({ method: "PUT", url: "/r" }), loiJson(405, "phuong-thuc-khong-ho-tro", { allow: "POST, GET" }));
  assert.deepEqual((await r.xuLy({ method: "GET", url: "/sp/moi" })).body, { ten: "moi", params: {} });
  assert.deepEqual((await r.xuLy({ method: "GET", url: "/sp/7" })).body, { ten: "id", params: { id: "7" } });
  assert.deepEqual((await r.xuLy({ method: "DELETE", url: "/sp/7" })).body, { ten: "xoa", params: { ma: "7" } });
  assert.deepEqual(await r.xuLy({ method: "PATCH", url: "/sp/moi" }), loiJson(405, "phuong-thuc-khong-ho-tro", { allow: "GET, DELETE" }));
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/sp/7/x" }), loiJson(404, "khong-tim-thay"));
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/sp//" }), loiJson(404, "khong-tim-thay"));
});

test("router: middleware kiểu củ hành, chặn sớm, vẫn chạy với đường không tồn tại", async () => {
  const r = new Router();
  const nhat = [];
  r.dung(async (ctx, tiep) => { nhat.push("1a"); await tiep(); nhat.push("1b"); });
  r.dung(async (ctx, tiep) => {
    nhat.push("2a");
    if (ctx.query.chan === "1") { ctx.phanHoi.status = 202; ctx.phanHoi.body = { chan: true }; return; }
    await tiep();
    nhat.push("2b");
  });
  r.them("GET", "/h", async (ctx) => { nhat.push("h"); ctx.phanHoi.body = { ok: 1 }; });
  await r.xuLy({ method: "GET", url: "/h" });
  assert.deepEqual(nhat, ["1a", "2a", "h", "2b", "1b"]);
  nhat.length = 0;
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/h?chan=1" }), { status: 202, headers: { "content-type": JSON_UTF8 }, body: { chan: true } });
  assert.deepEqual(nhat, ["1a", "2a", "1b"]);
  nhat.length = 0;
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/khong" }), loiJson(404, "khong-tim-thay"));
  assert.deepEqual(nhat, ["1a", "2a"]);
});

test("router: xử lý lỗi tập trung (HttpLoi, chiTiet, header lỗi, lỗi thường ⇒ 500, gọi tiep hai lần)", async () => {
  const r = new Router();
  r.dung(async (ctx, tiep) => { ctx.phanHoi.headers["x-truoc"] = "1"; await tiep(); });
  r.them("GET", "/tra", async () => { throw new HttpLoi(418, "am-tra", { a: 1 }); });
  r.them("GET", "/tra2", async () => { throw new HttpLoi(429, "cham-lai", undefined, { "retry-after": "5" }); });
  r.them("GET", "/hong", async () => { throw new Error("bí mật nội bộ"); });
  r.them("GET", "/hong2", () => { throw new TypeError("đồng bộ"); });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/tra" }), { status: 418, headers: { "content-type": JSON_UTF8 }, body: { loi: "am-tra", chiTiet: { a: 1 } } });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/tra2" }), loiJson(429, "cham-lai", { "retry-after": "5" }));
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/hong" }), loiJson(500, "loi-may-chu"));
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/hong2" }), loiJson(500, "loi-may-chu"));
  const r2 = new Router();
  r2.dung(async (ctx, tiep) => { await tiep(); await tiep(); });
  r2.them("GET", "/", async (ctx) => { ctx.phanHoi.body = 1; });
  assert.deepEqual(await r2.xuLy({ method: "GET", url: "/" }), loiJson(500, "loi-may-chu"));
});

test("router: content-type mặc định chỉ khi có thân và chưa đặt; đường mã hoá hỏng ⇒ 400", async () => {
  const r = new Router();
  r.them("GET", "/txt", async (ctx) => { ctx.phanHoi.headers["content-type"] = "text/plain"; ctx.phanHoi.body = "chào"; });
  r.them("GET", "/rong", async (ctx) => { ctx.phanHoi.status = 204; });
  r.them("GET", "/so", async (ctx) => { ctx.phanHoi.body = 0; });
  r.them("GET", "/p/:x", async (ctx) => { ctx.phanHoi.body = ctx.params; });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/txt" }), { status: 200, headers: { "content-type": "text/plain" }, body: "chào" });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/rong" }), { status: 204, headers: {}, body: null });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/so" }), { status: 200, headers: { "content-type": JSON_UTF8 }, body: 0 });
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/p/%E0%A4%A" }), loiJson(400, "duong-dan-hong"));
  assert.deepEqual(await r.xuLy({ method: "GET", url: "/p/a%2Fb" }), { status: 200, headers: { "content-type": JSON_UTF8 }, body: { x: "a/b" } });
});

test("ứng dụng: 422 với chiTiet đúng thứ tự; tên được cắt khoảng trắng; giới hạn 100 ký tự", async () => {
  const app = taoUngDung();
  const post = (body) => app.xuLy({ method: "POST", url: "/sp", headers: KHOA, body });
  const k422 = (chiTiet) => ({ status: 422, headers: { "content-type": JSON_UTF8 }, body: { loi: "du-lieu-khong-hop-le", chiTiet } });
  assert.deepEqual(await post({ gia: -1, ton: 1.5, ten: "  ", mau: "đỏ", id: 3 }), k422(["ten", "gia", "ton", "mau", "id"]));
  assert.deepEqual(await post(null), k422(["than"]));
  assert.deepEqual(await post([]), k422(["than"]));
  assert.deepEqual(await post("x"), k422(["than"]));
  assert.deepEqual(await post(undefined), k422(["than"]));
  assert.deepEqual(await post({ ten: "a".repeat(101), gia: 1 }), k422(["ten"]));
  assert.deepEqual(await post({ ten: 5, gia: "1", ton: null }), k422(["ten", "gia", "ton"]));
  const ok = await post({ ten: `  ${"b".repeat(100)}  `, gia: 0, ton: 7 });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { id: 1, ten: "b".repeat(100), gia: 0, ton: 7 });
});

test("ứng dụng: trùng tên (không phân biệt hoa/thường, sau khi cắt) ⇒ 409, PUT giữ tên của chính nó được", async () => {
  const app = taoUngDung();
  const goi = (method, url, body) => app.xuLy({ method, url, headers: KHOA, body });
  assert.equal((await goi("POST", "/sp", { ten: "Bút bi", gia: 1 })).status, 201);
  assert.equal((await goi("POST", "/sp", { ten: "Thước", gia: 2 })).status, 201);
  assert.deepEqual(await goi("POST", "/sp", { ten: " BÚT BI ", gia: 3 }), loiJson(409, "trung-ten"));
  const put = await goi("PUT", "/sp/1", { ten: "bút BI", gia: 9 });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { id: 1, ten: "bút BI", gia: 9, ton: 0 });
  assert.deepEqual(await goi("PUT", "/sp/2", { ten: "BÚT BI", gia: 2 }), loiJson(409, "trung-ten"));
});

test("ứng dụng: PUT/DELETE — 404 xét trước 422, 204 không thân, id không dùng lại", async () => {
  const app = taoUngDung();
  const goi = (method, url, body) => app.xuLy({ method, url, headers: KHOA, body });
  await goi("POST", "/sp", { ten: "A", gia: 1, ton: 5 });
  assert.deepEqual(await goi("PUT", "/sp/9", { sai: true }), loiJson(404, "khong-tim-thay"));
  assert.equal((await goi("PUT", "/sp/1", { ten: "A" })).status, 422);
  const put = await goi("PUT", "/sp/1", { ten: "A2", gia: 3 });
  assert.deepEqual(put, { status: 200, headers: { "content-type": JSON_UTF8, "x-ung-dung": "kho-sp" }, body: { id: 1, ten: "A2", gia: 3, ton: 0 } });
  assert.deepEqual(await goi("DELETE", "/sp/1"), { status: 204, headers: { "x-ung-dung": "kho-sp" }, body: null });
  assert.deepEqual(await goi("GET", "/sp/1"), loiJson(404, "khong-tim-thay"));
  assert.deepEqual(await goi("DELETE", "/sp/1"), loiJson(404, "khong-tim-thay"));
  const moi = await goi("POST", "/sp", { ten: "B", gia: 1 });
  assert.equal(moi.body.id, 2);
  assert.equal(moi.headers.location, "/sp/2");
});

test("ứng dụng: lọc q, sắp xếp (hoà theo id tăng), gioiHan và tong", async () => {
  const app = taoUngDung();
  for (const [ten, gia] of [["Bút chì", 3000], ["bút bi", 5000], ["Thước", 5000], ["Tẩy", 2000], ["Áo", 90000]]) {
    await app.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten, gia } });
  }
  const ten = async (url) => {
    const r = await app.xuLy({ method: "GET", url });
    assert.equal(r.status, 200, url);
    return [r.body.tong, r.body.ds.map((x) => x.ten)];
  };
  assert.deepEqual(await ten("/sp"), [5, ["Bút chì", "bút bi", "Thước", "Tẩy", "Áo"]]);
  assert.deepEqual(await ten("/sp?sapXep=-gia"), [5, ["Áo", "bút bi", "Thước", "Bút chì", "Tẩy"]]);
  assert.deepEqual(await ten("/sp?sapXep=gia"), [5, ["Tẩy", "Bút chì", "bút bi", "Thước", "Áo"]]);
  assert.deepEqual(await ten("/sp?sapXep=ten"), [5, ["bút bi", "Bút chì", "Thước", "Tẩy", "Áo"]]);
  assert.deepEqual(await ten("/sp?sapXep=-ten"), [5, ["Áo", "Tẩy", "Thước", "Bút chì", "bút bi"]]);
  assert.deepEqual(await ten("/sp?q=%20B%C3%9AT%20&sapXep=gia"), [2, ["Bút chì", "bút bi"]]);
  assert.deepEqual(await ten("/sp?sapXep=-gia&gioiHan=2"), [5, ["Áo", "bút bi"]]);
  assert.deepEqual(await ten("/sp?q=%20%20&gioiHan=100"), [5, ["Bút chì", "bút bi", "Thước", "Tẩy", "Áo"]]);
  assert.deepEqual(await ten("/sp?q=khong"), [0, []]);
  const dau = (await app.xuLy({ method: "GET", url: "/sp?sapXep=-gia&gioiHan=1" })).body.ds[0];
  assert.deepEqual(dau, { id: 5, ten: "Áo", gia: 90000, ton: 0 });
});

test("ứng dụng: tham số truy vấn sai ⇒ 400; mặc định tối đa 20 phần tử", async () => {
  const app = taoUngDung();
  for (const q of ["sapXep=gia2", "sapXep=", "sapXep=toString", "gioiHan=0", "gioiHan=101", "gioiHan=abc", "gioiHan=1.5", "gioiHan=05", "gioiHan="]) {
    assert.deepEqual(await app.xuLy({ method: "GET", url: `/sp?${q}` }), loiJson(400, "tham-so-khong-hop-le"), q);
  }
  for (let i = 0; i < 25; i++) await app.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten: `sp${i}`, gia: i } });
  const r = await app.xuLy({ method: "GET", url: "/sp" });
  assert.equal(r.body.tong, 25);
  assert.equal(r.body.ds.length, 20);
  assert.equal(r.body.ds[19].id, 20);
});

test("ứng dụng: id sai dạng ⇒ 404; '/' cuối; 405 + allow; 401 xét trước 405", async () => {
  const app = taoUngDung();
  await app.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten: "A", gia: 1 } });
  assert.deepEqual(await app.xuLy({ method: "GET", url: "/sp/01" }), loiJson(404, "khong-tim-thay"));
  assert.deepEqual(await app.xuLy({ method: "GET", url: "/sp/abc" }), loiJson(404, "khong-tim-thay"));
  assert.equal((await app.xuLy({ method: "GET", url: "/sp/1/" })).status, 200);
  assert.equal((await app.xuLy({ method: "GET", url: "/sp/?q=a" })).body.tong, 1);
  assert.deepEqual(await app.xuLy({ method: "DELETE", url: "/sp", headers: KHOA }), loiJson(405, "phuong-thuc-khong-ho-tro", { allow: "GET, POST" }));
  assert.deepEqual(await app.xuLy({ method: "PATCH", url: "/sp/1", headers: { "X-Khoa": "bi-mat" } }), loiJson(405, "phuong-thuc-khong-ho-tro", { allow: "GET, PUT, DELETE" }));
  assert.deepEqual(await app.xuLy({ method: "PATCH", url: "/sp/1" }), loiJson(401, "chua-xac-thuc"));
});

test("ứng dụng: mỗi lần taoUngDung có kho riêng", async () => {
  const a = taoUngDung();
  const b = taoUngDung();
  await a.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten: "A", gia: 1 } });
  assert.equal((await b.xuLy({ method: "GET", url: "/sp" })).body.tong, 0);
  const r = await b.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten: "A", gia: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.id, 1);
});
