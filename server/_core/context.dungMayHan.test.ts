/**
 * SCADA R1b-2a Task 4 (M-1, ruling K6, R-10-bb mở rộng) — hạn xác thực của lượt gọi CHỈ gồm `scadaCommands.dungMay`.
 *
 * Hợp đồng:
 *   · request CHỈ gồm `scadaCommands.dungMay` ⇒ `sdk.authenticateRequest` chạy dưới hạn `HAN_XAC_THUC_STOP_HMI_MS` (1,5 s). Quá hạn ⇒ NÉM
 *     `TRPCError SERVICE_UNAVAILABLE` (HTTP 503, fix round 1 I-2) mang appCode `SCADA_STOP_PRECHECK_TIMEOUT` `{ ma: "STOP_QUA_HAN", pha: "xac_thuc" }` — fail-closed: không bao giờ để
 *     một STOP chưa xác thực đi tiếp (không có `user = null` lặng lẽ rồi chạy thủ tục).
 *   · lỗi xác thực khác (cookie rác, phiên thu hồi) ⇒ như cũ: `user = null` (thủ tục tự trả UNAUTHORIZED).
 *   · mọi request khác (confirm, batch trộn) ⇒ KHÔNG có hạn (như cũ). `robot.consoleStop` không đổi (nhánh STOP-only của R-10-bb).
 * Đồng hồ GIẢ cho mọi ca của createContext (K15); MỘT ca HTTP thật qua `fetchRequestHandler` + `errorFormatter` THẬT (đồng hồ thật, ~1,5 s)
 * chứng minh tRPC 11 trả nguyên lỗi của createContext tới dây (HTTP 503 + appCode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { sdk } from "./sdk";
import { createContext, HAN_XAC_THUC_STOP_HMI_MS, laGoiChiDungMay, type TrpcContext } from "./context";
import { errorFormatter } from "./trpc";

const NGUOI = { id: 77, openId: "o-77", role: "operator", name: "Op" } as unknown as NonNullable<TrpcContext["user"]>;
const req = (cookie = "app_session_id=abc") => ({ headers: { cookie } }) as never;
const info = (...paths: string[]) => ({ calls: paths.map((path) => ({ path })) }) as never;
const cho = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/** Theo dõi trạng thái một promise mà không ném. */
function theoDoi<T>(p: Promise<T>) {
  const s: { xong: boolean; giaTri?: T; loi?: unknown } = { xong: false };
  p.then(
    (v) => Object.assign(s, { xong: true, giaTri: v }),
    (e) => Object.assign(s, { xong: true, loi: e }),
  );
  return s;
}

describe("laGoiChiDungMay — cùng hình isStopOnlyCall", () => {
  it("true ⇔ MỌI lượt gọi là scadaCommands.dungMay", () => {
    expect(laGoiChiDungMay(info("scadaCommands.dungMay"))).toBe(true);
    expect(laGoiChiDungMay(info("scadaCommands.dungMay", "scadaCommands.dungMay"))).toBe(true);
  });
  it("false: batch trộn, thủ tục khác, robot.consoleStop, rỗng, không có info, path không phải chuỗi", () => {
    expect(laGoiChiDungMay(info("scadaCommands.dungMay", "scadaCommands.confirm"))).toBe(false);
    expect(laGoiChiDungMay(info("scadaCommands.confirm"))).toBe(false);
    expect(laGoiChiDungMay(info("robot.consoleStop"))).toBe(false);
    expect(laGoiChiDungMay(info())).toBe(false);
    expect(laGoiChiDungMay(undefined)).toBe(false);
    expect(laGoiChiDungMay({ calls: [{ path: 42 }] })).toBe(false);
  });
  it("hằng hạn = 1500 ms (brief T4)", () => {
    expect(HAN_XAC_THUC_STOP_HMI_MS).toBe(1500);
  });
});

