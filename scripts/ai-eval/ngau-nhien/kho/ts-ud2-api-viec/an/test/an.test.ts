import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { taoMayChu } from "../src/mayChu.ts";
import { KhoViec } from "../src/kho.ts";
import { kiemBoLoc, kiemCapNhat, kiemViecMoi } from "../src/xacThuc.ts";

type Phan = { status: number; headers: Headers; body: unknown; text: string };

async function chay(kho: KhoViec | undefined, viec: (goi: (pt: string, duong: string, than?: string) => Promise<Phan>) => Promise<void>) {
  const may = kho ? taoMayChu(kho) : taoMayChu();
  await new Promise<void>((ok) => may.listen(0, "127.0.0.1", ok));
  const { port } = may.address() as AddressInfo;
  const goi = async (pt: string, duong: string, than?: string): Promise<Phan> => {
    const r = await fetch(`http://127.0.0.1:${port}${duong}`, { method: pt, body: than });
    const text = await r.text();
    let body: unknown = undefined;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    return { status: r.status, headers: r.headers, body, text };
  };
  try {
    await viec(goi);
  } finally {
    await new Promise<void>((ok) => {
      may.close(() => ok());
      may.closeAllConnections();
    });
  }
}

const J = (x: unknown) => JSON.stringify(x);
const KHONG_THAY = { loi: [{ truong: "", thongDiep: "không tìm thấy" }] };

test("POST: trim, giữ trường hợp lệ, id tăng dần; content-type JSON", async () => {
  await chay(undefined, async (goi) => {
    const a = await goi("POST", "/viec", J({ tieuDe: "  Thay đầu hút  ", xong: true, uuTien: "cao", nhan: [" smt ", "gấp"] }));
    assert.equal(a.status, 201);
    assert.equal(a.headers.get("location"), "/viec/1");
    assert.equal(a.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(a.body, { id: 1, tieuDe: "Thay đầu hút", xong: true, uuTien: "cao", nhan: ["smt", "gấp"] });
    const b = await goi("POST", "/viec", J({ tieuDe: "x".repeat(200), uuTien: "thap" }));
    assert.equal(b.status, 201);
    assert.equal(b.headers.get("location"), "/viec/2");
    assert.equal((b.body as { id: number }).id, 2);
  });
});

test("POST không hợp lệ: gom mọi lỗi theo thứ tự, trường lạ cuối cùng; không tạo gì", async () => {
  await chay(undefined, async (goi) => {
    const r = await goi("POST", "/viec", J({ mau: "đỏ", tieuDe: "   ", nhan: ["a", " "], id: 5, xong: "có", uuTien: "gap" }));
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(r.body, {
      loi: [
        { truong: "tieuDe", thongDiep: "phải là chuỗi 1..200 ký tự" },
        { truong: "xong", thongDiep: "phải là boolean" },
        { truong: "uuTien", thongDiep: "phải là thap|vua|cao" },
        { truong: "nhan", thongDiep: "phải là mảng tối đa 5 chuỗi khác rỗng" },
        { truong: "mau", thongDiep: "trường lạ" },
        { truong: "id", thongDiep: "trường lạ" },
      ],
    });
    assert.deepEqual((await goi("POST", "/viec", J({ uuTien: "vua" }))).body, { loi: [{ truong: "tieuDe", thongDiep: "thiếu" }] });
    assert.deepEqual((await goi("POST", "/viec", J({ tieuDe: "y".repeat(201) }))).body, {
      loi: [{ truong: "tieuDe", thongDiep: "phải là chuỗi 1..200 ký tự" }],
    });
    assert.deepEqual((await goi("POST", "/viec", J({ tieuDe: "t", nhan: ["1", "2", "3", "4", "5", "6"] }))).body, {
      loi: [{ truong: "nhan", thongDiep: "phải là mảng tối đa 5 chuỗi khác rỗng" }],
    });
    assert.deepEqual((await goi("GET", "/viec")).body, []);
  });
});

test("POST thân hỏng: JSON sai / rỗng / không phải đối tượng ⇒ 400", async () => {
  await chay(undefined, async (goi) => {
    for (const than of ["{tieuDe:", "", "nul"]) {
      const r = await goi("POST", "/viec", than);
      assert.equal(r.status, 400, than);
      assert.deepEqual(r.body, { loi: [{ truong: "", thongDiep: "JSON không hợp lệ" }] }, than);
    }
    for (const than of ["[]", "null", "\"chuỗi\"", "42"]) {
      const r = await goi("POST", "/viec", than);
      assert.equal(r.status, 400, than);
      assert.deepEqual(r.body, { loi: [{ truong: "", thongDiep: "phải là đối tượng" }] }, than);
    }
  });
});

test("GET /viec lọc: xong, uuTien, q (không phân biệt hoa thường), kết hợp AND, theo id", async () => {
  await chay(undefined, async (goi) => {
    for (const v of [
      { tieuDe: "Kiểm tra AOI line 1", uuTien: "cao" },
      { tieuDe: "Thay băng tải", xong: true },
      { tieuDe: "aoi: hiệu chuẩn camera", uuTien: "cao", xong: true },
      { tieuDe: "Vệ sinh", uuTien: "thap" },
    ]) assert.equal((await goi("POST", "/viec", J(v))).status, 201);
    const ids = async (q: string) => {
      const r = await goi("GET", `/viec${q}`);
      assert.equal(r.status, 200, q);
      return (r.body as { id: number }[]).map((v) => v.id);
    };
    assert.deepEqual(await ids(""), [1, 2, 3, 4]);
    assert.deepEqual(await ids("?xong=true"), [2, 3]);
    assert.deepEqual(await ids("?xong=false"), [1, 4]);
    assert.deepEqual(await ids("?uuTien=cao"), [1, 3]);
    assert.deepEqual(await ids("?q=AOI"), [1, 3]);
    assert.deepEqual(await ids("?q=%20Aoi%20&xong=true"), [3]);
    assert.deepEqual(await ids("?uuTien=vua&xong=true"), [2]);
    assert.deepEqual(await ids("?q=%20%20&trang=2"), [1, 2, 3, 4]);
    assert.deepEqual(await ids("?q=kh%C3%B4ng-c%C3%B3"), []);
  });
});

test("GET /viec bộ lọc sai ⇒ 400 liệt kê lỗi", async () => {
  await chay(undefined, async (goi) => {
    const r = await goi("GET", "/viec?uuTien=GAP&xong=1&q=x");
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, {
      loi: [
        { truong: "xong", thongDiep: "phải là true|false" },
        { truong: "uuTien", thongDiep: "phải là thap|vua|cao" },
      ],
    });
  });
});

