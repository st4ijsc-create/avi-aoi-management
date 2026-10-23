/**
 * SCADA R0 Task 8 - `scada:subscribe` co kiem pham vi tung tag (C.6). Socket gia; cong pham vi tiem bang `__datCongPhamViChoTest`;
 * `checkPermission` mock. Bo dem la THAT (Task 7), nuoi bang `napTuOt`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtSample } from "../ot/otDriver";

const kiemQuyen = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
const traSpy = vi.hoisted(() => vi.fn(async (_ids: number[]) => new Map<number, { machineId: number | null }>()));
vi.mock("../../_core/accessControl", () => ({ checkPermission: kiemQuyen }));
vi.mock("../../db/otTelemetry", () => ({ layMoiNhatTheoThietBi: vi.fn(async () => []) }));

import { __datCongPhamViChoTest } from "../../_core/socketPhongQuyen";
import { __datLaiBoDemHienTai, datThongTinAdapter, napTuOt, xoaAdapter } from "./boDemHienTai";
import { GIOI_HAN, __datLaiScadaSocket, __datTraAdapterChoTest, __vongDangChay, registerScadaHandlers } from "./scadaSocket";

type Cb = (...a: any[]) => any;
function taoSocket(data: Record<string, unknown> = { clientType: "browser", user: { id: 1, role: "engineer" } }) {
  const handlers = new Map<string, Cb>();
  const sk: any = {
    data,
    emit: vi.fn(),
    on: (ev: string, cb: Cb) => void handlers.set(ev, cb),
  };
  registerScadaHandlers(sk);
  const goi = async (ev: string, payload?: unknown) => handlers.get(ev)?.(payload);
  const nhan = (ev: string) => sk.emit.mock.calls.filter((c: any[]) => c[0] === ev).map((c: any[]) => c[1]);
  return { sk, goi, nhan, handlers };
}

const T0 = 1_800_000_000_000;
function mau(tagKey: string, value: number, over: Partial<OtSample> = {}): OtSample {
  return { tagKey, raw: value, value, quality: "good", timestamp: new Date(Date.now()), ...over };
}
function dangKyAdapter(adapterId: number, machineId: number | null, pollMs = 1000) {
  datThongTinAdapter(adapterId, { pollMs, coDeadband: false, machineId, code: `A${adapterId}` });
}
/** Cong pham vi: nguoi chi trong pham vi cac may `ids`; `toanQuyen` => idsTrongPhamVi tra null. */
function datPhamVi(ids: number[] | "toanQuyen") {
  __datCongPhamViChoTest({
    trongPhamVi: async (_cap, id) => ids === "toanQuyen" || ids.includes(id),
    idsTrongPhamVi: async () => (ids === "toanQuyen" ? null : ids),
  });
}

