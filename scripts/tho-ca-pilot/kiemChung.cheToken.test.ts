/**
 * HA-11 — đầu ra LỆNH KIỂM che token có tiền tố nhà cung cấp bằng MỘT nguồn mẫu `shared/mauBiMat.ts` (phương án B1), ở CẢ HAI nhánh cờ
 * (`--cho-phep-db` tắt / bật). Khoá giả dựng bằng ghép chuỗi lúc chạy — tệp test không chứa nguyên một khoá.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cheTokenTrongDauRa, taoChayLenhKiem } from "./kiemChung";

const THAN_A = "ZxQ7pLm2Rt9V";
const THAN_B = "bN4cHs8DwK3yFg6J";
const THAN = THAN_A + THAN_B;
const KHOA_ANT = ["sk-ant", "api03", THAN].join("-");
/** Ghim LITERAL (không import hằng của mã): đổi chữ placeholder trong kiemChung.ts phải làm test đỏ. */
const NHAN_CHE = "[REDACTED_SECRET]";
const URL_GIA = "postgresql://tho_ca_test:MATKHAU_GIA_123@127.0.0.1:5434/aoi_management_test";

describe("cheTokenTrongDauRa (thuần)", () => {
  it("khoá sk-ant đứng riêng ⇒ thay bằng đúng một placeholder, phần chữ quanh giữ nguyên", () => {
    expect(cheTokenTrongDauRa(`loi: ${KHOA_ANT} xong`)).toBe(`loi: ${NHAN_CHE} xong`);
  });

  it("khoá sk-ant DÍNH liền chữ phía trước (B1: dinhTrai) vẫn bị che, chữ dính giữ lại", () => {
    expect(cheTokenTrongDauRa(`x${KHOA_ANT}`)).toBe(`x${NHAN_CHE}`);
  });

  it("hai khoá trong một đầu ra ⇒ cả hai bị che, không còn thân khoá nào", () => {
    const r = cheTokenTrongDauRa(`a=${KHOA_ANT}\nb=${["gh", "p_"].join("")}${"A1b2C3d4E5".repeat(3)}\n`);
    expect(r).toBe(`a=${NHAN_CHE}\nb=${NHAN_CHE}\n`);
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
    expect(kq.duoi.trim()).toBe(NHAN_CHE);
    expect(JSON.stringify(kq)).not.toContain(THAN);
  });

  it("cờ BẬT (--cho-phep-db): duoi và dauRaDayDu đều KHÔNG còn thân khoá", async () => {
    const kq = await chayTrong({ testDbUrl: URL_GIA }, lenhIn);
    expect(kq.exit).toBe(0);
    expect(kq.duoi.trim()).toBe(NHAN_CHE);
    expect(kq.dauRaDayDu?.trim()).toBe(NHAN_CHE);
    expect(JSON.stringify(kq)).not.toContain(THAN);
  });

  // Đường LỖI spawn (locLoi): lệnh chứa byte NUL làm `spawn` ném TypeError ERR_INVALID_ARG_VALUE, thông điệp lỗi chép NGUYÊN lệnh ("Received '…'") — có khoá trong đó.
  it.each([
    ["cờ TẮT", {}],
    ["cờ BẬT (--cho-phep-db)", { testDbUrl: URL_GIA }],
  ])("đường lỗi spawn (%s): thông điệp lỗi chứa khoá ⇒ `loi` bị che, không còn thân khoá", async (_ten, opt) => {
    const kq = await chayTrong(opt, `echo ${KHOA_ANT}${String.fromCharCode(0)}x`);
    expect(kq.exit).toBeNull();
    expect(kq.loi).toBeDefined();
    expect(kq.loi).toContain("ERR_INVALID_ARG_VALUE"); // bằng chứng đây đúng là nhánh ném đồng bộ, không phải lỗi khác
    expect(kq.loi).toContain("[REDACTED_SECRET]");
    expect(kq.loi).not.toContain(THAN);
    expect(kq.duoi).toBe("");
  });

  it("cờ TẮT, đầu ra không có mẫu bí mật ⇒ duoi đúng chuỗi in ra (cam kết byte nguyên)", async () => {
    const kq = await chayTrong({}, lenhKhongBiMat);
    expect(kq.duoi.replace(/\r\n/g, "\n")).toBe("Tests 3 passed\n");
  });
});

