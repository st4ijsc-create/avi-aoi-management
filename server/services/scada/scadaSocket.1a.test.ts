/**
 * SCADA 1a — hợp đồng kênh đẩy cho màn trung thực: `staleAfterMs` theo tag, `scada:tick` 1 Hz, `capMs` theo đăng ký, `seq` theo (socket, subId),
 * trần "nóng" `TOO_MANY_HOT`, và tương tác với F5 (socket bị đá ⇒ thả đăng ký + suất nóng, vòng dừng nếu là cuối).
 * Brief scada-ui 2026-11-02 §5 — mỗi ca có đột biến phải ĐỎ (bảng đột biến ở báo cáo task-1a).
 * Socket giả + bộ hẹn giả (trừ ca F5: socket.io THẬT, không CSDL). Bộ đệm THẬT (Task 7), nuôi bằng `napTuOt`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { OtSample } from "../ot/otDriver";

const kiemQuyen = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
vi.mock("../../_core/accessControl", () => ({ checkPermission: kiemQuyen }));
vi.mock("../../db/otTelemetry", () => ({ layMoiNhatTheoThietBi: vi.fn(async () => []) }));

import { __datCongPhamViChoTest } from "../../_core/socketPhongQuyen";
import { NGUONG_DEADBAND_MS, __datLaiBoDemHienTai, datThongTinAdapter, layGiaTri, napTuOt, nguongCuCuaAdapter } from "./boDemHienTai";
import { __datLaiTrangThaiAdapter, baoTrangThaiAdapter } from "../ot/trangThaiAdapter";
import {
  GIOI_HAN,
  __datLaiScadaSocket,
  __datTraAdapterChoTest,
  __soDangKyNong,
  __soSocketDangKy,
  __vongDangChay,
  registerScadaHandlers,
} from "./scadaSocket";

type Cb = (...a: any[]) => any;
function taoSocket(data: Record<string, unknown> = { clientType: "browser", user: { id: 1, role: "engineer" } }) {
  const handlers = new Map<string, Cb>();
  const sk: any = { data, emit: vi.fn(), on: (ev: string, cb: Cb) => void handlers.set(ev, cb) };
  registerScadaHandlers(sk);
  const goi = async (ev: string, payload?: unknown) => handlers.get(ev)?.(payload);
  const nhan = (ev: string) => sk.emit.mock.calls.filter((c: any[]) => c[0] === ev).map((c: any[]) => c[1]);
  /** Mọi khung (snapshot/delta/tick) theo thứ tự phát. */
  const khung = (subId?: string) =>
    sk.emit.mock.calls
      .filter((c: any[]) => ["scada:snapshot", "scada:delta", "scada:tick"].includes(c[0]) && (subId === undefined || c[1].subId === subId))
      .map((c: any[]) => ({ ev: c[0] as string, ...c[1] }));
  return { sk, goi, nhan, khung };
}
const nguoi = (id: number) => ({ clientType: "browser", user: { id, role: "engineer" } });

const T0 = 1_800_000_000_000;
function mau(tagKey: string, value: number, over: Partial<OtSample> = {}): OtSample {
  return { tagKey, raw: value, value, quality: "good", timestamp: new Date(Date.now()), ...over };
}
function dangKyAdapter(adapterId: number, machineId: number | null, pollMs = 1000, coDeadband = false) {
  datThongTinAdapter(adapterId, { pollMs, coDeadband, machineId, code: `A${adapterId}` });
}
function datPhamVi(ids: number[] | "toanQuyen") {
  __datCongPhamViChoTest({
    trongPhamVi: async (_cap, id) => ids === "toanQuyen" || ids.includes(id),
    idsTrongPhamVi: async () => (ids === "toanQuyen" ? null : ids),
  });
}
const adapterRuntime = (adapterId: number, machineId: number) => ({ adapterId, code: `A${adapterId}`, machineId, protocol: "modbus", tags: [] }) as never;

