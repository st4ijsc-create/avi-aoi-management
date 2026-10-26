/**
 * SCADA R1b-2b-1 Task 9 (mục 44) — `ghiSoCoHan`: một lượt ghi sổ trên đường trả lời của STOP HMI chờ tối đa `HAN_GHI_SO_STOP_HMI_MS`.
 *
 * Điều kiện điều phối C3: lượt ghi bị BỎ RƠI sau 500 ms mà ném MUỘN không được thành `unhandledRejection` (mặc định Node: sập tiến trình) —
 * và lỗi muộn đó phải được `ghiLoiChot` log. Đo bằng `process.on("unhandledRejection")` (gỡ ở afterEach) + spy `logger.error` (thân của
 * `ghiLoiChot`).
 * Fix round 1:
 *   · I1 — trần `TRAN_GHI_SO_TREO_STOP_HMI` lượt bỏ rơi còn treo: đầy ⇒ thunk KHÔNG được gọi, log `<nhan>_bo_qua_day` + nội dung; một lượt
 *     xong ⇒ có chỗ lại. Đột biến bắt buộc: bỏ kiểm trần ⇒ ĐỎ.
 *   · M1 — đồng hồ GIẢ (chỉ setTimeout/clearTimeout/Date; setImmediate thật để Node kịp phát unhandledRejection): thời gian tất định,
 *     không còn cận trên đồng hồ tường.
 *   · M5 — xong muộn ⇒ một dòng info `<nhan>_muon_xong`.
 * Đột biến: bỏ handler lỗi gắn vào promise của lượt ghi ⇒ ca C3 ĐỎ (unhandledRejection + thiếu log lỗi muộn).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../logger";
import { ghiSoCoHan, HAN_GHI_SO_STOP_HMI_MS, soGhiSoTreoStopHmi, TRAN_GHI_SO_TREO_STOP_HMI } from "./lenhHmi";

/** vài vòng sự kiện THẬT (setImmediate không bị giả) — microtask + unhandledRejection của Node kịp chạy */
const nhuong = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};
function hoan<T = void>() {
  let giai!: (v: T) => void;
  let tuChoi!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    giai = a;
    tuChoi = b;
  });
  return { p, giai, tuChoi };
}

