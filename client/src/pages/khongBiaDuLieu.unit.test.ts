/**
 * Task 11+12 (doc "2026-08-24-aoi-pha0-va-no-co-san") — CỔNG CHẶN DỮ LIỆU BỊA quay lại.
 *
 * Hai chỗ UI từng vẽ dữ liệu KHÔNG THẬT trông giống dữ liệu thật:
 *  - ProductionDashboard.tsx: `PcbThumbnail` vẽ một tấm PCB giả bằng PRNG tất định
 *    (`Math.sin(seed)*10000`) mỗi khi `row.latestProductImage` rỗng — cùng kích thước,
 *    cùng bo góc với ảnh thật, nên "chưa có ảnh" và "đã có ảnh" trông y hệt nhau.
 *  - History.tsx: heatmap "NG theo giờ" bịa phân bố giờ bằng `Math.random()` trong một
 *    IIFE KHÔNG `useMemo` — số đổi mỗi lần re-render — trong khi backend chỉ trả NG
 *    theo NGÀY (`analysisStats.dateStats`).
 *
 * Lưới này KHÔNG kiểm tra hành vi UI (không có DOM ở đây) — nó kiểm tra rằng các mẫu
 * mã BỊA DỮ LIỆU đã bị xoá khỏi nguồn, bằng cách đọc thẳng file nguồn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PRODUCTION_DASHBOARD_PATH = path.resolve(
  __dirname,
  "ProductionDashboard.tsx",
);
const HISTORY_PATH = path.resolve(__dirname, "History.tsx");
const ANH_CHUA_CO_PATH = path.resolve(
  __dirname,
  "..",
  "components",
  "AnhChuaCo.tsx",
);

const productionDashboardSource = readFileSync(PRODUCTION_DASHBOARD_PATH, "utf8");
const historySource = readFileSync(HISTORY_PATH, "utf8");
const anhChuaCoSource = readFileSync(ANH_CHUA_CO_PATH, "utf8");

describe("khongBiaDuLieu — chống đọc file rỗng", () => {
  it("ProductionDashboard.tsx đọc được nội dung thật (không rỗng)", () => {
    expect(productionDashboardSource.length).toBeGreaterThan(1000);
  });

  it("History.tsx đọc được nội dung thật (không rỗng)", () => {
    expect(historySource.length).toBeGreaterThan(1000);
  });
});

describe("Task 11 — PcbThumbnail (bo mạch bịa) phải biến mất khỏi ProductionDashboard.tsx", () => {
  it("không còn định nghĩa/tham chiếu PcbThumbnail", () => {
    expect(productionDashboardSource).not.toContain("PcbThumbnail");
  });

  it("không còn dùng Math.sin( làm PRNG tất định", () => {
    expect(productionDashboardSource).not.toContain("Math.sin(");
  });

  it("dùng AnhChuaCo thay cho ô ảnh bịa", () => {
    expect(productionDashboardSource).toContain("AnhChuaCo");
  });

  it("PH-A: AnhChuaCo có shrink-0 trong class MẶC ĐỊNH — hàng flex chứa nó có " +
     "khối text min-w-0 bên cạnh; thiếu shrink-0 thì trình duyệt có thể co ô " +
     "ảnh thay vì co text, phá kích thước ô cũ (w-17 h-13) mà chỗ gọi truyền vào.",
     () => {
    expect(anhChuaCoSource).toContain("shrink-0");
  });
});

describe("Task 12 — heatmap NG-theo-giờ bịa bằng Math.random() phải biến mất khỏi History.tsx", () => {
  it("không còn Math.random( ở bất kỳ đâu trong file", () => {
    expect(historySource).not.toContain("Math.random(");
  });

  it("không còn comment tự khai 'Simulate hourly distribution'", () => {
    expect(historySource).not.toContain("Simulate hourly distribution");
  });
});