beforeEach(() => {
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __datLaiBoDemHienTai();
  __datLaiScadaSocket();
  kiemQuyen.mockReset();
  kiemQuyen.mockResolvedValue(true);
  traSpy.mockReset();
  traSpy.mockResolvedValue(new Map());
  __datTraAdapterChoTest(traSpy);
  datPhamVi("toanQuyen");
});
afterEach(() => {
  __datLaiScadaSocket();
  __datCongPhamViChoTest(null);
  __datTraAdapterChoTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("gioi han + co", () => {
  it("501 tag => TOO_MANY_TAGS, khong snapshot, khong vong", async () => {
    dangKyAdapter(1, 5);
    const { goi, nhan, sk } = taoSocket();
    const tags = Array.from({ length: GIOI_HAN.tagMoiDangKy + 1 }, (_, i) => ({ adapterId: 1, tagKey: `t${i}` }));
    await goi("scada:subscribe", { subId: "a", tags });
    expect(nhan("scada:error")).toEqual([{ code: "TOO_MANY_TAGS" }]);
    expect(nhan("scada:snapshot")).toEqual([]);
    expect(sk.data.__scada?.subs?.size ?? 0).toBe(0);
    expect(__vongDangChay()).toBe(false);
  });

  it("dung 500 tag van duoc", async () => {
    dangKyAdapter(1, 5);
    const { goi, nhan } = taoSocket();
    const tags = Array.from({ length: GIOI_HAN.tagMoiDangKy }, (_, i) => ({ adapterId: 1, tagKey: `t${i}` }));
    await goi("scada:subscribe", { subId: "a", tags });
    expect(nhan("scada:error")).toEqual([]);
    expect(nhan("scada:snapshot")[0].values).toHaveLength(500);
  });

  it("dang ky thu 11 => TOO_MANY_SUBS; dang ky lai cung subId khong tinh them", async () => {
    dangKyAdapter(1, 5);
    const { goi, nhan } = taoSocket();
    for (let i = 0; i < GIOI_HAN.dangKyMoiSocket; i++) await goi("scada:subscribe", { subId: `s${i}`, tags: [{ adapterId: 1, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([]);
    await goi("scada:subscribe", { subId: "s0", tags: [{ adapterId: 1, tagKey: "t2" }] }); // thay the, khong tinh them
    expect(nhan("scada:error")).toEqual([]);
    await goi("scada:subscribe", { subId: "s10", tags: [{ adapterId: 1, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([{ code: "TOO_MANY_SUBS" }]);
  });

  it("co tat => DISABLED (hai co)", async () => {
    dangKyAdapter(1, 5);
    vi.stubEnv("SCADA_SOCKET_ENABLED", "false");
    const a = taoSocket();
    await a.goi("scada:subscribe", { tags: [{ adapterId: 1, tagKey: "t" }] });
    expect(a.nhan("scada:error")).toEqual([{ code: "DISABLED" }]);
    vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    const b = taoSocket();
    await b.goi("scada:subscribe", { tags: [{ adapterId: 1, tagKey: "t" }] });
    expect(b.nhan("scada:error")).toEqual([{ code: "DISABLED" }]);
    expect(b.nhan("scada:snapshot")).toEqual([]);
    expect(__vongDangChay()).toBe(false);
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ tags: "x" }],
    [{ tags: [] }],
    [{ tags: [{ adapterId: "1", tagKey: "t" }] }],
    [{ tags: [{ adapterId: 1.5, tagKey: "t" }] }],
    [{ tags: [{ adapterId: 1, tagKey: "" }] }],
    [{ tags: [{ adapterId: 1, tagKey: 5 }] }],
    [{ tags: [null] }],
    [{ subId: 5, tags: [{ adapterId: 1, tagKey: "t" }] }],
  ])("dau vao sai %j => BAD_REQUEST", async (payload) => {
    dangKyAdapter(1, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", payload);
    expect(nhan("scada:error")).toEqual([{ code: "BAD_REQUEST" }]);
    expect(nhan("scada:snapshot")).toEqual([]);
  });
});

describe("kiem pham vi tung tag", () => {
  it("nguoi khong co pham vi may 5: tag may 5 vao denied, tag may 6 duoc gia tri", async () => {
    dangKyAdapter(10, 5);
    dangKyAdapter(11, 6);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("temp", 111)]);
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("temp", 222)]);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }, { adapterId: 11, tagKey: "temp" }] });
    const [sn] = nhan("scada:snapshot");
    expect(sn.subId).toBe("x");
    expect(sn.denied).toEqual([{ adapterId: 10, tagKey: "temp" }]);
    expect(sn.values).toHaveLength(1);
    expect(sn.values[0].slice(0, 5)).toEqual([11, "temp", 222, "good", T0]);
    // gia tri may 5 khong lot ra o bat ky vi tri nao
    expect(JSON.stringify(sn)).not.toContain("111");
  });

  it("adapter machineId null: chi duoc khi idsTrongPhamVi tra null (toan quyen)", async () => {
    dangKyAdapter(20, null);
    napTuOt({ adapterId: 20, machineId: null }, [mau("t", 9)]);
    datPhamVi([5, 6]);
    const hep = taoSocket();
    await hep.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 20, tagKey: "t" }] });
    expect(hep.nhan("scada:snapshot")[0]).toMatchObject({ values: [], denied: [{ adapterId: 20, tagKey: "t" }] });
    datPhamVi("toanQuyen");
    const rong = taoSocket();
    await rong.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 20, tagKey: "t" }] });
    expect(rong.nhan("scada:snapshot")[0].denied).toEqual([]);
    expect(rong.nhan("scada:snapshot")[0].values[0][2]).toBe(9);
  });

  it("socket khong phai nguoi dung (machine) => moi tag bi tu choi, khong vong", async () => {
    dangKyAdapter(10, 5);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("temp", 1)]);
    const { goi, nhan } = taoSocket({ clientType: "machine", user: null });
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    expect(nhan("scada:snapshot")[0]).toEqual({ subId: "x", values: [], denied: [{ adapterId: 10, tagKey: "temp" }] });
  });

  it("khong co quyen machine_monitoring/canView => denied; loi kiem quyen => denied (fail-closed)", async () => {
    dangKyAdapter(10, 5);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("temp", 1)]);
    kiemQuyen.mockResolvedValue(false);
    const a = taoSocket();
    await a.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    expect(a.nhan("scada:snapshot")[0].values).toEqual([]);
    kiemQuyen.mockRejectedValue(new Error("db"));
    const b = taoSocket();
    await b.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    expect(b.nhan("scada:snapshot")[0]).toMatchObject({ values: [], denied: [{ adapterId: 10, tagKey: "temp" }] });
  });

  it("loi cong pham vi (CSDL) => denied", async () => {
    dangKyAdapter(10, 5);
    __datCongPhamViChoTest({
      trongPhamVi: async () => {
        throw new Error("db");
      },
      idsTrongPhamVi: async () => {
        throw new Error("db");
      },
    });
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    expect(nhan("scada:snapshot")[0].values).toEqual([]);
    expect(nhan("scada:snapshot")[0].denied).toHaveLength(1);
  });

  it("adapter khong ton tai => denied (cung ket qua nhu ngoai pham vi)", async () => {
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 999, tagKey: "t" }] });
    expect(nhan("scada:snapshot")[0]).toEqual({ subId: "x", values: [], denied: [{ adapterId: 999, tagKey: "t" }] });
  });

  it("adapter ton tai nhung khong do trung tam: xet pham vi theo machineId DB, tra v:null bad stale", async () => {
    traSpy.mockImplementation(async (ids: number[]) => new Map(ids.filter((i) => i === 30 || i === 31).map((i) => [i, { machineId: i === 30 ? 5 : 6 }] as const)));
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 30, tagKey: "t" }, { adapterId: 31, tagKey: "t" }] });
    const [sn] = nhan("scada:snapshot");
    expect(sn.denied).toEqual([{ adapterId: 30, tagKey: "t" }]);
    expect(sn.values).toEqual([[31, "t", null, "bad", 0, -1, true, "stale"]]);
  });

  // final M4 — phạm vi: MỘT idsTrongPhamVi("machine") mỗi lần đăng ký (không phải một trongPhamVi mỗi máy — tới ~500 lần DB).
  it("quyen nguoi dung duoc kiem DUNG MOT lan moi lan dang ky du co nhieu may; pham vi: MOT idsTrongPhamVi('machine') moi dang ky, khong trongPhamVi", async () => {
    dangKyAdapter(10, 5);
    dangKyAdapter(11, 6);
    dangKyAdapter(12, 7);
    dangKyAdapter(13, null);
    const trongPhamVi = vi.fn(async () => true);
    const idsTrongPhamVi = vi.fn(async (_cap: string) => [5, 7]);
    __datCongPhamViChoTest({ trongPhamVi, idsTrongPhamVi } as never);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", {
      subId: "x",
      tags: [10, 11, 12, 13].flatMap((adapterId) => [{ adapterId, tagKey: "a" }, { adapterId, tagKey: "b" }]),
    });
    expect(kiemQuyen).toHaveBeenCalledTimes(1);
    expect(trongPhamVi).not.toHaveBeenCalled();
    expect(idsTrongPhamVi).toHaveBeenCalledTimes(1);
    expect(idsTrongPhamVi.mock.calls[0][0]).toBe("machine");
    const [sn] = nhan("scada:snapshot");
    // may 6 ngoai pham vi; adapter khong gan may (13) chi cho toan quyen ⇒ denied
    expect(sn.denied).toEqual([
      { adapterId: 11, tagKey: "a" },
      { adapterId: 11, tagKey: "b" },
      { adapterId: 13, tagKey: "a" },
      { adapterId: 13, tagKey: "b" },
    ]);
    expect(sn.values.map((v: unknown[]) => v[0])).toEqual([10, 10, 12, 12]);
  });

  it("final M4 — toan quyen (idsTrongPhamVi null) ⇒ moi may + adapter khong gan may deu duoc, van MOT lan goi", async () => {
    dangKyAdapter(10, 5);
    dangKyAdapter(13, null);
    const idsTrongPhamVi = vi.fn(async () => null);
    __datCongPhamViChoTest({ trongPhamVi: vi.fn(async () => false), idsTrongPhamVi } as never);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }, { adapterId: 13, tagKey: "a" }] });
    expect(idsTrongPhamVi).toHaveBeenCalledTimes(1);
    expect(nhan("scada:snapshot")[0].denied).toEqual([]);
  });

  it("khong co quyen => tat ca denied va KHONG tra CSDL adapter", async () => {
    kiemQuyen.mockResolvedValue(false);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 700, tagKey: "a" }, { adapterId: 701, tagKey: "a" }] });
    expect(traSpy).not.toHaveBeenCalled();
    expect(nhan("scada:snapshot")[0].values).toEqual([]);
    expect(nhan("scada:snapshot")[0].denied).toHaveLength(2);
  });
});

