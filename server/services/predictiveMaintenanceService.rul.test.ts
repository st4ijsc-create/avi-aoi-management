/**
 * Sprint 5 §5 (backlog E1) — chặn `predictedTimeframeHours` / `recommendedMaintenanceDate`
 * không hữu hạn NGAY TẠI NGUỒN phát sinh (`computeFailureRiskFromInputs`), không chỉ ở
 * CỔNG PHÁT cảnh báo (B1 — xem `classifySuppression.ts` +
 * `classifySuppression.equivalence.test.ts`). B1 chỉ ngăn KHÔNG PHÁT CẢNH BÁO khi
 * `predictedTimeframeHours` không hữu hạn; nó KHÔNG ngăn giá trị đó được tính ra và
 * ghi xuống DB qua `recordMachineHealthSnapshot` (gọi vô điều kiện, TRƯỚC bước lọc
 * cảnh báo — xem predictiveMaintenanceService.ts quanh dòng 788: snapshot được ghi
 * rồi mới tới `classifySuppression`).
 *
 * ĐO TRƯỚC KHI SỬA (bước 1, chi tiết đầy đủ ở task-1-report.md) — rà toàn bộ phép
 * chia/toán tử trong đường ước lượng RUL (:353-541). Kết luận thực nghiệm (chạy thử
 * từng ca, không chỉ suy luận tĩnh):
 *
 *   ĐƯỜNG RÒ THẬT DUY NHẤT: `Math.min(timeframeHours, reliability.mtbfHours)`
 *   (nhánh "Cap timeframe by MTBF"). `reliability.mtbfHours` có kiểu `number | null`
 *   — KHÔNG có gì đảm bảo hữu hạn khi hàm thuần `computeFailureRiskFromInputs` được
 *   gọi trực tiếp (test, hoặc caller tương lai) với dữ liệu ngược dòng hỏng. Nếu
 *   mtbfHours = -Infinity (giá trị "truthy" nên lọt qua `reliability?.mtbfHours`),
 *   Math.min KHÔNG kẹp nó như Math.max(0, x) vẫn làm — kết quả là -Infinity NGUYÊN
 *   VẸN, rồi Math.round(-Infinity) === -Infinity và new Date(Date.now() + (-Infinity))
 *   là Invalid Date.
 *
 *   QUYẾT ĐỊNH THIẾT KẾ (lệch so với suy đoán ban đầu của brief — ghi lại có chủ ý,
 *   không phải "sửa test cho vừa"): bản vá SKIP hẳn bước áp trần MTBF khi mtbfHours
 *   không hữu hạn, thay vì tính ra -Infinity rồi mới null-hoá. Hệ quả: giá trị ước
 *   lượng gốc từ forecast xu hướng sức khoẻ (finite, hợp lệ) được GIỮ NGUYÊN, không
 *   phải null. Lý do: bước "Cap timeframe by MTBF" luôn chỉ chạy khi `timeframeHours
 *   != null` (đã có một ước lượng hữu hạn hợp lệ từ forecast) — dữ liệu MTBF hỏng chỉ
 *   nên loại bỏ CHÍNH bước áp trần đó, không nên xoá luôn ước lượng hợp lệ đến từ một
 *   tín hiệu khác (xu hướng sức khoẻ). Null hoá toàn bộ trong trường hợp này sẽ ÂM
 *   THẦM CHẶN một cảnh báo có căn cứ thật (máy đang xuống sức khoẻ rõ) chỉ vì một
 *   trường KHÔNG liên quan (MTBF) bị hỏng — phản tác dụng với đúng mục tiêu của tính
 *   năng PdM. Vẫn giữ guard "null hoá + hạ rulMethod" tại điểm hội tụ cuối (trước khi
 *   dùng cho Math.round/new Date) làm lưới an toàn cho MỌI đường khác (kể cả đường
 *   chưa biết trong tương lai) — nhưng trong ca rò được duy nhất này, guard tại đúng
 *   phép tính (bỏ qua trần hỏng) là bản vá CHỦ ĐẠO, lưới an toàn ở cuối không bị kích
 *   hoạt (không có gì không hữu hạn để bắt).
 *
 *   CÁC NGHI VẤN KHÁC ĐÃ ĐO — KHÔNG rò được qua computeFailureRiskFromInputs (không
 *   đưa vào test đỏ vì không tái tạo được lỗi thật, tránh "sửa test cho vừa"):
 *   - `reliability.mtbfHours = NaN` ở CÙNG chỗ Math.min: `NaN` là falsy trong JS nên
 *     `reliability?.mtbfHours` (truthy-check) đã lọc NaN ra TRƯỚC khi chạm Math.min —
 *     timeframeHours giữ nguyên giá trị hữu hạn từ forecast, không rò gì (đã an toàn
 *     từ trước khi có bản vá này — xem test đặc tả bên dưới).
 *   - Timestamp hỏng (NaN) trong healthSeries: avgIntervalMs/horizonSteps suy ra từ
 *     CÙNG timestamp đầu/cuối nên cũng thành NaN trước — ewmaForecast(data, 0.3, NaN)
 *     có vòng lặp `h <= horizon` không bao giờ đúng với horizon=NaN → forecast rỗng
 *     → timeframeHours ở lại null (an toàn, nhưng là hiệu ứng phụ tình cờ chứ không
 *     phải guard tường minh — đã thêm Number.isFinite ở đúng chỗ (Math.max(0, ...) tại
 *     dòng phát hiện forecast cắt ngưỡng) để không phụ thuộc vào hiệu ứng phụ đó).
 *   - Nhánh fallback MTBF (dòng ~490, "trend gave no timeframe"): không chạm tới được
 *     với toán hạng không hữu hạn vì `riskReliability` (dùng CÙNG hai biến ở hazard
 *     phía trên) đã bị `clamp()` về 0 khi hazard không hữu hạn, nên điều kiện
 *     `riskReliability >= 60` luôn sai trong trường hợp đó.
 *   - `rul.rulHours` (override Weibull): đã có sẵn `Number.isFinite(rul.rulHours)`
 *     tường minh trong mã gốc — an toàn từ trước, không phải lỗi.
 *
 * Vẫn giữ Number.isFinite ở TẤT CẢ các điểm trên (không chỉ điểm rò được) vì đây là
 * hàm export công khai — hợp đồng kiểu (`number | null`) không đảm bảo hữu hạn, và
 * "an toàn nhờ hiệu ứng phụ ở chỗ khác" là giòn (dễ vỡ khi công thức khác đổi).
 */
