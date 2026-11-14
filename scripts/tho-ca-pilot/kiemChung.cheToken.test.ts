/**
 * HA-11 — đầu ra LỆNH KIỂM che token có tiền tố nhà cung cấp bằng MỘT nguồn mẫu `shared/mauBiMat.ts` (phương án B1), ở CẢ HAI nhánh cờ
 * (`--cho-phep-db` tắt / bật). Khoá giả dựng bằng ghép chuỗi lúc chạy — tệp test không chứa nguyên một khoá.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cheTokenTrongDauRa, taoChayLenhKiem, THAY_TOKEN_BI_MAT } from "./kiemChung";

const THAN_A = "ZxQ7pLm2Rt9V";
const THAN_B = "bN4cHs8DwK3yFg6J";
const THAN = THAN_A + THAN_B;
const KHOA_ANT = ["sk-ant", "api03", THAN].join("-");
const URL_GIA = "postgresql://tho_ca_test:MATKHAU_GIA_123@127.0.0.1:5434/aoi_management_test";

describe("cheTokenTrongDauRa (thuần)", () => {
  it("khoá sk-ant đứng riêng ⇒ thay bằng đúng một placeholder, phần chữ quanh giữ nguyên", () => {
    expect(cheTokenTrongDauRa(`loi: ${KHOA_ANT} xong`)).toBe(`loi: ${THAY_TOKEN_BI_MAT} xong`);
  });

  it("khoá sk-ant DÍNH liền chữ phía trước (B1: dinhTrai) vẫn bị che, chữ dính giữ lại", () => {
    expect(cheTokenTrongDauRa(`x${KHOA_ANT}`)).toBe(`x${THAY_TOKEN_BI_MAT}`);
  });

  it("hai khoá trong một đầu ra ⇒ cả hai bị che, không còn thân khoá nào", () => {
    const r = cheTokenTrongDauRa(`a=${KHOA_ANT}\nb=${["gh", "p_"].join("")}${"A1b2C3d4E5".repeat(3)}\n`);
    expect(r).toBe(`a=${THAY_TOKEN_BI_MAT}\nb=${THAY_TOKEN_BI_MAT}\n`);
    expect(r).not.toContain(THAN);
  });

  it.each([
    ["chuỗi rỗng", ""],
    ["dòng tổng kết vitest", " Test Files  1 passed (1)\n      Tests  37 passed (37)\n"],
    ["tên có -admin- sau chữ thường (giữ biên trái)", "task-admin-dashboard-aaaaaaaaaaaaaaaaaaaaaaaa"],
    ["AKIA nằm trong chữ hoa tự nhiên", "MAKIAGE0123456789ABCDEF"],
    ["risk_live_ trong tên (giữ biên trái)", "risk_live_abcdefghijklmnopqrstuvwxyz"],
    ["biến npm_config_ không phải token", "npm_config_registry=https://registry.npmjs.org/"],
    ["sk-ant- quá ngắn", "sk-ant-api03-ngan"],
  ])("không có mẫu bí mật ⇒ nguyên văn từng byte: %s", (_ten, s) => {
    expect(cheTokenTrongDauRa(s)).toBe(s);
  });
});

describe("taoChayLenhKiem — tiến trình con thật in một khoá giả", () => {
  // lệnh KHÔNG chứa khoá nguyên vẹn (ghép trong tiến trình con); đầu ra thì có
  const lenhIn = `node -e "console.log(['sk-ant','api03','${THAN_A}'+'${THAN_B}'].join('-'))"`;
  const lenhKhongBiMat = `node -e "console.log('Tests 3 passed')"`;

  const chayTrong = async (opt: { testDbUrl?: string }, lenh: string) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-che-"));
    try {
      return await taoChayLenhKiem(opt)(lenh, cwd, 60);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };

  it("cờ TẮT: duoi KHÔNG còn thân khoá, có placeholder", async () => {
    const kq = await chayTrong({}, lenhIn);
    expect(kq.exit).toBe(0);
    expect(kq.duoi.trim()).toBe(THAY_TOKEN_BI_MAT);
    expect(JSON.stringify(kq)).not.toContain(THAN);
  });

  it("cờ BẬT (--cho-phep-db): duoi và dauRaDayDu đều KHÔNG còn thân khoá", async () => {
    const kq = await chayTrong({ testDbUrl: URL_GIA }, lenhIn);
    expect(kq.exit).toBe(0);
    expect(kq.duoi.trim()).toBe(THAY_TOKEN_BI_MAT);
    expect(kq.dauRaDayDu?.trim()).toBe(THAY_TOKEN_BI_MAT);
    expect(JSON.stringify(kq)).not.toContain(THAN);
  });

  it("cờ TẮT, đầu ra không có mẫu bí mật ⇒ duoi đúng chuỗi in ra (cam kết byte nguyên)", async () => {
    const kq = await chayTrong({}, lenhKhongBiMat);
    expect(kq.duoi.replace(/\r\n/g, "\n")).toBe("Tests 3 passed\n");
  });
});