describe("chong khuech dai (I1)", () => {
  it("socket may (khong phai nguoi dung) + 500 adapter la => 0 lan tra CSDL, 0 lan kiem quyen, tat ca denied, khong luu dang ky, khong vong", async () => {
    const { goi, nhan, sk } = taoSocket({ clientType: "machine", user: null });
    const tags = Array.from({ length: 500 }, (_, i) => ({ adapterId: 5000 + i, tagKey: "t" }));
    await goi("scada:subscribe", { subId: "x", tags });
    expect(traSpy).not.toHaveBeenCalled();
    expect(kiemQuyen).not.toHaveBeenCalled();
    const [sn] = nhan("scada:snapshot");
    expect(sn.values).toEqual([]);
    expect(sn.denied).toHaveLength(500);
    expect(sk.data.__scada.subs.size).toBe(0);
    expect(__vongDangChay()).toBe(false);
  });

  it("nguoi dung + 3 adapter la => dung 1 lan tra CSDL mang ca 3 id", async () => {
    const { goi } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [900, 901, 902, 900].map((adapterId, i) => ({ adapterId, tagKey: `t${i}` })) });
    expect(traSpy).toHaveBeenCalledTimes(1);
    expect([...traSpy.mock.calls[0][0]].sort()).toEqual([900, 901, 902]);
  });

  it("adapter do trung tam quan khong bi tra CSDL", async () => {
    dangKyAdapter(10, 5);
    const { goi } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }] });
    expect(traSpy).not.toHaveBeenCalled();
  });

  it("tra CSDL loi => tag la bi denied (khong biet => chan)", async () => {
    traSpy.mockRejectedValue(new Error("db"));
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 900, tagKey: "a" }] });
    expect(nhan("scada:snapshot")[0]).toEqual({ subId: "x", values: [], denied: [{ adapterId: 900, tagKey: "a" }] });
  });

  it("subscribe thu hai khi cai dau con dang cho => BUSY; xong cai dau thi nhan lai duoc", async () => {
    dangKyAdapter(10, 5);
    let mo!: () => void;
    kiemQuyen.mockImplementationOnce(() => new Promise<boolean>((r) => { mo = () => r(true); }));
    const { goi, nhan } = taoSocket();
    const p1 = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([{ code: "BUSY" }]);
    mo();
    await p1;
    expect(nhan("scada:snapshot").map((s: any) => s.subId)).toEqual(["x"]);
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:snapshot").map((s: any) => s.subId)).toEqual(["x", "y"]);
    expect(nhan("scada:error")).toEqual([{ code: "BUSY" }]);
  });

  it("subscribe loi giua chung van tha co BUSY (khong ket vinh vien)", async () => {
    dangKyAdapter(10, 5);
    kiemQuyen.mockRejectedValueOnce(new Error("db"));
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:error")).toEqual([]);
    expect(nhan("scada:snapshot")).toHaveLength(2);
  });
});