test("đường lạ / id không hợp lệ ⇒ 404 với thân lỗi chuẩn", async () => {
  await chay(undefined, async (goi) => {
    await goi("POST", "/viec", J({ tieuDe: "một" }));
    const r1 = await goi("GET", "/viec/1");
    assert.equal(r1.status, 200);
    assert.equal((r1.body as { tieuDe: string }).tieuDe, "một");
    for (const [pt, duong] of [["GET", "/viec/2"], ["GET", "/viec/abc"], ["GET", "/viec/0"], ["GET", "/viec/01"], ["GET", "/viec/1/x"], ["GET", "/khac"], ["GET", "/viec/"], ["POST", "/viec/abc"], ["DELETE", "/"]]) {
      const r = await goi(pt, duong);
      assert.equal(r.status, 404, `${pt} ${duong}`);
      assert.deepEqual(r.body, KHONG_THAY, `${pt} ${duong}`);
    }
  });
});

test("PATCH: cập nhật một phần, trim; lỗi ⇒ 400 không đổi gì; {} giữ nguyên; không có ⇒ 404", async () => {
  await chay(undefined, async (goi) => {
    await goi("POST", "/viec", J({ tieuDe: "Gốc", nhan: ["a"] }));
    const r = await goi("PATCH", "/viec/1", J({ xong: true, nhan: [" b ", "c"] }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: 1, tieuDe: "Gốc", xong: true, uuTien: "vua", nhan: ["b", "c"] });
    const sai = await goi("PATCH", "/viec/1", J({ tieuDe: " Mới ", uuTien: "rat-cao", id: 9 }));
    assert.equal(sai.status, 400);
    assert.deepEqual(sai.body, {
      loi: [
        { truong: "uuTien", thongDiep: "phải là thap|vua|cao" },
        { truong: "id", thongDiep: "trường lạ" },
      ],
    });
    assert.deepEqual((await goi("GET", "/viec/1")).body, { id: 1, tieuDe: "Gốc", xong: true, uuTien: "vua", nhan: ["b", "c"] });
    const rong = await goi("PATCH", "/viec/1", "{}");
    assert.equal(rong.status, 200);
    assert.deepEqual(rong.body, { id: 1, tieuDe: "Gốc", xong: true, uuTien: "vua", nhan: ["b", "c"] });
    assert.deepEqual((await goi("PATCH", "/viec/1", J({ tieuDe: " Mới " }))).body, { id: 1, tieuDe: "Mới", xong: true, uuTien: "vua", nhan: ["b", "c"] });
    assert.equal((await goi("PATCH", "/viec/1", "{hỏng")).status, 400);
    const k = await goi("PATCH", "/viec/7", J({ uuTien: "sai" }));
    assert.equal(k.status, 404);
    assert.deepEqual(k.body, KHONG_THAY);
  });
});

