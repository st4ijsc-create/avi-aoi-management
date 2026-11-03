/**
 * ★ 0.6.0 (rà kiem-dinh t1/t2) — `goiTrpcChiTiet` GIỮ mã lỗi ở tầng mạng: HTTP thật (401 ⇒ đăng nhập lại), mã `NGOAI_*` của máy chủ
 * (409/413/429 ⇒ câu thân thiện), 200 sai hình dạng ⇒ 502, lỗi mạng ⇒ 0. Không ném với lỗi HTTP. fetch GIẢ (không mạng).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { goiTrpcChiTiet } from "./trpc";

const goc = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = goc;
});
const giaFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(fn);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
};
const json = (status: number, than: unknown) => new Response(JSON.stringify(than), { status, headers: { "content-type": "application/json" } });
const loiTrpc = (reason: string) => ({ error: { json: { message: reason, code: -32603, data: { code: "CONFLICT", httpStatus: 409, appCode: "OPERATION_FAILED", appParams: { operation: "aiKiemDinh", reason } } } } });

describe("goiTrpcChiTiet", () => {
  it("★★★ 401 ⇒ {ok:false, status:401} (bangChat dựa vào đây để xoá phiên + đòi đăng nhập lại)", async () => {
    giaFetch(async () => json(401, { error: { json: { message: "UNAUTHORIZED" } } }));
    expect(await goiTrpcChiTiet("http://h", "ck", "aiKiemDinh.chay", {}, "thay-doi")).toEqual({ ok: false, status: 401, ma: null });
  });
  it("★★★ 409 + appParams.reason NGOAI_DANG_CHAY ⇒ mã đúng; 413 / 429 qua message ⇒ mã đúng", async () => {
    giaFetch(async () => json(409, loiTrpc("NGOAI_DANG_CHAY")));
    expect(await goiTrpcChiTiet("http://h", "ck", "aiKiemDinh.chay", {}, "thay-doi")).toEqual({ ok: false, status: 409, ma: "NGOAI_DANG_CHAY" });
    giaFetch(async () => json(413, { error: { json: { message: "NGOAI_QUA_LON" } } }));
    expect(await goiTrpcChiTiet("http://h", "ck", "aiKiemDinh.xemTruoc", {}, "truy-van")).toEqual({ ok: false, status: 413, ma: "NGOAI_QUA_LON" });
    giaFetch(async () => json(429, loiTrpc("NGOAI_VUOT_TRAN")));
    expect(await goiTrpcChiTiet("http://h", "ck", "aiKiemDinh.chay", {}, "thay-doi")).toMatchObject({ status: 429, ma: "NGOAI_VUOT_TRAN" });
  });
  it("★★ 200 sai hình dạng ⇒ 502; lỗi mạng ⇒ status 0; 200 đúng ⇒ dữ liệu đã bóc superjson", async () => {
    giaFetch(async () => json(200, { khong: "phai trpc" }));
    expect(await goiTrpcChiTiet("http://h", "ck", "x", {}, "truy-van")).toEqual({ ok: false, status: 502, ma: null });
    giaFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await goiTrpcChiTiet("http://h", "ck", "x", {}, "truy-van")).toEqual({ ok: false, status: 0, ma: null });
    giaFetch(async () => json(200, { result: { data: { json: { a: 1 } } } }));
    expect(await goiTrpcChiTiet("http://h", "ck", "x", {}, "truy-van")).toEqual({ ok: true, du: { a: 1 } });
  });
  it("★★ truy vấn = GET ?input=…; thay đổi = POST thân json; cookie phiên đi kèm", async () => {
    const spy = giaFetch(async () => json(200, { result: { data: { json: 1 } } }));
    await goiTrpcChiTiet("http://h/", "ck", "aiKiemDinh.xemTruoc", { a: "é" }, "truy-van");
    await goiTrpcChiTiet("http://h", "ck", "aiKiemDinh.chay", { a: 1 }, "thay-doi");
    const [u1, i1] = spy.mock.calls[0]!;
    const [u2, i2] = spy.mock.calls[1]!;
    expect(u1).toBe(`http://h/api/trpc/aiKiemDinh.xemTruoc?input=${encodeURIComponent(JSON.stringify({ json: { a: "é" } }))}`);
    expect(i1?.method).toBeUndefined();
    expect(u2).toBe("http://h/api/trpc/aiKiemDinh.chay");
    expect(i2?.method).toBe("POST");
    expect(i2?.body).toBe(JSON.stringify({ json: { a: 1 } }));
    for (const i of [i1, i2]) expect((i?.headers as Record<string, string>).cookie).toBe("app_session_id=ck");
  });
});