beforeEach(() => {
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __datLaiBoDemHienTai();
  __datLaiScadaSocket();
  __datLaiTrangThaiAdapter();
  kiemQuyen.mockReset();
  kiemQuyen.mockResolvedValue(true);
  __datTraAdapterChoTest(async () => new Map());
  datPhamVi("toanQuyen");
});
afterEach(() => {
  __datLaiScadaSocket();
  __datLaiTrangThaiAdapter();
  __datCongPhamViChoTest(null);
  __datTraAdapterChoTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("A3 — scada:tick 1 Hz cho mỗi đăng ký còn sống", () => {
  it("KHÔNG tag nào đổi: đúng 1 tick mỗi 1000 ms (3 s ⇒ 3 tick), không delta; tick không mang tagKey / giá trị", async () => {
    dangKyAdapter(10, 5);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("bimat_tag", 4242)]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "bimat_tag" }] });
    vi.advanceTimersByTime(999);
    expect(nhan("scada:tick")).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(nhan("scada:tick")).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    const ticks = nhan("scada:tick");
    expect(ticks).toHaveLength(3);
    expect(ticks.map((t: any) => t.serverTs)).toEqual([T0 + 1000, T0 + 2000, T0 + 3000]);
    expect(nhan("scada:delta")).toEqual([]);
    for (const t of ticks) {
      expect(Object.keys(t).sort()).toEqual(["adapters", "seq", "serverTs", "subId"]);
      expect(JSON.stringify(t)).not.toContain("bimat_tag");
      expect(JSON.stringify(t)).not.toContain("4242");
    }
  });

  it("hai đăng ký ⇒ mỗi đăng ký có tick riêng (subId riêng)", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:tick").map((t: any) => t.subId).sort()).toEqual(["x", "y"]);
  });
});

describe("A4 — tick.adapters CHỈ adapter có tag ĐƯỢC PHÉP", () => {
  it("hai adapter, một bị denied: tick chỉ adapter được phép; trạng thái kết nối + tuổi mẫu mới nhất thật; chưa báo trạng thái ⇒ null", async () => {
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "false");
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
    dangKyAdapter(10, 5); // máy 5 — ngoài phạm vi
    dangKyAdapter(11, 6);
    dangKyAdapter(12, 6);
    baoTrangThaiAdapter(adapterRuntime(10, 5), "lost", "x");
    baoTrangThaiAdapter(adapterRuntime(11, 6), "connected", null);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("t", 2)]);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }, { adapterId: 11, tagKey: "t" }, { adapterId: 12, tagKey: "t" }] });
    expect(nhan("scada:snapshot")[0].denied).toEqual([{ adapterId: 10, tagKey: "t" }]);
    vi.advanceTimersByTime(1000);
    const [tick] = nhan("scada:tick");
    expect(tick.adapters).toEqual([
      { adapterId: 11, trangThai: "connected", tuoiMauMoiNhatMs: 1000 },
      { adapterId: 12, trangThai: null, tuoiMauMoiNhatMs: null },
    ]);
  });

  it("tuoiMauMoiNhatMs = mẫu MỚI NHẤT trong các tag được phép của adapter (không phải tag khác của adapter)", async () => {
    dangKyAdapter(11, 6);
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("a", 1)]);
    vi.setSystemTime(T0 + 300);
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("b", 2)]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 11, tagKey: "a" }, { adapterId: 11, tagKey: "b" }] });
    vi.advanceTimersByTime(800); // chưa tới tick
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("khongDangKy", 3)]); // tag KHÔNG đăng ký mới hơn — không được tính
    vi.advanceTimersByTime(200);
    expect(nhan("scada:tick")[0].adapters).toEqual([{ adapterId: 11, trangThai: null, tuoiMauMoiNhatMs: 1000 }]);
  });

  it("A5 — adapter đổi máy giữa chừng: vắng khỏi tick (không lộ trạng thái adapter đã sang máy khác)", async () => {
    dangKyAdapter(11, 6);
    dangKyAdapter(12, 6);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 11, tagKey: "t" }, { adapterId: 12, tagKey: "t" }] });
    dangKyAdapter(11, 5); // chuyển sang máy 5
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:tick")[0].adapters.map((a: any) => a.adapterId)).toEqual([12]);
  });
});