describe("huy khi dang cho (I3)", () => {
  function chamKiemQuyen() {
    let mo!: () => void;
    kiemQuyen.mockImplementationOnce(() => new Promise<boolean>((r) => { mo = () => r(true); }));
    return () => mo();
  }

  it("unsubscribe{subId} truoc khi kiem quyen xong => khong snapshot, khong dang ky, vong khong chay", async () => {
    dangKyAdapter(10, 5);
    const mo = chamKiemQuyen();
    const { goi, nhan, sk } = taoSocket();
    const p = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("scada:unsubscribe", { subId: "x" });
    mo();
    await p;
    expect(nhan("scada:snapshot")).toEqual([]);
    expect(sk.data.__scada.subs.size).toBe(0);
    expect(__vongDangChay()).toBe(false);
  });

  it("unsubscribe tat ca truoc khi kiem quyen xong => khong snapshot, khong dang ky, vong khong chay", async () => {
    dangKyAdapter(10, 5);
    const mo = chamKiemQuyen();
    const { goi, nhan, sk } = taoSocket();
    const p = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("scada:unsubscribe", {});
    mo();
    await p;
    expect(nhan("scada:snapshot")).toEqual([]);
    expect(sk.data.__scada.subs.size).toBe(0);
    expect(__vongDangChay()).toBe(false);
  });

  it("unsubscribe subId KHAC khong huy lenh dang cho", async () => {
    dangKyAdapter(10, 5);
    const mo = chamKiemQuyen();
    const { goi, nhan } = taoSocket();
    const p = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("scada:unsubscribe", { subId: "khac" });
    mo();
    await p;
    expect(nhan("scada:snapshot")).toHaveLength(1);
    expect(__vongDangChay()).toBe(true);
  });

  it("huy lenh dang cho roi dang ky lai cung subId van duoc", async () => {
    dangKyAdapter(10, 5);
    const mo = chamKiemQuyen();
    const { goi, nhan } = taoSocket();
    const p = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("scada:unsubscribe", { subId: "x" });
    mo();
    await p;
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:snapshot")).toHaveLength(1);
  });
});