test("DELETE ⇒ 204 không thân; xoá lại ⇒ 404; id không tái sử dụng", async () => {
  await chay(undefined, async (goi) => {
    await goi("POST", "/viec", J({ tieuDe: "1" }));
    await goi("POST", "/viec", J({ tieuDe: "2" }));
    const d = await goi("DELETE", "/viec/2");
    assert.equal(d.status, 204);
    assert.equal(d.text, "");
    assert.equal((await goi("GET", "/viec/2")).status, 404);
    assert.equal((await goi("DELETE", "/viec/2")).status, 404);
    const m = await goi("POST", "/viec", J({ tieuDe: "3" }));
    assert.equal(m.headers.get("location"), "/viec/3");
    assert.deepEqual(((await goi("GET", "/viec")).body as { id: number }[]).map((v) => v.id), [1, 3]);
  });
});

test("405 + Allow cho phương thức không hỗ trợ (kể cả id chưa tồn tại)", async () => {
  await chay(undefined, async (goi) => {
    await goi("POST", "/viec", J({ tieuDe: "một" }));
    for (const pt of ["PUT", "DELETE", "PATCH"]) {
      const r = await goi(pt, "/viec", "{}");
      assert.equal(r.status, 405, pt);
      assert.equal(r.headers.get("allow"), "GET, POST", pt);
      assert.deepEqual(r.body, { loi: [{ truong: "", thongDiep: "phương thức không được hỗ trợ" }] });
    }
    for (const duong of ["/viec/1", "/viec/999"]) {
      for (const pt of ["POST", "PUT"]) {
        const r = await goi(pt, duong, "{}");
        assert.equal(r.status, 405, `${pt} ${duong}`);
        assert.equal(r.headers.get("allow"), "GET, PATCH, DELETE", `${pt} ${duong}`);
      }
    }
    assert.equal((await goi("GET", "/viec/1")).status, 200);
  });
});

test("taoMayChu dùng kho được tiêm; KhoViec trả bản sao", async () => {
  const kho = new KhoViec();
  const v = kho.them({ tieuDe: "Có sẵn", xong: false, uuTien: "thap", nhan: ["k"] });
  assert.equal(v.id, 1);
  v.nhan.push("rò");
  kho.lay(1)!.tieuDe = "rò";
  kho.ds()[0].nhan.push("rò");
  assert.deepEqual(kho.lay(1), { id: 1, tieuDe: "Có sẵn", xong: false, uuTien: "thap", nhan: ["k"] });
  await chay(kho, async (goi) => {
    assert.deepEqual((await goi("GET", "/viec/1")).body, { id: 1, tieuDe: "Có sẵn", xong: false, uuTien: "thap", nhan: ["k"] });
    await goi("POST", "/viec", J({ tieuDe: "Qua API" }));
  });
  assert.deepEqual(kho.ds({ q: "api" }).map((x) => x.id), [2]);
  assert.equal(kho.capNhat(99, { xong: true }), undefined);
  assert.equal(kho.xoa(99), false);
});

test("xacThuc dùng độc lập: kiemCapNhat chỉ trả trường có mặt; kiemBoLoc", () => {
  assert.deepEqual(kiemCapNhat({}), { ok: true, giaTri: {} });
  assert.deepEqual(kiemCapNhat({ uuTien: "thap", xong: undefined }), { ok: true, giaTri: { uuTien: "thap" } });
  assert.deepEqual(kiemCapNhat([]), { ok: false, loi: [{ truong: "", thongDiep: "phải là đối tượng" }] });
  assert.deepEqual(kiemViecMoi({ tieuDe: "a", nhan: [] }), { ok: true, giaTri: { tieuDe: "a", xong: false, uuTien: "vua", nhan: [] } });
  assert.deepEqual(kiemViecMoi({ tieuDe: 5 }), { ok: false, loi: [{ truong: "tieuDe", thongDiep: "phải là chuỗi 1..200 ký tự" }] });
  assert.deepEqual(kiemBoLoc(new URLSearchParams("q=+ab+&uuTien=cao&xong=false")), { ok: true, giaTri: { q: "ab", uuTien: "cao", xong: false } });
  assert.deepEqual(kiemBoLoc(new URLSearchParams("")), { ok: true, giaTri: {} });
});
