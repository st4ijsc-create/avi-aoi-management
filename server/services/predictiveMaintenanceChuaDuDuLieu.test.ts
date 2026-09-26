/**
 * PH-39 — "Failure risk 0 %" là GIÁ TRỊ MẶC ĐỊNH, không phải phép đo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC (QA tập đoàn 2026-09-15, V-21 mục 2 + ảnh `DE-D1-kythuat.png`)
 * ════════════════════════════════════════════════════════════════════════════
 * Màn máy in "Failure risk **0 %**" ngay cạnh chip "Health 40 % · **critical**".
 * Truy nguyên: `computeFailureRisk` chỉ nhận hàng sức khoẻ KHÔNG phải loại
 * `PREDICTIVE_WS4` (`PDM_CALC_METHOD`), mà cơ sở dữ liệu có **đúng một điểm mỗi
 * máy** ⇒ `healthSeries.length = 1 < MIN_HEALTH_POINTS (5)`, không cảm biến,
 * không sự cố ⇒ **không đặc trưng nào đóng góp trọng số** (`weightSum === 0`).
 *
 * Dòng gây lỗi (nguyên văn, trước bản vá):
 *     const failureRisk = weightSum > 0 ? clamp(weightedRisk / weightSum) : 0;
 *
 * `0` ở đó KHÔNG phải "đã tính, và nguy cơ bằng không" — nó là "chưa tính được
 * gì cả". Chính `rulNote` của cùng kết quả ghi "cold start", tức hàm **biết** là
 * chưa đủ dữ liệu, nhưng nó trả ra một con số trông y như một phép đo, rồi màn
 * in con số ấy ra. Cùng lớp lỗi với "Cảnh báo (0)" (`trungThucDuLieu.ts:387` —
 * 403 rơi về `[]` rồi in `0`): NÓI **KHÔNG** KHI NGHĨA LÀ **CHƯA BIẾT**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ
 * ════════════════════════════════════════════════════════════════════════════
 * `computeFailureRiskFromInputs` là hàm THUẦN (không DB, không đồng hồ ẩn), nên
 * đo được cả ba trạng thái tất định ngay tại nguồn:
 *
 *   1. ĐỐI CHỨNG DƯƠNG — đủ dữ liệu ⇒ `riskMethod = "measured"` và `failureRisk`
 *      là số THẬT > 0. Ca này phải BIẾT KÊU: nếu bản vá lỡ dán nhãn
 *      "insufficient_data" cho mọi máy thì nó đỏ ngay.
 *   2. CA LỖI — đúng một điểm sức khoẻ (hình dạng dữ liệu THẬT của DB đang đo)
 *      ⇒ `riskMethod = "insufficient_data"`, KHÔNG được là "measured".
 *   3. Ranh giới `MIN_HEALTH_POINTS` — 4 điểm vẫn chưa đủ, 5 điểm thì đủ.
 *
 * ⚠ TẬP RỖNG LÀ HỎNG: mỗi ca tự khẳng định kích thước chuỗi đầu vào trước khi
 *   khẳng định kết cục, nên không ca nào "xanh" nhờ đọc phải mảng rỗng.
 */
import { describe, expect, it } from "vitest";
import {
  computeFailureRiskFromInputs,
  type ReliabilityStats,
  type RiskInputs,
} from "./predictiveMaintenanceService";
import type { TimeSeriesPoint } from "./aiTimeSeriesEngine";

const GIO = 3_600_000;
const MOC = Date.UTC(2026, 8, 15, 0, 0, 0);

/** Chuỗi sức khoẻ giảm dần đều — `n` điểm, mỗi điểm cách nhau 1 giờ. */
function chuoiSucKhoe(n: number, batDau = 90, buoc = -3): TimeSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: MOC + i * GIO,
    value: batDau + i * buoc,
  }));
}

/** Độ tin cậy của một máy CHƯA TỪNG có sự cố ngoài kế hoạch (MTBF không tính được). */
const KHONG_SU_CO: ReliabilityStats = {
  machineId: 1,
  windowHours: 24 * 14,
  unplannedEvents: 0,
  totalUnplannedMinutes: 0,
  uptimeMinutes: 0,
  mtbfHours: null,
  mttrHours: null,
  failuresPerDay: 0,
  trend: "stable",
};

