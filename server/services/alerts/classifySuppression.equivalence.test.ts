/**
 * Sprint 5 §5 (backlog B1) — `classifySuppression` và biểu thức phát cảnh báo ở
 * predictiveMaintenanceService là HAI BẢN SAO logic mà KHÔNG test nào so khớp.
 * Đổi ngưỡng ở một nơi thì SỐ ĐẾM nói dối mà không ai biết — mà độ tin của số
 * đếm chính là toàn bộ giá trị của tính năng đó (Wave 4 vừa dùng chính số này
 * để kết luận "độ tin cậy mới là ràng buộc thật, không phải rủi ro").
 *
 * Test này dựng lại biểu thức phát NGUYÊN VĂN như nó đang nằm trong
 * predictiveMaintenanceService.ts:832-837 rồi quét toàn bộ tổ hợp giá trị biên.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classifySuppression, type SuppressionThresholds } from "./classifySuppression";

const th: SuppressionThresholds = { risk: 60, confidence: 50, timeframeHours: 168 };

/** Ngữ nghĩa MONG MUỐN của "được phát", viết độc lập với classifySuppression.
 *  Bản gốc trong predictiveMaintenanceService thiếu đúng `Number.isFinite` —
 *  nên `-Infinity` lọt qua `hours <= T` và được PHÁT trong khi bị ĐẾM là đã
 *  chặn. Giữ hàm này tách rời để bảng chân lý còn chỗ đối chiếu. */
function shouldEmit(r: {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null;
}): boolean {
  const h = r.predictedTimeframeHours;
  const timeframeOk = h != null && Number.isFinite(h) && h <= th.timeframeHours;
  return r.failureRisk >= th.risk && r.confidenceScore >= th.confidence && timeframeOk;
}

const RISKS = [0, 59, 60, 61, 100, NaN];
const CONFS = [0, 49, 50, 51, 100, NaN];
const HOURS = [null, 0, 1, 167, 168, 169, -5, NaN, Infinity, -Infinity];

describe("classifySuppression ⟺ biểu thức phát — không được phép lệch", () => {
  it("mọi tổ hợp biên: classify === 'emit' đúng khi và chỉ khi biểu thức phát cho phép", () => {
    const lech: string[] = [];
    for (const failureRisk of RISKS) {
      for (const confidenceScore of CONFS) {
        for (const predictedTimeframeHours of HOURS) {
          const input = { failureRisk, confidenceScore, predictedTimeframeHours };
          const classified = classifySuppression(input, th) === "emit";
          const emitted = shouldEmit(input);
          if (classified !== emitted) {
            lech.push(`risk=${failureRisk} conf=${confidenceScore} hours=${String(predictedTimeframeHours)} → classify=${classified} emit=${emitted}`);
          }
        }
      }
    }
    expect(lech).toEqual([]);
  });

  it("ca đã tìm ra: -Infinity phải BỊ CHẶN ở cả hai phía (bản gốc thiếu Number.isFinite)", () => {
    const input = { failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: -Infinity };
    expect(classifySuppression(input, th)).toBe("out-of-timeframe");
    expect(shouldEmit(input)).toBe(false);
  });
});

it("predictiveMaintenanceService KHÔNG được dựng lại biểu thức phát của riêng nó", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../predictiveMaintenanceService.ts"), "utf8");
  // Bản sao cũ nhận diện bằng biến `timeframeOk` + phép so ngưỡng inline.
  expect(src).not.toMatch(/const\s+timeframeOk\s*=/);
  expect(src).toMatch(/classifySuppression\(/);
  expect(src).toMatch(/suppression\s*===\s*["']emit["']/);
});