import { describe, it, expect } from "vitest";
import { computeFailureRiskFromInputs, type RiskInputs } from "./predictiveMaintenanceService";
import type { TimeSeriesPoint } from "./aiTimeSeriesEngine";

function series(values: number[], stepMs = 3600_000): TimeSeriesPoint[] {
  const start = Date.now() - values.length * stepMs;
  return values.map((v, i) => ({ timestamp: start + i * stepMs, value: v }));
}

describe("computeFailureRiskFromInputs — chặn giá trị không hữu hạn tại NGUỒN (Sprint 5 §5, backlog E1)", () => {
  it("reliability.mtbfHours = -Infinity (dữ liệu ngược dòng hỏng) không được rò -Infinity/NaN xuống predictedTimeframeHours/recommendedMaintenanceDate/rulHours — bỏ qua trần hỏng, GIỮ ước lượng forecast hợp lệ", () => {
    // Dốc xuống rõ (giống test 'declining' đã có trong predictiveMaintenanceService.test.ts)
    // để forecast EWMA chắc chắn cắt ngưỡng nguy hiểm (40) trong horizon, khiến
    // `timeframeHours` được gán một giá trị hữu hạn TRƯỚC KHI (không) bị Math.min ép bởi MTBF.
    const declining = series([95, 88, 80, 70, 58, 48, 42, 38, 34, 30]);

    const inputs: RiskInputs = {
      machineId: 99,
      reliability: {
        machineId: 99, windowHours: 24 * 14, unplannedEvents: 5, totalUnplannedMinutes: 150,
        uptimeMinutes: 6000, mtbfHours: -Infinity, mttrHours: 0.5, failuresPerDay: 0.4, trend: "increasing",
      },
      healthSeries: declining,
      heartbeatSeries: [],
      tempSeries: [],
      uptimeSinceLastHours: 18,
    };

    const r = computeFailureRiskFromInputs(inputs);

    // Đo trước khi sửa: nếu bản vá chưa có, predictedTimeframeHours === -Infinity ở đây
    // (đã xác nhận ĐỎ — xem task-1-report.md).
    expect(r.predictedTimeframeHours).not.toBe(-Infinity);
    expect(r.rulHours).not.toBe(-Infinity);
    // Sau bản vá: trần MTBF hỏng bị BỎ QUA (không áp dụng), KHÔNG null hoá cả ước
    // lượng — vì ước lượng forecast (dấu hiệu xu hướng sức khoẻ, độc lập với MTBF)
    // vẫn hữu hạn và hợp lệ. Xem "QUYẾT ĐỊNH THIẾT KẾ" ở header.
    expect(r.predictedTimeframeHours).not.toBeNull();
    expect(Number.isFinite(r.predictedTimeframeHours as number)).toBe(true);
    expect(r.rulHours).not.toBeNull();
    expect(Number.isFinite(r.rulHours as number)).toBe(true);
    expect(r.recommendedMaintenanceDate).not.toBeNull();
    expect(Number.isNaN((r.recommendedMaintenanceDate as Date).getTime())).toBe(false);
    // rulMethod trung thực: vẫn 'heuristic' (không có override Weibull trong test này,
    // và ước lượng heuristic vẫn dùng được) — KHÔNG bị hạ xuống 'insufficient_data' oan
    // uổng chỉ vì một trường không liên quan (MTBF) bị hỏng.
    expect(r.rulMethod).toBe("heuristic");
  });

  it("reliability.mtbfHours = NaN — đã an toàn từ trước (JS coi NaN là falsy nên bị lọc trước Math.min); khoá lại hành vi đúng bằng test đặc tả", () => {
    // KHÔNG phải test đỏ — đây là test đặc tả (characterization) khoá hành vi ĐÚNG đã
    // đo được ở bước 1 (xem header), để không ai "sửa nhầm" thành lọc bỏ luôn giá trị
    // dự báo hữu hạn hợp lệ khi mtbfHours tình cờ là NaN.
    const declining = series([95, 88, 80, 70, 58, 48, 42, 38, 34, 30]);

    const inputs: RiskInputs = {
      machineId: 97,
      reliability: {
        machineId: 97, windowHours: 24 * 14, unplannedEvents: 5, totalUnplannedMinutes: 150,
        uptimeMinutes: 6000, mtbfHours: NaN, mttrHours: 0.5, failuresPerDay: 0.4, trend: "increasing",
      },
      healthSeries: declining,
      heartbeatSeries: [],
      tempSeries: [],
      uptimeSinceLastHours: 18,
    };

    const r = computeFailureRiskFromInputs(inputs);

    // Giá trị dự báo hữu hạn từ forecast vẫn được giữ nguyên (không bị NaN nuốt mất
    // và cũng không bị null hoá oan uổng).
    expect(r.predictedTimeframeHours).not.toBeNull();
    expect(Number.isFinite(r.predictedTimeframeHours as number)).toBe(true);
    expect(r.recommendedMaintenanceDate).not.toBeNull();
    expect(Number.isNaN((r.recommendedMaintenanceDate as Date).getTime())).toBe(false);
  });

  it("healthSeries có timestamp hỏng (NaN, vd. new Date(chuỗi-hỏng).getTime()) không bao giờ tạo ra predictedTimeframeHours/recommendedMaintenanceDate không hữu hạn", () => {
    const declining = series([95, 88, 80, 70, 58, 48, 42, 38, 34, 30]);
    declining[declining.length - 1] = { ...declining[declining.length - 1], timestamp: NaN };

    const inputs: RiskInputs = {
      machineId: 96,
      reliability: null,
      healthSeries: declining,
      heartbeatSeries: [],
      tempSeries: [],
      uptimeSinceLastHours: null,
    };

    const r = computeFailureRiskFromInputs(inputs);

    expect(r.predictedTimeframeHours === null || Number.isFinite(r.predictedTimeframeHours as number)).toBe(true);
    expect(
      r.recommendedMaintenanceDate === null || !Number.isNaN((r.recommendedMaintenanceDate as Date).getTime()),
    ).toBe(true);
  });
});