describe("A1 — staleAfterMs = ngưỡng của bộ đệm (một nguồn sự thật)", () => {
  it("poll 5 s ⇒ 15 000; deadband ⇒ 70 000; bằng đúng nguongCuCuaAdapter", async () => {
    dangKyAdapter(20, 5, 5000, false);
    dangKyAdapter(21, 5, 1000, true);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 20, tagKey: "p" }, { adapterId: 20, tagKey: "q" }, { adapterId: 21, tagKey: "d" }] });
    const sn = nhan("scada:snapshot")[0];
    expect(sn.staleAfterMs).toEqual({ "20:p": 15_000, "20:q": 15_000, "21:d": 70_000 });
    expect(nguongCuCuaAdapter(20)).toBe(15_000);
    expect(nguongCuCuaAdapter(21)).toBe(NGUONG_DEADBAND_MS);
    expect(sn.staleAfterMs["21:d"]).toBe(nguongCuCuaAdapter(21));
  });

  it("cờ `stale` của bộ đệm lật ĐÚNG tại staleAfterMs đã gửi (cùng một hàm, không sao chép công thức)", async () => {
    for (const [id, poll, db] of [[30, 5000, false], [31, 1000, true], [32, 250, false]] as const) {
      dangKyAdapter(id, 5, poll, db);
      vi.setSystemTime(T0);
      napTuOt({ adapterId: id, machineId: 5 }, [mau("t", 1)]);
      const { goi, nhan } = taoSocket();
      await goi("scada:subscribe", { subId: `s${id}`, tags: [{ adapterId: id, tagKey: "t" }] });
      const nguong = nhan("scada:snapshot")[0].staleAfterMs[`${id}:t`];
      expect(layGiaTri(id, "t", T0 + nguong)!.stale, `${id} tại ngưỡng`).toBe(false);
      expect(layGiaTri(id, "t", T0 + nguong + 1)!.stale, `${id} sau ngưỡng`).toBe(true);
      __datLaiScadaSocket();
    }
  });

  it("adapter chưa đăng ký với trung tâm (edge, tra DB) ⇒ ngưỡng mặc định của bộ đệm (poll 5 s ⇒ 15 000)", async () => {
    __datTraAdapterChoTest(async (ids) => new Map(ids.map((i) => [i, { machineId: 5 }] as const)));
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 77, tagKey: "e" }] });
    expect(nhan("scada:snapshot")[0].staleAfterMs).toEqual({ "77:e": nguongCuCuaAdapter(77) });
    expect(nguongCuCuaAdapter(77)).toBe(15_000);
  });

  it("§4.3 — staleAfterMs KHÔNG có khoá của tag denied (ngoài phạm vi / không tồn tại)", async () => {
    dangKyAdapter(10, 5);
    dangKyAdapter(11, 6);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }, { adapterId: 11, tagKey: "t" }, { adapterId: 999, tagKey: "t" }] });
    const sn = nhan("scada:snapshot")[0];
    expect(sn.denied).toHaveLength(2);
    expect(sn.staleAfterMs).toEqual({ "11:t": 3000 });
  });
});

describe("A2 — ngưỡng ĐỔI giữa chừng ⇒ gửi lại (đính vào delta kế, hoặc tick nếu không có delta)", () => {
  it("đổi poll 1 s → 5 s: delta kế mang staleAfterMs CHỈ khoá của adapter đổi; delta sau không lặp lại", async () => {
    dangKyAdapter(10, 5, 1000);
    dangKyAdapter(11, 5, 1000);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }, { adapterId: 10, tagKey: "b" }, { adapterId: 11, tagKey: "c" }] });
    expect(nhan("scada:snapshot")[0].staleAfterMs).toEqual({ "10:a": 3000, "10:b": 3000, "11:c": 3000 });
    dangKyAdapter(10, 5, 5000);
    napTuOt({ adapterId: 11, machineId: 5 }, [mau("c", 1)]);
    vi.advanceTimersByTime(250);
    const [d1] = nhan("scada:delta");
    expect(d1.staleAfterMs).toEqual({ "10:a": 15_000, "10:b": 15_000 });
    napTuOt({ adapterId: 11, machineId: 5 }, [mau("c", 2)]);
    vi.advanceTimersByTime(250);
    expect(nhan("scada:delta")[1]).not.toHaveProperty("staleAfterMs");
    vi.advanceTimersByTime(500); // tick ở 1000 ms cũng không lặp lại
    expect(nhan("scada:tick")[0]).not.toHaveProperty("staleAfterMs");
  });

  it("bật deadband khi KHÔNG tag nào đổi ⇒ tick kế mang staleAfterMs 70 000 (không chờ một delta có thể không bao giờ tới)", async () => {
    dangKyAdapter(10, 5, 1000, false);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }] });
    dangKyAdapter(10, 5, 1000, true);
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:delta")).toEqual([]);
    expect(nhan("scada:tick")[0].staleAfterMs).toEqual({ "10:a": 70_000 });
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:tick")[1]).not.toHaveProperty("staleAfterMs");
  });

  it("A5 — adapter đổi máy: KHÔNG gửi ngưỡng mới cho tag của nó", async () => {
    dangKyAdapter(10, 6, 1000);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }] });
    dangKyAdapter(10, 5, 5000); // sang máy 5 + đổi poll
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:tick")[0]).not.toHaveProperty("staleAfterMs");
  });
});

