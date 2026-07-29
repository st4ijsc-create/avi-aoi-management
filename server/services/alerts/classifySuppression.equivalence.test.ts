/**
 * Sprint 5 §5 (backlog B1) — LỊCH SỬ: `classifySuppression` và biểu thức phát
 * cảnh báo viết tay riêng ở `predictiveMaintenanceService.ts` từng là HAI BẢN
 * SAO logic mà KHÔNG test nào so khớp — và chúng đã lệch thật (thiếu
 * `Number.isFinite` khiến `predictedTimeframeHours = -Infinity` được PHÁT
 * trong khi bị ĐẾM là đã chặn).
 *
 * HIỆN TRẠNG (đã hợp nhất): `predictiveMaintenanceService.ts` không còn biểu
 * thức phát viết tay nào nữa — nó gọi thẳng `classifySuppression(...)` và chỉ
 * phát khi kết quả là `"emit"` (xem `predictiveMaintenanceService.ts:824-837`).
 * Vì vậy test này KHÔNG còn "dựng lại biểu thức phát nguyên văn" (không còn gì
 * để dựng lại) — nó khoá ngữ nghĩa MONG MUỐN của "được phát" bằng một oracle
 * độc lập viết từ đầu (`shouldEmit` dưới đây), quét toàn bộ tổ hợp giá trị biên
 * đối chiếu với `classifySuppression`. Bài test cuối file canh DRIFT: đảm bảo
 * không ai lỡ mọc lại một biểu thức phát riêng ở `predictiveMaintenanceService.ts`
 * thay vì gọi thẳng hàm này — vì hàm này giờ là NGUỒN DUY NHẤT quyết định phát.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classifySuppression, type SuppressionThresholds } from "./classifySuppression";

const th: SuppressionThresholds = { risk: 60, confidence: 50, timeframeHours: 168 };

/** Ngữ nghĩa MONG MUỐN của "được phát", viết độc lập với classifySuppression
 *  (không đọc mã nguồn của nó). Bản gốc (đã bị xoá) từng thiếu đúng
 *  `Number.isFinite` — nên `-Infinity` lọt qua `hours <= T` và được PHÁT trong
 *  khi bị ĐẾM là đã chặn. Giữ hàm này tách rời để bảng chân lý còn chỗ đối chiếu.
 *  Kiểu tham số khớp `SuppressionInput` (`number | null | undefined`) — thiếu
 *  `undefined` ở đây sẽ để lọt một nhánh mà `classifySuppression` xử lý nhưng
 *  bảng chân lý chưa bao giờ đi qua. */
function shouldEmit(r: {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null | undefined;
}): boolean {
  const h = r.predictedTimeframeHours;
  const timeframeOk = h != null && Number.isFinite(h) && h <= th.timeframeHours;
  return r.failureRisk >= th.risk && r.confidenceScore >= th.confidence && timeframeOk;
}

const RISKS = [0, 59, 60, 61, 100, NaN];
const CONFS = [0, 49, 50, 51, 100, NaN];
// `undefined` thêm vào (vòng sửa cuối, mục 7) — SuppressionInput cho phép
// number | null | undefined, bảng chân lý cũ chỉ phủ null.
const HOURS = [null, undefined, 0, 1, 167, 168, 169, -5, NaN, Infinity, -Infinity];

describe("classifySuppression ⟺ oracle độc lập (shouldEmit) — không được phép lệch", () => {
  it("mọi tổ hợp biên: classify === 'emit' đúng khi và chỉ khi shouldEmit cho phép", () => {
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
  // Vòng sửa cuối, mục 6 — regex trên chỉ canh ĐÚNG TÊN biến `timeframeOk` khai
  // báo bằng `const`. Đổi sang `let`, đổi tên biến, hoặc bung thẳng biểu thức
  // vào `if (...)` đều lọt qua nó. Thêm một khẳng định ĐỘC LẬP VỚI TÊN: dù biến
  // được gọi là gì, một biểu thức phát viết tay riêng vẫn phải so sánh trực tiếp
  // `predictedTimeframeHours <=` — nếu chuỗi đó xuất hiện trở lại, có ai đó đã
  // dựng lại bản sao mà không gọi qua classifySuppression.
  expect(src).not.toMatch(/predictedTimeframeHours\s*<=/);
  expect(src).toMatch(/classifySuppression\(/);
  expect(src).toMatch(/suppression\s*===\s*["']emit["']/);
});
