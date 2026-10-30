/**
 * SCADA R1b-2b-2a T3 fix round 1 (kiem-dinh M-4) — MỘT helper kẹp hạn lệnh OT (`OT_CONTROL_TIMEOUT_MS`) và các biến OT_*_MS đi vào `setTimeout`.
 *
 * Lỗi trước đây: `Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000` ở BA nơi đọc độc lập (dispatcher · trần chờ nối lại EIP · bộ hẹn dự phòng S7)
 * + hai nơi nữa (otEdgeDispatch, chuyển chủ robot). "Infinity" / "1e12" / > 2^31−1 ⇒ `setTimeout` tràn ⇒ hẹn 1 ms ⇒ MỌI lời ghi S7 "không rõ" + hạ phiên,
 * dispatcher hết hạn ngay; "-5" ⇒ hẹn âm (= ngay). otManager (`intEnv` = parseInt) cùng lỗi với giá trị > 2^31−1 (hạn khởi động adapter, chu kỳ
 * nối lại, backoff HA, chu kỳ health).
 * Hợp lệ: `Number.isFinite`, > 0, ≤ TRAN_HEN_GIO_MS (= 2^31−1 − 10 000: đủ lề cho mọi phép cộng hạn +1500 S7, +1000 B3 …). Không hợp lệ ⇒ mặc định +
 * cảnh báo MỘT LẦN mỗi (biến, giá trị).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { __datLaiCanhBaoHanMsChoTest, hanLenhOtMacDinhMs, hanMsTuEnv, HAN_LENH_OT_MAC_DINH_MS, TRAN_HEN_GIO_MS } from "./hanLenhOt";

const canhBaoCua = (spy: ReturnType<typeof vi.spyOn>, ten: string) => spy.mock.calls.filter((c) => String(c[0]).includes(ten));

describe("T3 fix 1 (M-4) — hanLenhOtMacDinhMs / hanMsTuEnv", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    __datLaiCanhBaoHanMsChoTest();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("hằng: mặc định 5000; trần = 2^31−1 − 10 000 (mọi phép cộng hạn dẫn xuất vẫn ≤ 2^31−1)", () => {
    expect(HAN_LENH_OT_MAC_DINH_MS).toBe(5000);
    expect(TRAN_HEN_GIO_MS).toBe(2_147_483_647 - 10_000);
  });

  for (const xau of ["Infinity", "-Infinity", "NaN", "-5", "abc", "0", "3000000000", "1e12", String(TRAN_HEN_GIO_MS + 1)]) {
    it(`"${xau}" ⇒ 5000 + ĐÚNG MỘT cảnh báo (gọi 3 lần)`, () => {
      vi.stubEnv("OT_CONTROL_TIMEOUT_MS", xau);
      expect(hanLenhOtMacDinhMs()).toBe(5000);
      expect(hanLenhOtMacDinhMs()).toBe(5000);
      expect(hanLenhOtMacDinhMs()).toBe(5000);
      const cb = canhBaoCua(warn, "OT_CONTROL_TIMEOUT_MS");
      expect(cb).toHaveLength(1);
      expect(String(cb[0]![0])).toContain(JSON.stringify(xau));
    });
  }

  it('"8000" ⇒ 8000, không cảnh báo; biên trần đúng TRAN_HEN_GIO_MS ⇒ chính nó; chưa đặt / rỗng ⇒ 5000 im lặng', () => {
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "8000");
    expect(hanLenhOtMacDinhMs()).toBe(8000);
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", String(TRAN_HEN_GIO_MS));
    expect(hanLenhOtMacDinhMs()).toBe(TRAN_HEN_GIO_MS);
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "");
    expect(hanLenhOtMacDinhMs()).toBe(5000);
    delete process.env.OT_CONTROL_TIMEOUT_MS; // vi.unstubAllEnvs() khôi phục
    expect(process.env.OT_CONTROL_TIMEOUT_MS).toBeUndefined();
    expect(hanLenhOtMacDinhMs()).toBe(5000);
    expect(canhBaoCua(warn, "OT_CONTROL_TIMEOUT_MS")).toHaveLength(0);
  });

  it("cảnh báo MỘT LẦN mỗi giá trị lỗi: hai giá trị lỗi khác nhau ⇒ hai cảnh báo; quay lại giá trị cũ ⇒ không thêm", () => {
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "Infinity");
    hanLenhOtMacDinhMs();
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "-5");
    hanLenhOtMacDinhMs();
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "Infinity");
    hanLenhOtMacDinhMs();
    expect(canhBaoCua(warn, "OT_CONTROL_TIMEOUT_MS")).toHaveLength(2);
  });

  it("hanMsTuEnv tổng quát: mặc định theo tham số; cùng luật (finite, > 0, ≤ trần); cảnh báo theo (biến, giá trị)", () => {
    vi.stubEnv("OT_THU_HAN_X_MS", "3000000000");
    expect(hanMsTuEnv("OT_THU_HAN_X_MS", 1234)).toBe(1234);
    expect(hanMsTuEnv("OT_THU_HAN_X_MS", 1234)).toBe(1234);
    vi.stubEnv("OT_THU_HAN_X_MS", "750");
    expect(hanMsTuEnv("OT_THU_HAN_X_MS", 1234)).toBe(750);
    vi.stubEnv("OT_THU_HAN_Y_MS", "3000000000");
    expect(hanMsTuEnv("OT_THU_HAN_Y_MS", 99)).toBe(99);
    expect(canhBaoCua(warn, "OT_THU_HAN_X_MS")).toHaveLength(1);
    expect(canhBaoCua(warn, "OT_THU_HAN_Y_MS")).toHaveLength(1);
  });

  it("các nơi đọc dùng helper: dispatcher (ackTimeoutMacDinhMs) · bộ hẹn dự phòng S7 · hạn khởi động adapter (otManager) với giá trị tràn ⇒ mặc định", async () => {
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "Infinity");
    const { ackTimeoutMacDinhMs } = await import("./commandDispatcher");
    const { hanDuPhongGhiS7Ms } = await import("./drivers/s7Driver");
    expect(ackTimeoutMacDinhMs()).toBe(5000);
    expect(hanDuPhongGhiS7Ms()).toBe(6500);
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "8000");
    expect(ackTimeoutMacDinhMs()).toBe(8000);
    expect(hanDuPhongGhiS7Ms()).toBe(9500);
    const { adapterStartTimeoutMs, DEFAULT_OT_ADAPTER_START_TIMEOUT_MS } = await import("./otManager");
    vi.stubEnv("OT_ADAPTER_START_TIMEOUT_MS", "3000000000");
    expect(adapterStartTimeoutMs()).toBe(DEFAULT_OT_ADAPTER_START_TIMEOUT_MS);
    vi.stubEnv("OT_ADAPTER_START_TIMEOUT_MS", "1500");
    expect(adapterStartTimeoutMs()).toBe(1500);
  });
});

// ─── census: không nơi nào trong server/ (trừ test / harness `__*.ts` / helper) đọc thẳng các biến hạn đã kẹp ─────────────────────────────
const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const HELPER = "server/services/ot/hanLenhOt.ts";
/** Biến OT_*_MS đi vào setTimeout / setInterval, nay CHỈ đọc qua `hanMsTuEnv` / `hanLenhOtMacDinhMs`. */
const BIEN_DA_KEP = ["OT_CONTROL_TIMEOUT_MS", "OT_ADAPTER_START_TIMEOUT_MS", "OT_LEGACY_RECONNECT_MS", "OT_CONN_HA_BACKOFF_MS", "OT_CONN_HA_BACKOFF_MAX_MS", "OT_CONN_HA_HEALTH_INTERVAL_MS"];

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx|mjs|js)$/.test(ten) && !/\.test\.(ts|tsx|mjs|js)$/.test(ten) && !ten.endsWith(".d.ts") && !ten.startsWith("__")) ra.push(p);
  }
  return ra;
}