describe("C1 — seq một dãy mỗi (socket, subId), chung snapshot/delta/tick", () => {
  it("snapshot 0, delta 1, tick 2, delta 3… tăng đúng 1 mỗi khung; subId khác có dãy riêng", async () => {
    dangKyAdapter(10, 5);
    const { goi, khung } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "u" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(750); // tick x + y
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 2)]);
    vi.advanceTimersByTime(250);
    expect(khung("x").map((k: any) => [k.ev, k.seq])).toEqual([
      ["scada:snapshot", 0],
      ["scada:delta", 1],
      ["scada:tick", 2],
      ["scada:delta", 3],
    ]);
    expect(khung("y").map((k: any) => [k.ev, k.seq])).toEqual([
      ["scada:snapshot", 0],
      ["scada:tick", 1],
    ]);
  });

  it("C2 — đăng ký lại cùng subId ⇒ snapshot mới seq 0; KHÔNG vòng thứ hai, KHÔNG rò đăng ký (một tick / giây)", async () => {
    dangKyAdapter(10, 5);
    const { goi, khung, sk } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    vi.advanceTimersByTime(1000); // tick seq 1
    await goi("scada:subscribe", { subId: "x", capMs: 100, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(vi.getTimerCount()).toBe(1);
    expect(__vongDangChay()).toBe(true);
    expect(sk.data.__scada.subs.size).toBe(1);
    expect(__soSocketDangKy()).toBe(1);
    vi.advanceTimersByTime(3000);
    const ks = khung("x");
    expect(ks.map((k: any) => [k.ev, k.seq])).toEqual([
      ["scada:snapshot", 0],
      ["scada:tick", 1],
      ["scada:snapshot", 0],
      ["scada:tick", 1],
      ["scada:tick", 2],
      ["scada:tick", 3],
    ]);
    await goi("scada:unsubscribe", { subId: "x" });
    expect(vi.getTimerCount()).toBe(0);
    expect(__soSocketDangKy()).toBe(0);
  });
});

