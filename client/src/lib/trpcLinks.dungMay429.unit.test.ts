/**
 * SCADA R1b-2a Task 4 (ruling T3 c3 / review m-4) — MỌI HTTP 429 trên `scadaCommands.dungMay` tới client thành lỗi tRPC `httpStatus 429`,
 * bất kể thân: tầng STOP trả JSON trần `{"error":"Too many STOP requests — use the hard E-STOP"}`, `apiLimiter` trả thân khác, proxy có thể
 * trả HTML. Client THẬT (`createTRPCClient`) + links THẬT của app + fetch giả. Đo trước khi sửa (httpLink tRPC 11.18):
 *   · thân JSON lạ ⇒ `transformResult` ném ⇒ TRPCClientError "Unable to transform response from server", `data` undefined, chỉ còn meta;
 *   · thân không phải JSON ⇒ `res.json()` ném TRƯỚC khi gắn meta ⇒ TRPCClientError không có cả `data` lẫn `meta` — mất dấu 429.
 */
import { describe, expect, it } from "vitest";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import { createAppTrpcLinks, doi429DungMayThanhLoiTrpc, laUrlDungMay, TRPC_MA_TOO_MANY_REQUESTS } from "./trpcLinks";

type Loi = { message?: string; data?: { code?: string; httpStatus?: number; appCode?: string }; meta?: { response?: { status?: number } } };

function client(traLoi: (url: string) => Response) {
  const urls: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return traLoi(url);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = createTRPCClient<any>({ links: createAppTrpcLinks({ url: "http://x/api/trpc", fetch: fakeFetch as typeof fetch }) as any }) as any;
  return { c, urls };
}
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    return e as Loi;
  }
  throw new Error("mong đợi lỗi");
}
const json429 = (body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json", "ratelimit-limit": "600", ...extra } });
const dungMay = (c: any) => c.scadaCommands.dungMay.mutate({ machineId: 1, clientRequestId: "00000000-0000-4000-8000-000000000000" });

describe("429 trên dungMay ⇒ lỗi tRPC httpStatus 429 (theo MÃ TRẠNG THÁI, không theo thân)", () => {
  it("★ tầng STOP: JSON trần {error:'Too many STOP requests — use the hard E-STOP'} ⇒ data {code TOO_MANY_REQUESTS, httpStatus 429}, câu giữ nguyên", async () => {
    const { c, urls } = client(() => json429({ error: "Too many STOP requests — use the hard E-STOP" }));
    const e = await loiCua(dungMay(c));
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).pathname).toBe("/api/trpc/scadaCommands.dungMay");
    expect(e.data?.httpStatus).toBe(429);
    expect(e.data?.code).toBe("TOO_MANY_REQUESTS");
    expect(e.message).toBe("Too many STOP requests — use the hard E-STOP");
    expect(e.meta?.response?.status).toBe(429);
  });

  it("★ apiLimiter (vé chưa ký): thân khác {error:'Too many requests, please try again later'} ⇒ CÙNG httpStatus 429", async () => {
    const { c } = client(() => json429({ error: "Too many requests, please try again later" }));
    const e = await loiCua(dungMay(c));
    expect(e.data?.httpStatus).toBe(429);
    expect(e.data?.code).toBe("TOO_MANY_REQUESTS");
  });

  it("★ thân KHÔNG phải JSON (proxy HTML) ⇒ vẫn httpStatus 429 + câu mặc định 'use the hard E-STOP'", async () => {
    const { c } = client(() => new Response("<html>429 Too Many Requests</html>", { status: 429, headers: { "content-type": "text/html" } }));
    const e = await loiCua(dungMay(c));
    expect(e.data?.httpStatus).toBe(429);
    expect(e.message).toBe("Too many STOP requests — use the hard E-STOP");
  });

  it("thân ĐÃ là lỗi tRPC (appCode riêng) ⇒ giữ nguyên appCode", async () => {
    const shape = { message: "x", code: TRPC_MA_TOO_MANY_REQUESTS, data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, appCode: "TRPC_GIOI_HAN_THU_TUC" } };
    const { c } = client(() => json429({ error: superjson.serialize(shape) }));
    const e = await loiCua(dungMay(c));
    expect(e.data?.appCode).toBe("TRPC_GIOI_HAN_THU_TUC");
    expect(e.data?.httpStatus).toBe(429);
  });

  it("429 trên đường KHÁC (robot.consoleStop, cùng nhánh không-batch) ⇒ KHÔNG đổi (hành vi cũ: data undefined)", async () => {
    const { c } = client(() => json429({ error: "Too many requests, please try again later" }));
    const e = await loiCua(c.robot.consoleStop.mutate({ robotId: 1, command: "stop" }));
    expect(e.data).toBeUndefined();
    expect(e.meta?.response?.status).toBe(429);
  });

  it("200 trên dungMay ⇒ đi nguyên", async () => {
    const { c } = client(() => new Response(JSON.stringify({ result: { data: superjson.serialize({ ketQua: [] }) } }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(dungMay(c)).resolves.toEqual({ ketQua: [] });
  });

  it("laUrlDungMay / doi429 (thuần): chỉ đúng path dungMay; mã JSON-RPC -32029", async () => {
    expect(laUrlDungMay("http://x/api/trpc/scadaCommands.dungMay")).toBe(true);
    expect(laUrlDungMay(new URL("http://x/api/trpc/scadaCommands.dungMay"))).toBe(true);
    expect(laUrlDungMay("http://x/api/trpc/scadaCommands.confirm")).toBe(false);
    expect(laUrlDungMay("http://x/api/trpc/robot.consoleStop")).toBe(false);
    const r = await doi429DungMayThanhLoiTrpc(json429({ error: "y" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("ratelimit-limit")).toBe("600");
    const b = (await r.json()) as { error: { json: { code: number; data: { httpStatus: number } } } };
    expect(b.error.json.code).toBe(TRPC_ERROR_CODES_BY_KEY.TOO_MANY_REQUESTS);
    expect(b.error.json.data.httpStatus).toBe(429);
  });
});