describe("snapshot + stale", () => {
  it("tag duoc phep nhung chua co trong bo dem => v:null, q:bad, reason:stale", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "chuaCo" }] });
    const [sn] = nhan("scada:snapshot");
    expect(sn.denied).toEqual([]);
    expect(sn.values).toEqual([[10, "chuaCo", null, "bad", 0, -1, true, "stale"]]);
  });

  it("tag stale hien stale:true va ageMs > nguong", async () => {
    dangKyAdapter(10, 5, 1000);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("temp", 7)]);
    vi.setSystemTime(T0 + 10_000);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    const v = nhan("scada:snapshot")[0].values[0];
    expect(v[6]).toBe(true);
    expect(v[5]).toBeGreaterThan(3000);
    expect(v[2]).toBe(7);
  });

  it("mau tuoi: stale:false, mang reason cua mau (bad)", async () => {
    dangKyAdapter(10, 5, 1000);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1, { value: null, quality: "bad", reason: "comm_lost" })]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    const v = nhan("scada:snapshot")[0].values[0];
    expect(v.slice(2, 4)).toEqual([null, "bad"]);
    expect(v[6]).toBe(false);
    expect(v[7]).toBe("comm_lost");
  });

  it("khong subId => server cap mot subId va tra trong snapshot", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(typeof nhan("scada:snapshot")[0].subId).toBe("string");
    expect(nhan("scada:snapshot")[0].subId.length).toBeGreaterThan(0);
  });
});

describe("delta gop 250 ms", () => {
  it("20 lan napTuOt cung tag trong 250 ms => DUNG 1 scada:delta mang gia tri CUOI", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan, sk } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "temp" }] });
    sk.emit.mockClear();
    for (let i = 1; i <= 20; i++) napTuOt({ adapterId: 10, machineId: 5 }, [mau("temp", i)]);
    expect(nhan("scada:delta")).toEqual([]); // chua den nhip
    vi.advanceTimersByTime(GIOI_HAN.chuKyDeltaMs);
    const d = nhan("scada:delta");
    expect(d).toHaveLength(1);
    expect(d[0].subId).toBe("x");
    expect(d[0].values).toHaveLength(1);
    expect(d[0].values[0][2]).toBe(20);
    vi.advanceTimersByTime(GIOI_HAN.chuKyDeltaMs * 4);
    expect(nhan("scada:delta")).toHaveLength(1); // khong thay doi => khong khung
  });

  it("nhieu tag cung doi => mot khung mang moi tag (moi tag ban moi nhat)", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "a" }, { adapterId: 10, tagKey: "b" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("a", 1), mau("b", 2)]);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("a", 3)]);
    vi.advanceTimersByTime(250);
    const d = nhan("scada:delta");
    expect(d).toHaveLength(1);
    const theoTag = Object.fromEntries(d[0].values.map((v: any[]) => [v[1], v[2]]));
    expect(theoTag).toEqual({ a: 3, b: 2 });
  });

  it("chi tag da dang ky va duoc phep moi vao delta (tag ngoai pham vi / chua dang ky khong lot)", async () => {
    dangKyAdapter(10, 5);
    dangKyAdapter(11, 6);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }, { adapterId: 11, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 555), mau("khac", 1)]);
    napTuOt({ adapterId: 11, machineId: 6 }, [mau("t", 666), mau("khac", 1)]);
    vi.advanceTimersByTime(250);
    const d = nhan("scada:delta");
    expect(d).toHaveLength(1);
    expect(d[0].values.map((v: any[]) => [v[0], v[1], v[2]])).toEqual([[11, "t", 666]]);
  });

  it("adapter doi may sau khi dang ky (may hieu luc luc doc khac may da kiem) => khong gui gia tri", async () => {
    dangKyAdapter(10, 6);
    datPhamVi([6]);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    dangKyAdapter(10, 5); // chuyen sang may 5 (ngoai pham vi)
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 123)]);
    vi.advanceTimersByTime(250);
    expect(nhan("scada:delta")).toEqual([]);
  });

  it("hai subId cua cung socket: moi cai khung rieng", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    vi.advanceTimersByTime(250);
    expect(nhan("scada:delta").map((d: any) => d.subId).sort()).toEqual(["x", "y"]);
  });

  it("socket nay khong nhan khung cua dang ky socket khac", async () => {
    dangKyAdapter(10, 5);
    const a = taoSocket();
    const b = taoSocket();
    await a.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    vi.advanceTimersByTime(250);
    expect(a.nhan("scada:delta")).toHaveLength(1);
    expect(b.sk.emit).not.toHaveBeenCalled();
  });
});