describe("B1 — capMs: nhịp khung của socket = min capMs các đăng ký sống", () => {
  async function doNhip(capMs: number | undefined): Promise<number> {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", ...(capMs === undefined ? {} : { capMs }), tags: [{ adapterId: 10, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    let ms = 0;
    while (nhan("scada:delta").length === 0 && ms < 2000) {
      vi.advanceTimersByTime(GIOI_HAN.buocVongMs);
      ms += GIOI_HAN.buocVongMs;
    }
    __datLaiScadaSocket();
    return ms;
  }

  it("capMs 50 / 100 / 1000 / mặc định (250): thay đổi tới client đúng ở nhịp đó", async () => {
    expect(await doNhip(50)).toBe(50);
    expect(await doNhip(100)).toBe(100);
    expect(await doNhip(1000)).toBe(1000);
    expect(await doNhip(undefined)).toBe(250);
    expect(await doNhip(250)).toBe(250);
  });

  it("capMs:100 ⇒ mọi khung cách nhau ≤ 100 ms khi tag đổi liên tục", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", capMs: 100, tags: [{ adapterId: 10, tagKey: "t" }] });
    for (let i = 0; i < 20; i++) {
      napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", i)]);
      vi.advanceTimersByTime(50);
    }
    const ts = nhan("scada:delta").map((d: any) => d.serverTs);
    expect(ts.length).toBe(10);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeLessThanOrEqual(100);
  });

  it("hai đăng ký 100 & 1000 trên một socket ⇒ chu kỳ = 100 cho cả hai; huỷ đăng ký 100 ⇒ về 1000", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan, sk } = taoSocket();
    await goi("scada:subscribe", { subId: "nhanh", capMs: 100, tags: [{ adapterId: 10, tagKey: "a" }] });
    await goi("scada:subscribe", { subId: "cham", capMs: 1000, tags: [{ adapterId: 10, tagKey: "b" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("b", 1)]);
    vi.advanceTimersByTime(100);
    expect(nhan("scada:delta").map((d: any) => d.subId)).toEqual(["cham"]);
    await goi("scada:unsubscribe", { subId: "nhanh" });
    sk.emit.mockClear();
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("b", 2)]);
    vi.advanceTimersByTime(100); // nhịp 100 đã hết hiệu lực
    expect(nhan("scada:delta")).toEqual([]);
    vi.advanceTimersByTime(800); // bước 20 của lưới vòng = mốc 1000 ms
    expect(nhan("scada:delta")).toHaveLength(1);
  });

  it("socket khác không bị kéo theo nhịp của socket này", async () => {
    dangKyAdapter(10, 5);
    const a = taoSocket();
    const b = taoSocket(nguoi(2));
    await a.goi("scada:subscribe", { subId: "x", capMs: 50, tags: [{ adapterId: 10, tagKey: "t" }] });
    await b.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    vi.advanceTimersByTime(100);
    expect(a.nhan("scada:delta")).toHaveLength(1);
    expect(b.nhan("scada:delta")).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(b.nhan("scada:delta")).toHaveLength(1);
  });
});