let khongXuLy: unknown[] = [];
const nghe = (e: unknown) => void khongXuLy.push(e);
let loiLog: ReturnType<typeof vi.spyOn>;
let infoLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  khongXuLy = [];
  process.on("unhandledRejection", nghe);
  loiLog = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
  infoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
});
afterEach(() => {
  process.off("unhandledRejection", nghe);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** các lần log có nhãn `cho` — [{cho, err, requestId, …}] */
const nhan = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => c[0] as { cho?: string; err?: string; requestId?: string; noiDung?: unknown }).filter((o) => typeof o?.cho === "string");
const nhanLoi = () => nhan(loiLog).map((o) => ({ cho: o.cho, err: o.err, requestId: o.requestId }));

/** đo khi nào promise của ghiSoCoHan xong (theo đồng hồ giả) */
function theoDoi(p: Promise<void>) {
  const o = { xong: false, luc: -1 };
  const t0 = Date.now();
  void p.then(() => {
    o.xong = true;
    o.luc = Date.now() - t0;
  });
  return o;
}

describe("R1b-2b-1 T9 — ghiSoCoHan", () => {
  it("hằng đúng giá trị brief / điều phối", () => {
    expect(HAN_GHI_SO_STOP_HMI_MS).toBe(500);
    expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(8);
  });

  it("xong trong hạn ⇒ trả ĐÚNG lúc xong (30 ms), không chờ hạn; không log; không đếm treo", async () => {
    const v = hoan();
    const o = theoDoi(ghiSoCoHan(() => v.p, "x", "r1"));
    await vi.advanceTimersByTimeAsync(30);
    expect(o.xong).toBe(false);
    v.giai();
    await nhuong();
    expect(o).toEqual({ xong: true, luc: 30 });
    expect(nhanLoi()).toEqual([]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
  });

  it("lỗi trong hạn ⇒ KHÔNG ném, ghiLoiChot(nhãn gốc)", async () => {
    const v = hoan();
    const p = ghiSoCoHan(() => v.p, "attempts_hmi_stop", "r2");
    v.tuChoi(new Error("ECONNRESET giả"));
    await expect(p).resolves.toBeUndefined();
    expect(nhanLoi()).toEqual([{ cho: "attempts_hmi_stop", err: "ECONNRESET giả", requestId: "r2" }]);
  });

  it("thunk ném ĐỒNG BỘ ⇒ KHÔNG ném, ghiLoiChot", async () => {
    await expect(
      ghiSoCoHan(
        () => {
          throw new Error("ném đồng bộ");
        },
        "y",
        "r3",
      ),
    ).resolves.toBeUndefined();
    expect(nhanLoi()).toEqual([{ cho: "y", err: "ném đồng bộ", requestId: "r3" }]);
  });

  it("★ C3: treo ⇒ trả ĐÚNG lúc 500 ms; ném MUỘN lúc 800 ms ⇒ 0 unhandledRejection, log quá hạn + lỗi muộn; đếm treo về 0", async () => {
    const v = hoan();
    const o = theoDoi(ghiSoCoHan(() => v.p, "attempts_hmi_stop_chua_ghim", "-"));
    await vi.advanceTimersByTimeAsync(HAN_GHI_SO_STOP_HMI_MS - 1);
    expect(o.xong).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(o).toEqual({ xong: true, luc: HAN_GHI_SO_STOP_HMI_MS });
    expect(nhanLoi().map((x) => x.cho)).toEqual(["attempts_hmi_stop_chua_ghim_qua_han"]);
    expect(soGhiSoTreoStopHmi()).toBe(1);

    await vi.advanceTimersByTimeAsync(300); // mốc 800 ms
    v.tuChoi(new Error("ghi muộn hỏng"));
    await nhuong(5);
    expect(khongXuLy).toEqual([]);
    expect(nhanLoi()).toEqual([
      expect.objectContaining({ cho: "attempts_hmi_stop_chua_ghim_qua_han" }),
      { cho: "attempts_hmi_stop_chua_ghim_muon", err: "ghi muộn hỏng", requestId: "-" },
    ]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
  });

  it("M5: xong MUỘN (thành công sau hạn) ⇒ đúng một dòng info `<nhan>_muon_xong`; đếm treo về 0", async () => {
    const v = hoan();
    await (async () => {
      const p = ghiSoCoHan(() => v.p, "hmi_stop_sau_dispatch", "r4");
      await vi.advanceTimersByTimeAsync(HAN_GHI_SO_STOP_HMI_MS);
      await p;
    })();
    expect(soGhiSoTreoStopHmi()).toBe(1);
    v.giai();
    await nhuong();
    expect(nhan(infoLog).map((o) => [o.cho, o.requestId])).toEqual([["hmi_stop_sau_dispatch_muon_xong", "r4"]]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
    expect(khongXuLy).toEqual([]);
  });
});

describe("★ R1b-2b-1 T9 fix round 1 (I1) — trần lượt ghi sổ treo", () => {
  it("đủ trần lượt bỏ rơi còn treo ⇒ thunk kế KHÔNG được gọi, log `_bo_qua_day` + nội dung dòng, trả NGAY; một lượt xong ⇒ thunk kế được gọi lại", async () => {
    const treo = Array.from({ length: TRAN_GHI_SO_TREO_STOP_HMI }, () => hoan());
    const goi: number[] = [];
    // TRAN lượt treo, mỗi lượt quá hạn ⇒ bỏ rơi (đếm treo tăng dần)
    for (let i = 0; i < treo.length; i++) {
      const p = ghiSoCoHan(
        () => {
          goi.push(i);
          return treo[i].p;
        },
        "attempts_hmi_stop",
        `t${i}`,
      );
      await vi.advanceTimersByTimeAsync(HAN_GHI_SO_STOP_HMI_MS);
      await p;
    }
    expect(goi).toHaveLength(TRAN_GHI_SO_TREO_STOP_HMI);
    expect(soGhiSoTreoStopHmi()).toBe(TRAN_GHI_SO_TREO_STOP_HMI);

    // đầy ⇒ không phát truy vấn, không chờ 500 ms
    const thunkDay = vi.fn(() => new Promise<never>(() => undefined));
    const noiDung = { bang: "scada_command_attempts", reasonCode: "CHUA_GHIM_STOP", adapterId: 7, commandLogIds: [11, 12] };
    const o = theoDoi(ghiSoCoHan(thunkDay, "attempts_hmi_stop_chua_ghim", "-", noiDung));
    await nhuong();
    expect(o).toEqual({ xong: true, luc: 0 });
    expect(thunkDay).not.toHaveBeenCalled();
    const boQua = nhan(loiLog).filter((x) => x.cho === "attempts_hmi_stop_chua_ghim_bo_qua_day");
    expect(boQua).toHaveLength(1);
    expect(boQua[0].noiDung).toEqual(noiDung);
    expect(soGhiSoTreoStopHmi()).toBe(TRAN_GHI_SO_TREO_STOP_HMI);

    // một lượt treo xong (muộn) ⇒ có chỗ ⇒ thunk kế ĐƯỢC gọi
    treo[0].giai();
    await nhuong();
    expect(soGhiSoTreoStopHmi()).toBe(TRAN_GHI_SO_TREO_STOP_HMI - 1);
    const thunkSau = vi.fn(async () => undefined);
    await ghiSoCoHan(thunkSau, "attempts_hmi_stop", "sau");
    expect(thunkSau).toHaveBeenCalledTimes(1);

    // dọn: mọi lượt treo xong ⇒ đếm về 0 (trạng thái mô-đun sạch cho ca khác)
    for (const t of treo.slice(1)) t.giai();
    await nhuong();
    expect(soGhiSoTreoStopHmi()).toBe(0);
  });

  it("DB nhanh không bao giờ bị bỏ qua: 3 × TRAN lượt xong trong hạn liên tiếp ⇒ mọi thunk được gọi, 0 log", async () => {
    let n = 0;
    for (let i = 0; i < 3 * TRAN_GHI_SO_TREO_STOP_HMI; i++) {
      await ghiSoCoHan(async () => void n++, "attempts_hmi_stop", `n${i}`);
    }
    expect(n).toBe(3 * TRAN_GHI_SO_TREO_STOP_HMI);
    expect(nhanLoi()).toEqual([]);
    expect(soGhiSoTreoStopHmi()).toBe(0);
  });
});