// ── P3: khoá quanh MỐC CẮT 3000 ký tự của `duoi` (che TRƯỚC khi cắt). Ca vắt (5/20/35 ký tự cuối khoá nằm TRONG cửa sổ) do kiem-dinh viết; các phía còn lại bổ sung.
describe("taoChayLenhKiem — khoá quanh mốc cắt 3000 ký tự (che trước khi cắt)", () => {
  // khoá = 'sk-ant-api03-' + THAN_A + THAN_B (41 ký tự), ghép trong tiến trình con; tệp test không chứa nguyên khoá
  const KHOA_JS = `['sk-ant','api03','${THAN_A}'+'${THAN_B}'].join('-')`;
  const chayMa = async (opt: { testDbUrl?: string }, thanMa: string) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-3000-"));
    try {
      const code = `const k=${KHOA_JS};${thanMa}`;
      return await taoChayLenhKiem(opt)(`node -e "${code.replace(/"/g, '\\"')}"`, cwd, 60);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
  const khongRo = (s: string | undefined, nhan: string, dich = 0) => {
    expect(s ?? "", nhan).not.toContain(THAN_A.slice(0, 6));
    expect(s ?? "", nhan).not.toContain(THAN_B.slice(0, 6));
    expect(s ?? "", nhan).not.toContain("sk-ant");
    if (dich > 0) expect(s ?? "", nhan).not.toContain(KHOA_ANT.slice(-dich)); // chính mảnh đuôi khoá nằm trong cửa sổ
  };
  const CO = [
    ["cờ TẮT", {}],
    ["cờ BẬT (--cho-phep-db)", { testDbUrl: URL_GIA }],
  ] as const;

  it.each(CO)("khoá VẮT qua mốc (5/20/35 ký tự cuối khoá trong cửa sổ): không rò mảnh nào [%s]", async (_t, opt) => {
    for (const dich of [5, 20, 35]) {
      const kq = await chayMa(opt, `const yt=${2999 - dich};process.stdout.write('x'.repeat(10)+' ');process.stdout.write(k+' '+'y'.repeat(yt));`);
      khongRo(kq.duoi, `dich ${dich}`, dich);
      khongRo(kq.dauRaDayDu, `dich ${dich} (đầy đủ)`, dich);
    }
  });

  it.each(CO)("khoá VẮT, DÍNH chữ phía trước (`e`, `task-`, `9`): vẫn không rò [%s]", async (_t, opt) => {
    for (const truoc of ["e", "task-", "9"]) {
      for (const dich of [5, 20, 35]) {
        const kq = await chayMa(opt, `const yt=${2999 - dich};process.stdout.write('x'.repeat(10)+' '+'${truoc}'+k+' '+'y'.repeat(yt));`);
        khongRo(kq.duoi, `${truoc}+khoá dich ${dich}`, dich);
        khongRo(kq.dauRaDayDu, `${truoc}+khoá dich ${dich} (đầy đủ)`, dich);
      }
    }
  });

  it.each(CO)("khoá nằm TRỌN SAU mốc (trong 3000 ký tự cuối): duoi chứa đúng MỘT placeholder, không rò; kể cả dính chữ [%s]", async (_t, opt) => {
    for (const truoc of ["", "e", "task-", "9"]) {
      const kq = await chayMa(opt, `process.stdout.write('x'.repeat(4000)+'${truoc}'+k+' '+'y'.repeat(100));`);
      khongRo(kq.duoi, `trọn sau, tiền tố "${truoc}"`);
      khongRo(kq.dauRaDayDu, `trọn sau, tiền tố "${truoc}" (đầy đủ)`);
      expect(kq.duoi.split("[REDACTED_SECRET]").length - 1, `trọn sau, tiền tố "${truoc}"`).toBe(1);
      expect(kq.duoi.endsWith(`${truoc}[REDACTED_SECRET] ${"y".repeat(100)}`), `tiền tố "${truoc}"`).toBe(true);
    }
  });

  it.each(CO)("khoá nằm TRỌN TRƯỚC mốc (bị cắt đi hoàn toàn): duoi chỉ còn phần đuôi, không rò; kể cả dính chữ [%s]", async (_t, opt) => {
    for (const truoc of ["", "e", "task-", "9"]) {
      const kq = await chayMa(opt, `process.stdout.write('${truoc}'+k+' '+'y'.repeat(3200));`);
      khongRo(kq.duoi, `trọn trước, tiền tố "${truoc}"`);
      khongRo(kq.dauRaDayDu, `trọn trước, tiền tố "${truoc}" (đầy đủ)`);
      expect(kq.duoi, `trọn trước, tiền tố "${truoc}"`).toBe("y".repeat(3000));
    }
  });

  it.each(CO)("HAI khoá cùng đầu ra: một khoá vắt qua mốc (20 ký tự cuối trong cửa sổ), một khoá trọn sau mốc ⇒ không rò, đúng hai placeholder [%s]", async (_t, opt) => {
    // tổng thô = 41 + 1 + 2836 + 1 + 41 + 1 + 100 = 3021 ⇒ cửa sổ bắt đầu ở 21 ⇒ 20 ký tự cuối khoá thứ nhất nằm trong cửa sổ
    const kq = await chayMa(opt, `process.stdout.write(k+' '+'z'.repeat(2836)+' '+k+' '+'y'.repeat(100));`);
    khongRo(kq.duoi, "hai khoá", 20);
    khongRo(kq.dauRaDayDu, "hai khoá (đầy đủ)", 20);
    expect(kq.duoi.split("[REDACTED_SECRET]").length - 1).toBe(2);
  });
});
