/**
 * Doc 42 Đợt 4A (INFRA-4A) — round-trip export→parse + validate cho masterDataIO.
 * Thuần (không DB): sinh buffer rồi parse lại, và kiểm luật validate/ép kiểu.
 */
import { describe, it, expect } from "vitest";
import { exportRows, buildTemplate, parseImport } from "./masterDataIO";
import type { MasterDataColumn } from "@shared/masterDataIO";

const COLUMNS: MasterDataColumn[] = [
  { field: "code", header: "Mã", required: true, type: "string", example: "M-001" },
  { field: "name", header: "Tên", required: true, type: "string", example: "Nhôm 6061" },
  { field: "qty", header: "Số lượng", type: "number", example: 10 },
  { field: "active", header: "Kích hoạt", type: "boolean", example: true },
];

const ROWS = [
  { code: "M-001", name: "Nhôm 6061", qty: 10, active: true },
  { code: "M-002", name: "Thép, SUS304", qty: 5, active: false }, // dấu phẩy trong tên → test quoting
];

describe("masterDataIO round-trip", () => {
  it("export CSV → parseImport khớp giá trị đã ép kiểu", async () => {
    const buf = await exportRows(ROWS, COLUMNS, "csv");
    const { rows, errors } = await parseImport(buf, "csv", COLUMNS);
    expect(errors).toEqual([]);
    expect(rows).toEqual(ROWS);
  });

  it("export XLSX → parseImport khớp giá trị đã ép kiểu", async () => {
    const buf = await exportRows(ROWS, COLUMNS, "xlsx");
    const { rows, errors } = await parseImport(buf, "xlsx", COLUMNS);
    expect(errors).toEqual([]);
    expect(rows).toEqual(ROWS);
  });

  it("CSV giữ nguyên ô có dấu phẩy (quoting RFC-4180)", async () => {
    const buf = await exportRows(ROWS, COLUMNS, "csv");
    const text = buf.toString("utf8");
    expect(text).toContain('"Thép, SUS304"');
  });
});

describe("masterDataIO validate", () => {
  it("báo lỗi thiếu cột bắt buộc và sai kiểu số", async () => {
    // CSV thô: dòng 1 thiếu 'code' (required); dòng 2 qty = 'abc' (không phải số).
    const csv = ["Mã,Tên,Số lượng,Kích hoạt", ",Không mã,10,true", "M-003,Có mã,abc,false"].join("\r\n");
    const buf = Buffer.from("﻿" + csv, "utf8");
    const { rows, errors } = await parseImport(buf, "csv", COLUMNS);

    // Dòng 1: lỗi required 'code'. Dòng 2: lỗi number 'qty'.
    expect(errors.some((e) => e.row === 1 && e.field === "code")).toBe(true);
    expect(errors.some((e) => e.row === 2 && e.field === "qty")).toBe(true);
    // rows vẫn map các field hợp lệ (code lỗi bị bỏ khỏi row1; qty lỗi bị bỏ khỏi row2).
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Không mã");
    expect(rows[1].code).toBe("M-003");
  });

  it("bỏ qua dòng rỗng hoàn toàn", async () => {
    const csv = ["Mã,Tên,Số lượng,Kích hoạt", "M-001,Nhôm,1,true", ",,,", "M-002,Thép,2,false"].join("\r\n");
    const buf = Buffer.from(csv, "utf8");
    const { rows, errors } = await parseImport(buf, "csv", COLUMNS);
    expect(rows).toHaveLength(2);
    expect(errors).toEqual([]);
  });
});

describe("masterDataIO template", () => {
  it("buildTemplate CSV có header + 1 dòng ví dụ", async () => {
    const buf = await buildTemplate(COLUMNS, "csv");
    const lines = buf.toString("utf8").replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Mã,Tên,Số lượng,Kích hoạt");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("M-001");
  });

  it("buildTemplate XLSX parse lại ra đúng 1 dòng ví dụ", async () => {
    const buf = await buildTemplate(COLUMNS, "xlsx");
    const { rows, errors } = await parseImport(buf, "xlsx", COLUMNS);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("M-001");
    expect(rows[0].qty).toBe(10);
    expect(rows[0].active).toBe(true);
  });
});