describe("đầu vào capMs / nguon", () => {
  it.each([[0], [20], [200], [500], [2000], ["100"], [null], [100.5]])("capMs %j ngoài tập ⇒ BAD_REQUEST, không snapshot", async (capMs) => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", capMs, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([{ code: "BAD_REQUEST" }]);
    expect(nhan("scada:snapshot")).toEqual([]);
    expect(__vongDangChay()).toBe(false);
  });

  it.each([["mo_phong"], [""], [null], [1], ["THAT"]])("nguon %j ⇒ BAD_REQUEST (không im lặng coi là thật)", async (nguon) => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", nguon, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([{ code: "BAD_REQUEST" }]);
    expect(nhan("scada:snapshot")).toEqual([]);
  });

  it("đối chứng: nguon \"that\" + capMs hợp lệ ⇒ snapshot", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    for (const capMs of [50, 100, 250, 1000]) await goi("scada:subscribe", { subId: `c${capMs}`, nguon: "that", capMs, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([]);
    expect(nhan("scada:snapshot")).toHaveLength(4);
  });

  it("socket máy: capMs sai vẫn BAD_REQUEST (cùng thứ tự kiểm như người dùng)", async () => {
    const { goi, nhan } = taoSocket({ clientType: "machine", user: null });
    await goi("scada:subscribe", { subId: "x", capMs: 7, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([{ code: "BAD_REQUEST" }]);
  });
});

describe("B2 — trần nóng (capMs < 250): ≤ 2 mỗi socket, ≤ 3 mỗi người dùng (theo tiến trình)", () => {
  it("socket: 2 nóng được, cái thứ 3 ⇒ TOO_MANY_HOT (không snapshot, không lưu); 250/1000 vẫn được; thay subId nóng không tính thêm", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan, sk } = taoSocket();
    const tags = [{ adapterId: 10, tagKey: "t" }];
    await goi("scada:subscribe", { subId: "h1", capMs: 50, tags });
    await goi("scada:subscribe", { subId: "h2", capMs: 100, tags });
    expect(nhan("scada:error")).toEqual([]);
    const quyenTruoc = kiemQuyen.mock.calls.length;
    await goi("scada:subscribe", { subId: "h3", capMs: 100, tags });
    expect(nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]);
    expect(kiemQuyen.mock.calls.length, "vượt trần bị chặn TRƯỚC khi kiểm quyền / tra DB (chống khuếch đại)").toBe(quyenTruoc);
    expect(nhan("scada:snapshot").map((s: any) => s.subId)).toEqual(["h1", "h2"]);
    expect(sk.data.__scada.subs.has("h3")).toBe(false);
    await goi("scada:subscribe", { subId: "h2", capMs: 50, tags }); // thay chính nó
    await goi("scada:subscribe", { subId: "n1", capMs: 250, tags });
    await goi("scada:subscribe", { subId: "n2", capMs: 1000, tags });
    expect(nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]);
    expect(__soDangKyNong(1)).toBe(2);
    await goi("scada:subscribe", { subId: "h1", capMs: 250, tags }); // hạ nhiệt h1 ⇒ có chỗ
    await goi("scada:subscribe", { subId: "h3", capMs: 100, tags });
    expect(nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]);
    expect(__soDangKyNong(1)).toBe(2);
  });

  it("người dùng: 2 + 1 trên hai socket được, cái thứ 4 ⇒ TOO_MANY_HOT; người khác không bị ảnh hưởng; ngắt socket ⇒ nhả suất", async () => {
    dangKyAdapter(10, 5);
    const tags = [{ adapterId: 10, tagKey: "t" }];
    const s1 = taoSocket(nguoi(7));
    const s2 = taoSocket(nguoi(7));
    const khac = taoSocket(nguoi(8));
    await s1.goi("scada:subscribe", { subId: "a", capMs: 50, tags });
    await s1.goi("scada:subscribe", { subId: "b", capMs: 50, tags });
    await s2.goi("scada:subscribe", { subId: "a", capMs: 100, tags });
    expect(s2.nhan("scada:error")).toEqual([]);
    await s2.goi("scada:subscribe", { subId: "b", capMs: 100, tags });
    expect(s2.nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]);
    await khac.goi("scada:subscribe", { subId: "a", capMs: 50, tags });
    await khac.goi("scada:subscribe", { subId: "b", capMs: 50, tags });
    expect(khac.nhan("scada:error")).toEqual([]);
    expect(__soDangKyNong(7)).toBe(3);
    await s1.goi("disconnect");
    expect(__soDangKyNong(7)).toBe(1);
    await s2.goi("scada:subscribe", { subId: "b", capMs: 100, tags });
    expect(s2.nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]); // lỗi cũ, không thêm
    expect(s2.nhan("scada:snapshot").map((s: any) => s.subId)).toEqual(["a", "b"]);
  });

  it("chạy đua: hai socket của cùng người cùng chờ kiểm quyền ⇒ kiểm LẠI sau await (không vượt trần im lặng)", async () => {
    dangKyAdapter(10, 5);
    const tags = [{ adapterId: 10, tagKey: "t" }];
    const s1 = taoSocket(nguoi(7));
    const s2 = taoSocket(nguoi(7));
    await s1.goi("scada:subscribe", { subId: "a", capMs: 50, tags });
    await s1.goi("scada:subscribe", { subId: "b", capMs: 50, tags });
    let mo!: () => void;
    kiemQuyen.mockImplementationOnce(() => new Promise<boolean>((r) => { mo = () => r(true); }));
    const p = s2.goi("scada:subscribe", { subId: "a", capMs: 100, tags }); // qua kiểm sớm (2 < 3), đang chờ
    await vi.advanceTimersByTimeAsync(0);
    const s3 = taoSocket(nguoi(7));
    await s3.goi("scada:subscribe", { subId: "a", capMs: 100, tags }); // lấy suất thứ 3
    expect(s3.nhan("scada:error")).toEqual([]);
    mo();
    await p;
    expect(s2.nhan("scada:error")).toEqual([{ code: "TOO_MANY_HOT" }]);
    expect(s2.nhan("scada:snapshot")).toEqual([]);
    expect(__soDangKyNong(7)).toBe(3);
  });
});