describe("vong day chi chay khi co dang ky", () => {
  it("false luc dau; true sau dang ky dau; false sau huy cai cuoi", async () => {
    dangKyAdapter(10, 5);
    expect(__vongDangChay()).toBe(false);
    const { goi } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(__vongDangChay()).toBe(true);
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:unsubscribe", { subId: "x" });
    expect(__vongDangChay()).toBe(true);
    await goi("scada:unsubscribe", { subId: "y" });
    expect(__vongDangChay()).toBe(false);
  });

  it("unsubscribe bo trong = tat ca", async () => {
    dangKyAdapter(10, 5);
    const { goi, sk } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:subscribe", { subId: "y", tags: [{ adapterId: 10, tagKey: "t" }] });
    await goi("scada:unsubscribe", {});
    expect(sk.data.__scada.subs.size).toBe(0);
    expect(__vongDangChay()).toBe(false);
    await goi("scada:unsubscribe", undefined); // khong nem
  });

  it("socket ngat => xoa dang ky + dung vong khi la cai cuoi; con socket khac => van chay", async () => {
    dangKyAdapter(10, 5);
    const a = taoSocket();
    const b = taoSocket();
    await a.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await b.goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await a.goi("disconnect");
    expect(__vongDangChay()).toBe(true);
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    vi.advanceTimersByTime(250);
    expect(a.nhan("scada:delta")).toEqual([]);
    expect(b.nhan("scada:delta")).toHaveLength(1);
    await b.goi("disconnect");
    expect(__vongDangChay()).toBe(false);
  });

  it("socket ngat GIUA luc kiem quyen => khong tao dang ky, khong mo vong", async () => {
    dangKyAdapter(10, 5);
    let mo!: () => void;
    kiemQuyen.mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          mo = () => r(true);
        }),
    );
    const { goi, nhan } = taoSocket();
    const p = goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    await vi.advanceTimersByTimeAsync(0);
    await goi("disconnect");
    mo();
    await p;
    expect(nhan("scada:snapshot")).toEqual([]);
    expect(__vongDangChay()).toBe(false);
  });

  it("toan tag bi tu choi van la mot dang ky hop le (snapshot); vong chay", async () => {
    datPhamVi([]);
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    expect(nhan("scada:snapshot")).toHaveLength(1);
    expect(__vongDangChay()).toBe(true);
  });

  it("xoaAdapter giua chung khong lam vong vo (khong khung)", async () => {
    dangKyAdapter(10, 5);
    const { goi, nhan } = taoSocket();
    await goi("scada:subscribe", { subId: "x", tags: [{ adapterId: 10, tagKey: "t" }] });
    napTuOt({ adapterId: 10, machineId: 5 }, [mau("t", 1)]);
    xoaAdapter(10);
    vi.advanceTimersByTime(250);
    expect(nhan("scada:delta")).toEqual([]);
  });
});