describe("createContext — hạn xác thực của STOP HMI (đồng hồ giả)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("★ dungMay + xác thực treo 5 s ⇒ NÉM SERVICE_UNAVAILABLE SCADA_STOP_PRECHECK_TIMEOUT {ma STOP_QUA_HAN, pha xac_thuc} ĐÚNG lúc 1500 ms (chưa ở 1499)", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(5_000, NGUOI) as never);
    const s = theoDoi(createContext({ req: req(), res: {} as never, info: info("scadaCommands.dungMay") }));
    await vi.advanceTimersByTimeAsync(HAN_XAC_THUC_STOP_HMI_MS - 1);
    expect(s.xong).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.xong).toBe(true);
    expect(s.giaTri).toBeUndefined();
    const e = s.loi as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    expect(e?.code).toBe("SERVICE_UNAVAILABLE");
    expect(e.cause?.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    expect(e.cause?.appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "xac_thuc" });
  });

  it("dungMay + xác thực trả lời trong hạn (1000 ms) ⇒ ctx.user = người đó", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(1_000, NGUOI) as never);
    const s = theoDoi(createContext({ req: req(), res: {} as never, info: info("scadaCommands.dungMay") }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.loi).toBeUndefined();
    expect(s.giaTri?.user).toBe(NGUOI);
    expect(s.giaTri?.sessionToken).toBe("abc");
  });

  it("dungMay + xác thực TỪ CHỐI (cookie rác) ⇒ như cũ: user null, KHÔNG ném (thủ tục tự trả UNAUTHORIZED)", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockRejectedValue(new Error("Invalid session cookie"));
    const s = theoDoi(createContext({ req: req(), res: {} as never, info: info("scadaCommands.dungMay") }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.loi).toBeUndefined();
    expect(s.giaTri?.user).toBeNull();
  });

  it("★ scadaCommands.confirm + xác thực treo 5 s ⇒ KHÔNG bị hạn: còn chờ ở 1500 ms, có user ở 5000 ms", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(5_000, NGUOI) as never);
    const s = theoDoi(createContext({ req: req(), res: {} as never, info: info("scadaCommands.confirm") }));
    await vi.advanceTimersByTimeAsync(HAN_XAC_THUC_STOP_HMI_MS + 100);
    expect(s.xong).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.loi).toBeUndefined();
    expect(s.giaTri?.user).toBe(NGUOI);
  });

  it("★ batch trộn [dungMay, confirm] ⇒ không hạn (laGoiChiDungMay false) — như mọi request thường", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(5_000, NGUOI) as never);
    const s = theoDoi(createContext({ req: req(), res: {} as never, info: info("scadaCommands.dungMay", "scadaCommands.confirm") }));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(s.xong).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.giaTri?.user).toBe(NGUOI);
  });

  it("robot.consoleStop không đổi: nhánh STOP-only của R-10-bb, KHÔNG gọi authenticateRequest", async () => {
    const spy = vi.spyOn(sdk, "authenticateRequest");
    const ctx = await createContext({ req: req(), res: {} as never, info: info("robot.consoleStop") });
    expect(ctx.user).toBeNull();
    expect(ctx.sessionToken).toBe("abc");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("HTTP thật (fetchRequestHandler + errorFormatter THẬT) — tRPC 11 trả NGUYÊN lỗi của createContext", () => {
  afterEach(() => vi.restoreAllMocks());

  it("★ dungMay + xác thực treo ⇒ HTTP 503, data.code SERVICE_UNAVAILABLE + appCode SCADA_STOP_PRECHECK_TIMEOUT; thủ tục KHÔNG chạy (đồng hồ thật, < 2,5 s)", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(5_000, NGUOI) as never);
    const t = initTRPC.context<TrpcContext>().create({ transformer: superjson, errorFormatter });
    let daChay = 0;
    const appRouter = t.router({
      scadaCommands: t.router({
        dungMay: t.procedure.mutation(() => {
          daChay += 1;
          return "da_gui";
        }),
      }),
    });
    const batDau = Date.now();
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://x/api/trpc/scadaCommands.dungMay", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "app_session_id=abc" },
        body: JSON.stringify({ json: { machineId: 1 } }),
      }),
      router: appRouter,
      createContext: ({ info: i }) => createContext({ req: req(), res: {} as never, info: i }),
    });
    const troi = Date.now() - batDau;
    expect(troi).toBeGreaterThanOrEqual(HAN_XAC_THUC_STOP_HMI_MS - 50);
    expect(troi).toBeLessThan(2_500);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { json: { data: Record<string, unknown> } } };
    expect(body.error.json.data.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.json.data.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    expect(body.error.json.data.appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "xac_thuc" });
    expect(daChay).toBe(0);
  }, 10_000);
});