describe("vòng + tick dừng khi không còn đăng ký; socket máy không tick", () => {
  it("huỷ đăng ký cuối ⇒ __vongDangChay false, 0 bộ hẹn, không tick nữa", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    vi.advanceTimersByTime(1000);
    expect(nhan("scada:tick")).toHaveLength(1);
    await goi("scada:unsubscribe", {});
    expect(__vongDangChay()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(nhan("scada:tick")).toHaveLength(1);
  });

  it("socket máy ⇒ snapshot denied cùng hình dạng (seq 0, staleAfterMs {}), KHÔNG tick, không vòng", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket({ clientType: "machine", user: null });
    await goi("scada:subscribe", { subId: "x", capMs: 50, tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:snapshot")).toEqual([{ subId: "x", seq: 0, serverTs: T0, values: [], staleAfterMs: {}, denied: [{ adapterId: 10, tagKey: "t" }] }]);
    vi.advanceTimersByTime(3000);
    expect(nhan("scada:tick")).toEqual([]);
    expect(__vongDangChay()).toBe(false);
  });

  it("socket máy + người dùng không quyền ⇒ CÙNG tập khoá snapshot (không phân biệt được qua kênh)", async () => {
    dangKyAdapter(10, 5);
    const may = taoSocket({ clientType: "machine", user: null });
    kiemQuyen.mockResolvedValue(false);
    const kq = taoSocket();
    await may.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await kq.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(kq.nhan("scada:snapshot")[0]).toEqual(may.nhan("scada:snapshot")[0]);
  });
});

describe("F5 — socket bị đá (`disconnectSockets(true)`, socket.io THẬT) ⇒ thả đăng ký + suất nóng; vòng dừng khi là cuối", () => {
  it("đá người 7 ⇒ suất nóng của 7 về 0, vòng còn (người 8 sống); đá người 8 ⇒ 0 socket, vòng dừng", async () => {
    vi.useRealTimers();
    dangKyAdapter(10, 5);
    const http = createServer();
    const io = new Server(http, { path: "/sk1a" });
    io.use((s, next) => {
      const uid = Number(s.handshake.auth?.uid);
      s.data = { clientType: "browser", user: { id: uid, role: "engineer" } };
      next();
    });
    const phia: any[] = [];
    io.on("connection", (s) => {
      phia.push(s);
      s.join(`kiem:user:${(s.data as any).user.id}`); // như phòng điều khiển F5 (socket.ts)
      registerScadaHandlers(s as never);
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const ketNoi = (uid: number) =>
      new Promise<ClientSocket>((resolve, reject) => {
        const c = ioClient(url, { path: "/sk1a", transports: ["websocket"], forceNew: true, reconnection: false, auth: { uid } });
        c.once("connect", () => resolve(c));
        c.once("connect_error", reject);
      });
    const clients: ClientSocket[] = [];
    try {
      const c7 = await ketNoi(7);
      const c8 = await ketNoi(8);
      clients.push(c7, c8);
      const sn: Record<number, any[]> = { 7: [], 8: [] };
      c7.on("scada:snapshot", (g) => sn[7].push(g));
      c8.on("scada:snapshot", (g) => sn[8].push(g));
      const tags = [{ adapterId: 10, tagKey: "t" }];
      c7.emit("scada:subscribe", { subId: "a", capMs: 50, tags });
      await vi.waitFor(() => expect(sn[7].length).toBe(1), { timeout: 5000 }); // một lệnh đang chờ mỗi socket (BUSY)
      c7.emit("scada:subscribe", { subId: "b", capMs: 100, tags });
      c8.emit("scada:subscribe", { subId: "a", capMs: 50, tags });
      await vi.waitFor(() => {
        expect(sn[7].length).toBe(2);
        expect(sn[8].length).toBe(1);
      }, { timeout: 5000 });
      expect(__soDangKyNong(7)).toBe(2);
      expect(__soDangKyNong(8)).toBe(1);
      io.local.in("kiem:user:7").disconnectSockets(true);
      await vi.waitFor(() => expect(__soDangKyNong(7)).toBe(0), { timeout: 5000 });
      const st7 = phia.find((s) => s.data.user.id === 7).data.__scada;
      expect(st7.subs.size, "đăng ký của socket bị đá được THẢ (không giữ bộ nhớ)").toBe(0);
      expect(st7.daNgat).toBe(true);
      expect(__soDangKyNong(8)).toBe(1);
      expect(__soSocketDangKy()).toBe(1);
      expect(__vongDangChay()).toBe(true);
      io.local.in("kiem:user:8").disconnectSockets(true);
      await vi.waitFor(() => expect(__vongDangChay()).toBe(false), { timeout: 5000 });
      expect(__soSocketDangKy()).toBe(0);
      expect(__soDangKyNong()).toBe(0);
    } finally {
      for (const c of clients) c.disconnect();
      await new Promise<void>((r) => io.close(() => r()));
    }
  });
});