function dauVao(p: Partial<RiskInputs> = {}): RiskInputs {
  return {
    machineId: 1,
    reliability: KHONG_SU_CO,
    healthSeries: [],
    heartbeatSeries: [],
    tempSeries: [],
    uptimeSinceLastHours: null,
    ...p,
  };
}

describe("PH-39 — computeFailureRiskFromInputs phân biệt ĐO ĐƯỢC với CHƯA ĐỦ DỮ LIỆU", () => {
  it("★★★ ĐỐI CHỨNG DƯƠNG — đủ điểm sức khoẻ ⇒ riskMethod 'measured' và số THẬT", () => {
    const healthSeries = chuoiSucKhoe(12);
    // Tập rỗng là HỎNG: khẳng định dữ kiện nền TRƯỚC khi khẳng định kết cục.
    expect(healthSeries).toHaveLength(12);
    expect(healthSeries[11].value).toBeLessThan(healthSeries[0].value);

    const r = computeFailureRiskFromInputs(dauVao({ healthSeries }));

    expect(r.riskMethod).toBe("measured");
    expect(r.failureRisk).toBeGreaterThan(0);
    expect(r.factors.some((f) => f.name === "trend")).toBe(true);
  });

  it("★★★ CA LỖI (hình dạng DB đang đo) — ĐÚNG MỘT điểm sức khoẻ ⇒ 'insufficient_data', KHÔNG phải 'measured'", () => {
    const healthSeries = chuoiSucKhoe(1);
    expect(healthSeries).toHaveLength(1);

    const r = computeFailureRiskFromInputs(dauVao({ healthSeries }));

    expect(r.riskMethod).toBe("insufficient_data");
    // Đây là ô mà màn đã in "0 %": giá trị vẫn tồn tại nhưng KHÔNG được coi là
    // phép đo. Nhãn `riskMethod` là thứ duy nhất tách hai nghĩa của số 0.
    expect(r.factors.filter((f) => f.contribution > 0)).toHaveLength(0);
  });

  it("KHÔNG có gì cả (0 điểm) ⇒ cũng là 'insufficient_data'", () => {
    const r = computeFailureRiskFromInputs(dauVao());
    expect(r.riskMethod).toBe("insufficient_data");
    expect(r.dataPoints).toBe(0);
  });

  it("ranh giới MIN_HEALTH_POINTS — 4 điểm CHƯA đủ, 5 điểm thì ĐỦ (hai kết cục khác nhau trên cùng một hình dạng)", () => {
    const bon = computeFailureRiskFromInputs(dauVao({ healthSeries: chuoiSucKhoe(4) }));
    const nam = computeFailureRiskFromInputs(dauVao({ healthSeries: chuoiSucKhoe(5) }));
    expect(bon.riskMethod).toBe("insufficient_data");
    expect(nam.riskMethod).toBe("measured");
  });

  it("chỉ có độ tin cậy (MTBF + uptime), 0 điểm sức khoẻ ⇒ VẪN là phép đo — 'measured'", () => {
    const reliability: ReliabilityStats = {
      ...KHONG_SU_CO,
      unplannedEvents: 3,
      totalUnplannedMinutes: 180,
      uptimeMinutes: 6000,
      mtbfHours: 33.3,
      mttrHours: 1,
      failuresPerDay: 0.2,
    };
    const r = computeFailureRiskFromInputs(
      dauVao({ reliability, uptimeSinceLastHours: 40 }),
    );
    expect(r.riskMethod).toBe("measured");
    expect(r.factors.some((f) => f.name === "reliability")).toBe(true);
  });

  it("máy KHOẺ có đủ dữ liệu vẫn 'measured' dù rủi ro thấp — 0 đo được KHÁC 0 mặc định", () => {
    // Sức khoẻ đi LÊN đều ⇒ rủi ro xu hướng bị kẹp về 0, nhưng đặc trưng CÓ chạy.
    const healthSeries = chuoiSucKhoe(10, 60, +3);
    expect(healthSeries).toHaveLength(10);
    const r = computeFailureRiskFromInputs(dauVao({ healthSeries }));
    expect(r.riskMethod).toBe("measured");
    expect(r.failureRisk).toBe(0);
  });
});
