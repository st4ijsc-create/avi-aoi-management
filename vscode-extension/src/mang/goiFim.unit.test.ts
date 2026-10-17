/**
 * ★★★ ĐỢT 4C — gọi `POST /v1/completions` cho ghost-text: KHÔNG BAO GIỜ ném (mọi lỗi thành giá trị để tầng UI ghi
 * nhật ký im lặng), token đi trong `Authorization`, huỷ đi thẳng vào `fetch`.
 */
import { describe, it, expect } from "vitest";
import { goiFim } from "./goiFim";
import { dungThanYeuCauFim } from "../loi/ghostText";

const than = dungThanYeuCauFim({ tienTo: "const a = ", hauTo: "\n", motDong: true });

function fetchGia(tra: () => Promise<Response> | Response) {
  const goi: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    goi.push({ url, init });
    return tra();
  }) as unknown as typeof fetch;
  return { f, goi };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("goiFim", () => {
  it("★★★ 200 ⇒ ok + chữ của choices[0].text; đúng URL, đúng token, đúng thân", async () => {
    const { f, goi } = fetchGia(() => json(200, { choices: [{ text: "1;" }] }));
    const ac = new AbortController();
    const kq = await goiFim({ serverUrl: "http://may:3000/", token: "avgw_x", than, signal: ac.signal, fetch: f });
    expect(kq).toMatchObject({ ok: true, text: "1;" });
    expect(goi[0].url).toBe("http://may:3000/v1/completions");
    expect((goi[0].init.headers as Record<string, string>).authorization).toBe("Bearer avgw_x");
    expect(JSON.parse(String(goi[0].init.body))).toMatchObject({ model: "fim", prompt: "const a = ", stream: false });
    expect(goi[0].init.signal).toBeDefined();
  });

  it("★★★ chưa có token ⇒ không gọi mạng, loại chua-dang-nhap", async () => {
    const { f, goi } = fetchGia(() => json(200, {}));
    const kq = await goiFim({ serverUrl: "http://may", token: undefined, than, signal: new AbortController().signal, fetch: f });
    expect(kq).toMatchObject({ ok: false, loai: "chua-dang-nhap" });
    expect(goi).toHaveLength(0);
  });

  it("★★★ lỗi mạng ⇒ KHÔNG ném, loại mang", async () => {
    const { f } = fetchGia(() => Promise.reject(new TypeError("fetch failed")));
    const kq = await goiFim({ serverUrl: "http://may", token: "avgw_x", than, signal: new AbortController().signal, fetch: f });
    expect(kq).toMatchObject({ ok: false, loai: "mang" });
  });

  it("★★★ bị huỷ ⇒ loại huy (không phải lỗi)", async () => {
    const ac = new AbortController();
    const { f } = fetchGia(() => {
      ac.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const kq = await goiFim({ serverUrl: "http://may", token: "avgw_x", than, signal: ac.signal, fetch: f });
    expect(kq).toMatchObject({ ok: false, loai: "huy" });
  });

  it("★★ 401/403 ⇒ tu-choi; 429/5xx ⇒ http", async () => {
    for (const [st, loai] of [
      [401, "tu-choi"],
      [403, "tu-choi"],
      [429, "http"],
      [503, "http"],
    ] as const) {
      const { f } = fetchGia(() => json(st, { error: { message: "x" } }));
      const kq = await goiFim({ serverUrl: "http://may", token: "avgw_x", than, signal: new AbortController().signal, fetch: f });
      expect(kq, String(st)).toMatchObject({ ok: false, loai, status: st });
    }
  });

  it("★★ thân hỏng ⇒ http, không ném", async () => {
    const { f } = fetchGia(() => new Response("<html>", { status: 200 }));
    const kq = await goiFim({ serverUrl: "http://may", token: "avgw_x", than, signal: new AbortController().signal, fetch: f });
    expect(kq.ok).toBe(false);
  });

  it("★★ serverUrl sai giao thức ⇒ url, không gọi mạng", async () => {
    const { f, goi } = fetchGia(() => json(200, {}));
    const kq = await goiFim({ serverUrl: "file:///x", token: "avgw_x", than, signal: new AbortController().signal, fetch: f });
    expect(kq).toMatchObject({ ok: false, loai: "url" });
    expect(goi).toHaveLength(0);
  });

  it("★★ quá hạn ⇒ huỷ fetch, loại mang", async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("t", "AbortError"))))) as unknown as typeof fetch;
    const kq = await goiFim({ serverUrl: "http://may", token: "avgw_x", than, signal: new AbortController().signal, fetch: f, hetGioMs: 20 });
    expect(kq).toMatchObject({ ok: false, loai: "mang" });
  });
});
