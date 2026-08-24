/**
 * Task 13 — cổng canh MỘT nguồn sự thật cho spec cột sản phẩm.
 *
 * Trước bản vá: server (`productRouters.ts`: PRODUCT_IMPORT_COLUMNS/
 * PRODUCT_EXPORT_COLUMNS) và client (`ProductModels.tsx`: PRODUCT_IO_COLUMNS)
 * khai HAI bản sao của cùng spec cột, khớp 10/10 theo `header` — nhưng không
 * cổng nào canh chúng lệch nhau. `header` là KHOÁ KHỚP tên cột file Excel/CSV
 * người dùng tải lên (xem masterDataIO.ts:26-37) — lệch một ký tự là gãy
 * import của MỌI file người dùng đang có.
 *
 * Lưới này canh: (1) nội dung `header` đúng nguyên văn cho 10 cột nhập,
 * (2) mọi cột có `headerKey`, (3) cột xuất = cột nhập + createdAt/updatedAt,
 * (4) không bên nào còn khai spec cột riêng — cả hai phía đều import từ đây,
 * (5) `header` không bị bọc t() (tức không có bản dịch động, giữ nguyên hợp
 * đồng dữ liệu).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { PRODUCT_COLUMN_SPEC, PRODUCT_EXPORT_COLUMN_SPEC } from "./productColumnSpec";

// Nguyên văn 10 header — đối chiếu từng ký tự với MÃ THẬT ở productRouters.ts
// và ProductModels.tsx trước khi viết lưới này (không lệch, xem báo cáo task 13).
const EXPECTED_IMPORT_HEADERS: Record<string, string> = {
  code: "Mã sản phẩm",
  name: "Tên sản phẩm",
  description: "Mô tả",
  category: "Nhóm",
  productLine: "Dòng sản phẩm",
  variant: "Biến thể",
  revision: "Phiên bản (Rev)",
  lifecycleStatus: "Trạng thái vòng đời",
  targetYieldRate: "FPY mục tiêu (%)",
  minYieldRate: "FPY tối thiểu (%)",
};

const EXPECTED_EXPORT_ONLY_HEADERS: Record<string, string> = {
  createdAt: "Ngày tạo",
  updatedAt: "Ngày cập nhật",
};

describe("Task 13 — PRODUCT_COLUMN_SPEC (một nguồn sự thật)", () => {
  it("có đúng 10 cột nhập", () => {
    expect(PRODUCT_COLUMN_SPEC.length).toBe(10);
  });

  it("header khớp NGUYÊN VĂN danh sách đã đối chiếu với mã thật", () => {
    for (const col of PRODUCT_COLUMN_SPEC) {
      expect(EXPECTED_IMPORT_HEADERS).toHaveProperty(col.field);
      expect(col.header).toBe(EXPECTED_IMPORT_HEADERS[col.field]);
    }
    // Không thiếu, không thừa field nào so với danh sách kỳ vọng.
    const fields = PRODUCT_COLUMN_SPEC.map((c) => c.field).sort();
    expect(fields).toEqual(Object.keys(EXPECTED_IMPORT_HEADERS).sort());
  });

  it("mọi cột nhập đều có headerKey (nhãn hiển thị đổi theo ngôn ngữ)", () => {
    for (const col of PRODUCT_COLUMN_SPEC) {
      expect(col.headerKey, `field "${col.field}" thiếu headerKey`).toBeTruthy();
      expect(col.headerKey).toMatch(/^productModelsCol\./);
    }
  });

  it("code/name là required; các cột còn lại không required", () => {
    const required = PRODUCT_COLUMN_SPEC.filter((c) => c.required).map((c) => c.field).sort();
    expect(required).toEqual(["code", "name"]);
  });

  it("cột XUẤT = cột nhập + createdAt/updatedAt (chỉ đọc)", () => {
    expect(PRODUCT_EXPORT_COLUMN_SPEC.length).toBe(PRODUCT_COLUMN_SPEC.length + 2);
    // 10 cột đầu của export = nguyên văn cột nhập.
    expect(PRODUCT_EXPORT_COLUMN_SPEC.slice(0, PRODUCT_COLUMN_SPEC.length)).toEqual(PRODUCT_COLUMN_SPEC);

    const tail = PRODUCT_EXPORT_COLUMN_SPEC.slice(PRODUCT_COLUMN_SPEC.length);
    const tailFields = tail.map((c) => c.field).sort();
    expect(tailFields).toEqual(Object.keys(EXPECTED_EXPORT_ONLY_HEADERS).sort());
    for (const col of tail) {
      expect(col.header).toBe(EXPECTED_EXPORT_ONLY_HEADERS[col.field]);
      expect(col.headerKey).toMatch(/^productModelsCol\./);
      expect(col.type).toBe("date");
    }
  });

  it("shared/productColumnSpec.ts không bọc t() quanh header (phá hợp đồng dữ liệu)", () => {
    const src = readFileSync(resolve(__dirname, "productColumnSpec.ts"), "utf8");
    expect(src).not.toMatch(/header:\s*t\(/);
  });

  it("productRouters.ts KHÔNG còn khai spec cột riêng — dùng PRODUCT_COLUMN_SPEC dùng chung", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/routers/productRouters.ts"),
      "utf8",
    );
    expect(src).toContain("PRODUCT_COLUMN_SPEC");
    expect(src).toContain('from "@shared/productColumnSpec"');
    expect(src).not.toMatch(/const PRODUCT_IMPORT_COLUMNS/);
    expect(src).not.toMatch(/const PRODUCT_EXPORT_COLUMNS\b/);
  });

  it("ProductModels.tsx KHÔNG còn khai spec cột riêng — dùng PRODUCT_COLUMN_SPEC dùng chung", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/pages/ProductModels.tsx"),
      "utf8",
    );
    expect(src).toContain("PRODUCT_COLUMN_SPEC");
    expect(src).toContain('from "@shared/productColumnSpec"');
    expect(src).not.toMatch(/const PRODUCT_IO_COLUMNS/);
  });
});
