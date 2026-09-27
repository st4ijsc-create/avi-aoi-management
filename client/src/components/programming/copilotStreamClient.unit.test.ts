/**
 * Doc 80 · Đợt 1 · Task 8 (AI-07) — phía CLIENT của `POST /api/ai/programming-copilot/stream`.
 * Thuần (không React): tách khung SSE, gộp sự kiện thành trạng thái panel, và gọi fetch có huỷ.
 */
import { describe, it, expect } from "vitest";
import {
  tachKhungSse,
  trangThaiLuongMoi,
  apDungSuKien,
  chayCopilotStream,
  type CopilotStreamState,
} from "./copilotStreamClient";

const chay = (evs: unknown[], kind = "iec61131-st"): CopilotStreamState =>
  evs.reduce<CopilotStreamState>((s, e) => apDungSuKien(s, e, kind), trangThaiLuongMoi());

describe("tachKhungSse — khung `data:` bị chẻ qua nhiều mảnh TCP", () => {
  it("giữ phần dở dang lại cho lượt sau, bỏ dòng không phải `data:`", () => {
    const a = tachKhungSse('data: {"type":"stage","stage":"gate","elapsedMs":1}\n\ndata: {"type":"tok');
    expect(a.events).toEqual([{ type: "stage", stage: "gate", elapsedMs: 1 }]);
    const b = tachKhungSse(a.rest + 'en","token":"PRO"}\n\n: ping\n\n');
    expect(b.events).toEqual([{ type: "token", token: "PRO" }]);
    expect(b.rest).toBe("");
  });

  it("một khung JSON hỏng KHÔNG giết cả luồng", () => {
    expect(tachKhungSse('data: {oops\n\ndata: {"type":"token","token":"x"}\n\n').events).toEqual([{ type: "token", token: "x" }]);
  });
});

describe("apDungSuKien — tiến độ theo stage, mã hiện dần, kết quả", () => {
  it("stage nối tiếp; `token` cộng dồn; `repair` xoá chữ đang hiện (lượt mới viết lại từ đầu)", () => {
    const s = chay([
      { type: "stage", stage: "gate", elapsedMs: 0 },
      { type: "stage", stage: "retrieve", elapsedMs: 3 },
      { type: "stage", stage: "generate", elapsedMs: 400 },
      { type: "token", token: "PROGRAM " },
      { type: "token", token: "P" },
    ]);
    expect(s.stages.map((x) => x.stage)).toEqual(["gate", "retrieve", "generate"]);
    expect(s.text).toBe("PROGRAM P");
    const s2 = [
      { type: "stage", stage: "validate", elapsedMs: 900 },
      { type: "stage", stage: "repair", attempt: 1, elapsedMs: 910 },
      { type: "token", token: "VAR" },
    ].reduce<CopilotStreamState>((acc, e) => apDungSuKien(acc, e, "iec61131-st"), s);
    expect(s2.stages.at(-1)).toMatchObject({ stage: "repair", attempt: 1 });
    expect(s2.text).toBe("VAR");
  });

  it("`result` ⇒ đúng object kết quả copilotGenerate", () => {
    const r = { ok: true, refused: false, kind: "iec61131-st", code: "x := 1;", validation: { ok: true, diagnostics: [] } };
    expect(chay([{ type: "result", result: r }]).result).toEqual(r);
  });

  it("`error` SAFETY_REFUSED ⇒ kết quả refused (panel dùng lại khung từ chối + khoá progCopilot.refusal.*)", () => {
    const s = chay([{ type: "error", code: "SAFETY_REFUSED", reasonCode: "SAFETY_BYPASS_REQUEST", userMessage: "Không thể hỗ trợ" }]);
    expect(s.result).toMatchObject({ ok: false, refused: true, refusalSource: "gate", reasonCode: "SAFETY_BYPASS_REQUEST", userMessage: "Không thể hỗ trợ", reason: "Không thể hỗ trợ", kind: "iec61131-st" });
  });

  it("`error` hệ thống ⇒ kết quả có errorCode (panel dùng lại khung lỗi + khoá progCopilot.error.*)", () => {
    const s = chay([{ type: "error", code: "MODEL_UNAVAILABLE", userMessage: "Máy chủ AI đang bận", devDetail: "HTTP 503" }]);
    expect(s.result).toMatchObject({ ok: false, refused: false, errorCode: "MODEL_UNAVAILABLE", note: "Máy chủ AI đang bận", devDetail: "HTTP 503" });
  });

  it("kiểu sự kiện lạ ⇒ bỏ qua, không đổi trạng thái", () => {
    const s0 = trangThaiLuongMoi();
    expect(apDungSuKien(s0, { type: "moi_toanh", x: 1 }, "stub")).toBe(s0);
  });
});

describe("chayCopilotStream — fetch có huỷ", () => {
  const luong = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const x of chunks) c.enqueue(enc.encode(x));
        c.close();
      },
    });

  it("200 ⇒ gọi onEvent theo thứ tự, trả {status:'ok'}; gửi cookie phiên + signal", async () => {
    const goi: { url: string; init: RequestInit }[] = [];
    const fetchGia = (async (url: string, init: RequestInit) => {
      goi.push({ url, init });
      return new Response(luong(['data: {"type":"stage","stage":"gate","elapsedMs":0}\n\n', 'data: {"type":"result","result":{"ok":true}}\n\n']), { status: 200 });
    }) as unknown as typeof fetch;
    const ev: unknown[] = [];
    const ac = new AbortController();
    const kq = await chayCopilotStream({ kind: "iec61131-st", request: "x" }, { signal: ac.signal, onEvent: (e) => ev.push(e), fetchImpl: fetchGia });
    expect(kq).toEqual({ status: "ok" });
    expect(ev).toHaveLength(2);
    expect(goi[0].url).toBe("/api/ai/programming-copilot/stream");
    expect(goi[0].init.method).toBe("POST");
    expect(goi[0].init.credentials).toBe("include");
    expect(goi[0].init.signal).toBe(ac.signal);
  });

  it("HTTP ≠ 200 ⇒ {status:'http'} kèm mã + thân (panel quyết lùi về copilotGenerate hay báo lỗi)", async () => {
    const fetchGia = (async () =>
      new Response(JSON.stringify({ success: false, code: "MODULE_NOT_LICENSED" }), { status: 403 })) as unknown as typeof fetch;
    const kq = await chayCopilotStream({ kind: "stub", request: "x" }, { onEvent: () => {}, fetchImpl: fetchGia });
    expect(kq).toEqual({ status: "http", httpStatus: 403, body: { success: false, code: "MODULE_NOT_LICENSED" } });
  });

  it("huỷ ⇒ {status:'aborted'} (không ném)", async () => {
    const fetchGia = (async (_u: string, init: RequestInit) => {
      await new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))));
      return new Response(null);
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    const p = chayCopilotStream({ kind: "stub", request: "x" }, { signal: ac.signal, onEvent: () => {}, fetchImpl: fetchGia });
    ac.abort();
    expect(await p).toEqual({ status: "aborted" });
  });
});
