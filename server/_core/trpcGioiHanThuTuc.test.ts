/**
 * ★★★ Giới hạn theo SỐ THỦ TỤC nhạy cảm trong batch tRPC (rà bảo mật 2026-10-24) — middleware THẬT trên HTTP thật, router nhỏ cùng hình dạng (namespace lồng).
 * Census trên appRouter THẬT: `trpcGioiHanThuTuc.census.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStore, type Options, type Store } from "express-rate-limit";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { createTrpcMiddleware } from "./trpcAdapter";
import {
  NHOM_THU_TUC_NHAY_CAM,
  layTapThuTucStepUp,
  phanNhomThuTuc,
  trpcGioiHanThuTucMiddleware,
  type CauHinhNhom,
  type NhomNhayCam,
} from "./trpcGioiHanThuTuc";

const t = initTRPC.create({ transformer: superjson });
const chay = vi.fn();
const muoi = t.middleware(({ next }) => next()); // đại diện bước nâng cấp 2FA
const nhieuBuoc = t.procedure.use(muoi);
const nhanDau = z.object({ s: z.string() }).optional();
const testRouter = t.router({
  twoFactor: t.router({
    verify: t.procedure.input(nhanDau).mutation(() => (chay("twoFactor.verify"), { ok: true })),
    getStatus: t.procedure.input(nhanDau).query(() => (chay("twoFactor.getStatus"), { ok: true })),
  }),
  user: t.router({
    verify2FA: t.procedure.input(nhanDau).mutation(() => (chay("user.verify2FA"), { ok: true })),
    changePassword: t.procedure.input(nhanDau).mutation(() => (chay("user.changePassword"), { ok: true })),
    getById: t.procedure.input(nhanDau).query(() => (chay("user.getById"), { ok: true })),
  }),
  auth: t.router({ login: t.procedure.input(nhanDau).mutation(() => (chay("auth.login"), { ok: true })) }),
  vram: t.router({ deploy: nhieuBuoc.input(nhanDau).mutation(() => (chay("vram.deploy"), { ok: true })) }),
  foo: t.router({ bar: t.procedure.input(nhanDau).mutation(() => (chay("foo.bar"), { ok: true })) }),
});

const NHOM_NHO: Record<NhomNhayCam, CauHinhNhom> = {
  "2fa": { ...NHOM_THU_TUC_NHAY_CAM["2fa"], toiDa: 3 },
  auth: { ...NHOM_THU_TUC_NHAY_CAM.auth, toiDa: 2 },
};

let server: http.Server;
let base = "";
let storeLoi = false;
let soLanTaoStore = 0;
const storeThat = new Map<string, Store>();

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(
    "/api/trpc",
    trpcGioiHanThuTucMiddleware({
      router: testRouter,
      nhom: NHOM_NHO,
      buocNangCap: [muoi],
      layKhoaNguoi: async (req) => (typeof req.headers["x-test-user"] === "string" ? `u:${req.headers["x-test-user"]}` : null),
      taoStore: (prefix, cuaSoMs) => {
        soLanTaoStore++;
        const s = new MemoryStore();
        s.init({ windowMs: cuaSoMs } as Options);
        const boc: Store = {
          init: (o) => s.init?.(o),
          increment: async (k) => {
            if (storeLoi) throw new Error("store hỏng giả lập");
            return s.increment(k);
          },
          decrement: (k) => s.decrement(k),
          resetKey: (k) => s.resetKey(k),
        };
        storeThat.set(prefix, boc);
        return boc;
      },
    }),
  );
  app.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const duong = (ten: string, n: number) => Array.from({ length: n }, () => ten).join(",");
const than = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), superjson.serialize({ s: "x" + i })])));
const goi = (path: string, n: number, h: Record<string, string> = {}) =>
  fetch(`${base}/${path}?batch=1`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: than(n) });
const ipRieng = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe("phanNhomThuTuc — phân loại", () => {
  const tap = new Set(["vram.deploy"]);
  it("tiền tố twoFactor.* chỉ đếm MUTATION; query (getStatus) không đếm; loại không rõ ⇒ coi như mutation (fail-closed)", () => {
    expect(phanNhomThuTuc("twoFactor.verify", "mutation", tap)).toBe("2fa");
    expect(phanNhomThuTuc("twoFactor.getStatus", "query", tap)).toBeNull();
    expect(phanNhomThuTuc("twoFactor.khongRo", undefined, tap)).toBe("2fa");
  });
  it("danh sách chính xác đếm MỌI loại thủ tục", () => {
    expect(phanNhomThuTuc("user.verify2FA", "mutation", tap)).toBe("2fa");
    expect(phanNhomThuTuc("user.disable2FA", "mutation", tap)).toBe("2fa");
    // R1a final I-1 (2026-10-24): scadaCommands.confirm MIỄN nhóm 2fa — TOTP đã chặn theo TÀI KHOẢN bởi T16 (verifyTotpOnce 5/5 phút, tính TRƯỚC khi xác minh);
    // nhóm 20/15 phút chung IP + người với deploy/twoFactor sẽ bóp các lệnh đặt giá trị HMI mức 1/3 thường ngày. Census kiemXacThucTheoMuc ghi miễn trừ.
    expect(phanNhomThuTuc("scadaCommands.confirm", "mutation", tap)).toBeNull();
    expect(phanNhomThuTuc("auth.login", "mutation", tap)).toBe("auth");
    expect(phanNhomThuTuc("user.changePassword", "mutation", tap)).toBe("auth");
    expect(phanNhomThuTuc("auth.login", "query", tap)).toBe("auth");
  });
  it("tập step-up suy từ router ⇒ nhóm 2fa; thủ tục thường ⇒ null", () => {
    expect(phanNhomThuTuc("vram.deploy", "mutation", tap)).toBe("2fa");
    expect(phanNhomThuTuc("foo.bar", "mutation", tap)).toBeNull();
    expect(phanNhomThuTuc("user.getById", "query", tap)).toBeNull();
  });
  it("hằng nhóm: 2fa = 20/15 phút; auth theo AUTH_RATE_LIMIT", () => {
    expect(NHOM_THU_TUC_NHAY_CAM["2fa"]).toMatchObject({ toiDa: 20, cuaSoMs: 15 * 60 * 1000 });
    expect(NHOM_THU_TUC_NHAY_CAM.auth.cuaSoMs).toBe(15 * 60 * 1000);
    expect(NHOM_THU_TUC_NHAY_CAM.auth.toiDa).toBeGreaterThan(0);
  });
});

describe("layTapThuTucStepUp — suy tập từ router theo DANH TÍNH middleware", () => {
  it("chỉ thủ tục có middleware bước nâng cấp; router không có ⇒ rỗng", () => {
    const tap = layTapThuTucStepUp(testRouter, [muoi]);
    expect([...tap]).toEqual(["vram.deploy"]);
    expect(layTapThuTucStepUp(testRouter, []).size).toBe(0);
    const khac = t.middleware(({ next }) => next());
    expect(layTapThuTucStepUp(testRouter, [khac]).size).toBe(0);
  });
});

describe("trpcGioiHanThuTucMiddleware — đếm từng thủ tục trong batch", () => {
  it("★★★ batch VƯỢT ngưỡng nhóm 2fa ⇒ 429 + Retry-After + mã rõ, KHÔNG thủ tục nào chạy", async () => {
    chay.mockClear();
    const res = await goi(duong("twoFactor.verify", 4), 4, { "x-forwarded-for": ipRieng() });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const j = (await res.json()) as { error: { json: { data: { appCode: string; nhom: string; httpStatus: number } } } };
    expect(j.error.json.data).toMatchObject({ appCode: "TRPC_GIOI_HAN_THU_TUC", nhom: "2fa", httpStatus: 429 });
    expect(chay).not.toHaveBeenCalled();
  });

  it("★★★ đúng ngưỡng ⇒ chạy đủ; lần kế (cộng dồn qua yêu cầu) ⇒ 429 — đếm theo THỦ TỤC chứ không theo yêu cầu", async () => {
    chay.mockClear();
    const h = { "x-forwarded-for": ipRieng() };
    expect((await goi(duong("twoFactor.verify", 3), 3, h)).status).toBe(200);
    expect(chay).toHaveBeenCalledTimes(3);
    chay.mockClear();
    expect((await goi("twoFactor.verify", 1, h)).status).toBe(429);
    expect(chay).not.toHaveBeenCalled();
  });

  it("★★★ khoá theo NGƯỜI DÙNG độc lập với IP: cùng user đổi IP vẫn bị chặn; IP khác, user khác ⇒ qua", async () => {
    chay.mockClear();
    const u = "nguoi" + Math.random().toString(36).slice(2, 8);
    for (let i = 0; i < 3; i++) expect((await goi("twoFactor.verify", 1, { "x-forwarded-for": ipRieng(), "x-test-user": u })).status).toBe(200);
    expect((await goi("twoFactor.verify", 1, { "x-forwarded-for": ipRieng(), "x-test-user": u })).status).toBe(429); // IP mới tinh nhưng khoá user đã cạn
    expect((await goi("twoFactor.verify", 1, { "x-forwarded-for": ipRieng(), "x-test-user": u + "khac" })).status).toBe(200);
  });

  it("★★★ khoá theo IP độc lập với người dùng: cùng IP, nhiều user khác nhau ⇒ vẫn cạn", async () => {
    const ip = ipRieng();
    for (let i = 0; i < 3; i++) expect((await goi("twoFactor.verify", 1, { "x-forwarded-for": ip, "x-test-user": "a" + i + Math.random() })).status).toBe(200);
    expect((await goi("twoFactor.verify", 1, { "x-forwarded-for": ip, "x-test-user": "moi" + Math.random() })).status).toBe(429);
  });

  it("★★ query twoFactor.getStatus KHÔNG đếm (trang nào cũng hỏi)", async () => {
    chay.mockClear();
    const h = { "x-forwarded-for": ipRieng() };
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/twoFactor.getStatus?batch=1&input=${encodeURIComponent(than(1))}`, { headers: h });
      expect(r.status).toBe(200);
    }
    expect(chay).toHaveBeenCalledTimes(10);
  });

  it("★★ batch HỖN HỢP: thủ tục thường không bị đếm, nhưng một thủ tục nhạy cảm vượt ngưỡng ⇒ cả yêu cầu bị 429, thủ tục thường cũng không chạy", async () => {
    chay.mockClear();
    const h = { "x-forwarded-for": ipRieng() };
    const path = ["foo.bar", ...Array.from({ length: 4 }, () => "twoFactor.verify"), "foo.bar"].join(",");
    const res = await goi(path, 6, h);
    expect(res.status).toBe(429);
    expect(chay).not.toHaveBeenCalled();
    // 3 thủ tục nhạy cảm + 10 thủ tục thường ⇒ vẫn qua
    const ok = await goi(["twoFactor.verify", "twoFactor.verify", "twoFactor.verify", ...Array.from({ length: 10 }, () => "foo.bar")].join(","), 13, { "x-forwarded-for": ipRieng() });
    expect(ok.status).toBe(200);
  });

  it("★★ nhóm auth có ngưỡng riêng (auth.login, user.changePassword dùng chung nhóm)", async () => {
    const h = { "x-forwarded-for": ipRieng() };
    expect((await goi("auth.login,user.changePassword", 2, h)).status).toBe(200);
    expect((await goi("auth.login", 1, h)).status).toBe(429);
  });

  it("★★ thủ tục đứng trên bước nâng cấp (suy từ router) cũng thuộc nhóm 2fa", async () => {
    const h = { "x-forwarded-for": ipRieng() };
    expect((await goi(duong("vram.deploy", 3), 3, h)).status).toBe(200);
    expect((await goi("vram.deploy", 1, h)).status).toBe(429);
  });

  it("★★★ không né được bằng mã hoá dấu phẩy (%2C)", async () => {
    chay.mockClear();
    const res = await goi(duong("twoFactor.verify", 4).replace(/,/g, "%2C"), 4, { "x-forwarded-for": ipRieng() });
    expect(res.status).toBe(429);
    expect(chay).not.toHaveBeenCalled();
  });

  it("★★ yêu cầu ĐƠN (không batch) cũng được đếm", async () => {
    const h = { "x-forwarded-for": ipRieng() };
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${base}/twoFactor.verify`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(superjson.serialize({ s: "x" })) });
      expect(r.status).toBe(200);
    }
    const r4 = await fetch(`${base}/twoFactor.verify`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(superjson.serialize({ s: "x" })) });
    expect(r4.status).toBe(429);
  });

  it("★★ thủ tục không nhạy cảm không chạm store (không tốn đếm)", async () => {
    const truoc = soLanTaoStore;
    const res = await goi(duong("foo.bar", 20), 20, { "x-forwarded-for": ipRieng() });
    expect(res.status).toBe(200);
    expect(soLanTaoStore).toBe(truoc); // store nhóm đã tạo từ ca trước; không tạo thêm
  });

  it("★★★ store lỗi ⇒ FAIL-OPEN (yêu cầu vẫn chạy) và GHI LOG cảnh báo", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storeLoi = true;
    try {
      chay.mockClear();
      const res = await goi(duong("twoFactor.verify", 5), 5, { "x-forwarded-for": ipRieng() });
      expect(res.status).toBe(200);
      expect(chay).toHaveBeenCalledTimes(5);
      expect(canh.mock.calls.some((c) => String(c[0]).includes("FAIL-OPEN"))).toBe(true);
    } finally {
      storeLoi = false;
      canh.mockRestore();
    }
  });
});