/** `process.env.X`, `process.env["X"]`, `process.env['X']`, `` process.env[`X`] ``, `env.X` qua destructure `{ X } = process.env`. */
function docThang(vanBan: string, bien: string): string[] {
  const ra: string[] = [];
  const re = new RegExp(`process\\.env(?:\\.${bien}\\b|\\[\\s*["'\`]${bien}["'\`]\\s*\\])`, "g");
  for (const m of vanBan.matchAll(re)) ra.push(m[0]);
  const reDes = new RegExp(`\\{[^}]*\\b${bien}\\b[^}]*\\}\\s*=\\s*process\\.env\\b`, "g");
  for (const m of vanBan.matchAll(reDes)) ra.push(m[0].slice(0, 80));
  return ra;
}

describe("T3 fix 1 (M-4) — census: biến hạn đã kẹp CHỈ đọc qua helper", () => {
  it("bộ dò bắt đủ các dạng đọc (không rỗng giả)", () => {
    for (const s of ["process.env.OT_CONTROL_TIMEOUT_MS", 'process.env["OT_CONTROL_TIMEOUT_MS"]', "process.env['OT_CONTROL_TIMEOUT_MS']", "process.env[`OT_CONTROL_TIMEOUT_MS`]", "const { OT_CONTROL_TIMEOUT_MS } = process.env"]) {
      expect(docThang(s, "OT_CONTROL_TIMEOUT_MS"), s).toHaveLength(1);
    }
    expect(docThang("process.env.OT_CONTROL_TIMEOUT_MAX_MS", "OT_CONTROL_TIMEOUT_MS")).toHaveLength(0);
    expect(docThang("process.env.ROBOT_CONTROL_TIMEOUT_MS", "OT_CONTROL_TIMEOUT_MS")).toHaveLength(0);
  });

  it("server/** (trừ test / __*.ts / helper): 0 nơi đọc thẳng", () => {
    const tep = moiTep(join(GOC, "server"));
    expect(tep.length).toBeGreaterThan(500);
    expect(tep.map(rel)).toContain(HELPER);
    const vi_pham: string[] = [];
    for (const p of tep) {
      if (rel(p) === HELPER) continue;
      const vb = readFileSync(p, "utf8");
      for (const b of BIEN_DA_KEP) for (const x of docThang(vb, b)) vi_pham.push(`${rel(p)}: ${x}`);
    }
    expect(vi_pham).toEqual([]);
  });

  it("các nơi đọc đã biết THẬT SỰ gọi helper (census không xanh vì tệp bị đổi tên / xoá nơi đọc)", () => {
    const doc = (r: string) => readFileSync(join(GOC, r), "utf8");
    expect(doc("server/services/ot/commandDispatcher.ts")).toMatch(/hanLenhOtMacDinhMs\(\)/);
    expect(doc("server/services/ot/otEdgeDispatch.ts")).toMatch(/hanLenhOtMacDinhMs\(\)/);
    expect(doc("server/services/ot/drivers/s7Driver.ts")).toMatch(/hanLenhOtMacDinhMs\(\)/);
    expect(doc("server/services/ot/drivers/ethernetIpDriver.ts")).toMatch(/hanLenhOtMacDinhMs\(\)/);
    expect(doc("server/services/robot/deviceOwnershipService.ts")).toMatch(/hanLenhOtMacDinhMs\(\)/);
    const mgr = doc("server/services/ot/otManager.ts");
    for (const b of BIEN_DA_KEP.slice(1)) expect(mgr, b).toMatch(new RegExp(`hanMsTuEnv\\(\\s*"${b}"`));
  });
});
