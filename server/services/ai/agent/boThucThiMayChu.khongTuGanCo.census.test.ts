/**
 * ★★ CENSUS (Đợt 9, 2026-10-22, dieu-phoi duyệt) — "KHÔNG tool nào tự gắn cờ chèn lệnh trên dữ liệu VÔ HẠI".
 *
 * Lớp lỗi đo được (88db78df3): câu chỉ dẫn do CHÍNH ta viết ("… call compile_st again") nằm TRONG phần đi qua `lamSachChoModel`
 * ⇒ bộ quét gắn `tool_call_directive` ⇒ lõi HẠ tự trị ⇒ mọi lượt ghi sau đó chờ duyệt tới hết hạn (ablation tác nhân: 20 phút,
 * 4 HET_HAN). Lưới cũ của tool đó KHÔNG bắt vì không ai khẳng định `dangNgo === undefined`.
 *
 * Đảo chiều cách canh: chạy MỌI tool của bộ tác nhân (`TEN_CONG_CU`, kể cả tool tuỳ chọn) với đầu vào SẠCH — cả nhánh "có kết quả",
 * "rỗng" và "từ chối" — rồi đòi `dangNgo` VẮNG. Tool MỚI chưa có ca ⇒ ĐỎ (bảng `CA` phải phủ đủ `TEN_CONG_CU`).
 * Ca ngược (dữ liệu CÓ mệnh lệnh ⇒ dangNgo) đã có ở từng tệp lưới riêng (dangNgo/dot2/compileSt) — không lặp ở đây.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

vi.mock("../../../_core/accessControl", () => ({ checkPermission: vi.fn(async () => true) }));
vi.mock("../../flow/lib/bienDichST", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../flow/lib/bienDichST")>();
  return {
    ...goc,
    bienDichST: vi.fn(async (ma: string) =>
      ma.includes("AND ;")
        ? { ok: false, chanDoan: [{ tep: "ma.st", dong: 4, cot: 13, mucDo: "error", ma: "E007", thongDiep: "Unexpected token: expected expression but found ;" }], ms: 3 }
        : { ok: true, chanDoan: [], ms: 3 },
    ),
  };
});

import "../../aiLocalTools/index";
import { TEN_CONG_CU, kiemThamSo, type CheDoAgent } from "@shared/agentCore";
import { taoBoThucThiMayChu, type PhuThuocBoThucThi } from "./boThucThiMayChu";
import { _datLaiChiMucMa, type CongChiMucMa } from "./chiMucMaAgent";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";

let REPO = "";
const NGUOI = { id: 7, role: "engineer", name: "Ky su census" };

const chiMuc = (co: boolean): CongChiMucMa => ({
  timKyHieu: async () =>
    co
      ? { dinhNghia: [{ duong: "src/a.ts", dong: 1, kind: "function", chuKy: "export function cong(a: number, b: number)" }], thamChieu: [{ duong: "src/a.ts", dong: 2, dongMa: "return a + b;" }], catBot: false }
      : { dinhNghia: [], thamChieu: [], catBot: false },
  timMaNgu: async () =>
    co ? { ketQua: [{ duong: "src/a.ts", dongDau: 1, dongCuoi: 3, noiDung: "export function cong(a, b) {\n  return a + b;\n}", diem: 0.8 }], trangThai: "san-sang" as const } : { ketQua: [], trangThai: "san-sang" as const },
  lamTuoiTep: async () => undefined,
  dungChiMuc: async () => ({ soTep: 1, soDoan: 1, ms: 1 }),
});

function taoBo(co: boolean, them: PhuThuocBoThucThi = {}) {
  return taoBoThucThiMayChu({
    execCtx: { user: NGUOI, lang: "vi", projectRoot: REPO },
    gocDuAn: REPO,
    projectId: "census",
    user: NGUOI,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: {
      chiMucMa: chiMuc(co),
      timTaiLieu: async () => (co ? [{ nguon: "manual.pdf", loai: "vendor", diem: 0.7, noiDung: "Register D100 holds the setpoint." }] : []) as never,
      traApi: async () =>
        (co
          ? { khop: [{ nn: "csharp", loai: "type", ns: "System", ten: "String", chuKy: "class String", tomTat: "Represents text.", nguon: 0, nguonNhan: ".NET", tep: "x.xml", thanhVien: [], soThanhVien: 0 }], tongKhop: 1, catBot: false }
          : { khop: [], tongKhop: 0, catBot: false }) as never,
      kiemKillSwitch: async () => false,
      ...them,
    },
  });
}

/** (tool, đầu vào sạch, nhánh) — MỌI tên trong TEN_CONG_CU phải có ít nhất một ca. todo_write do lõi xử lý ⇒ ca "lõi". */
const CA: Array<{ ten: string; thamSo: Record<string, unknown>; co: boolean; nhan: string; cheDo?: CheDoAgent; kyVong?: RegExp }> = [
  { ten: "read_file", thamSo: { path: "src/a.ts" }, co: true, nhan: "đọc được", kyVong: /export function cong/ },
  { ten: "read_file", thamSo: { path: "src/khong-co.ts" }, co: true, nhan: "không có tệp" },
  { ten: "read_file", thamSo: { path: ".env" }, co: true, nhan: "từ chối hộp cát", kyVong: /DENIED/ },
  { ten: "list_dir", thamSo: { path: "." }, co: true, nhan: "liệt kê" },
  { ten: "list_dir", thamSo: { path: "khong-co" }, co: true, nhan: "thư mục vắng" },
  { ten: "find_files", thamSo: { pattern: "**/*.ts" }, co: true, nhan: "có tệp" },
  { ten: "find_files", thamSo: { pattern: "**/*.xyz" }, co: true, nhan: "không khớp" },
  { ten: "grep", thamSo: { pattern: "cong" }, co: true, nhan: "có khớp", kyVong: /match/ },
  { ten: "grep", thamSo: { pattern: "khongCoGiCa123" }, co: true, nhan: "không khớp" },
  { ten: "find_symbol", thamSo: { name: "cong" }, co: true, nhan: "có định nghĩa", kyVong: /src\/a\.ts:1/ },
  { ten: "find_symbol", thamSo: { name: "khongCo" }, co: false, nhan: "rỗng" },
  { ten: "search_code", thamSo: { query: "add two numbers" }, co: true, nhan: "có đoạn" },
  { ten: "search_code", thamSo: { query: "retry logic" }, co: false, nhan: "rỗng" },
  { ten: "search_docs", thamSo: { query: "setpoint register" }, co: true, nhan: "có đoạn" },
  { ten: "search_docs", thamSo: { query: "unknown vendor thing" }, co: false, nhan: "rỗng" },
  { ten: "lookup_api", thamSo: { name: "String" }, co: true, nhan: "có ký hiệu" },
  { ten: "lookup_api", thamSo: { name: "KhongCoKyHieu" }, co: false, nhan: "không khớp" },
  { ten: "remember", thamSo: { note: "This project uses pnpm, not npm." }, co: true, nhan: "đề xuất nhớ" },
  { ten: "compile_st", thamSo: { path: "src/A.st" }, co: true, nhan: "biên dịch sạch", kyVong: /Compiled OK/ },
  { ten: "compile_st", thamSo: { path: "src/B.st" }, co: true, nhan: "biên dịch LỖI (ca của 88db78df3)", kyVong: /Compilation FAILED[\s\S]*compile the file again/ },
  { ten: "compile_st", thamSo: { code: "```python\nprint(1)\n```" }, co: true, nhan: "không có mã ST", kyVong: /No Structured Text/ },
  { ten: "edit_file", thamSo: { path: "src/a.ts", edits: [{ old_string: "a + b", new_string: "b + a" }] }, co: true, nhan: "từ chối ở chế độ hỏi", cheDo: "hoi" },
  { ten: "write_file", thamSo: { path: "src/moi.ts", content: "export const x = 1;\n" }, co: true, nhan: "từ chối ở chế độ hỏi", cheDo: "hoi" },
  { ten: "delete_file", thamSo: { path: "src/a.ts" }, co: true, nhan: "từ chối ở chế độ hỏi", cheDo: "hoi" },
  { ten: "rename_file", thamSo: { from: "src/a.ts", to: "src/b.ts" }, co: true, nhan: "từ chối ở chế độ hỏi", cheDo: "hoi" },
];
// todo_write: lõi tự xử lý, không qua bộ thực thi. run_command: mọi lượt đi THẺ DUYỆT (chờ người — lưới treo tới hết hạn); chữ của nó
// là đầu ra tiến trình (DỮ LIỆU) + câu từ chối cố định — đã chấm thật bằng bộ quét ở rà 2026-10-22 (risk none).
const LOI = new Set(["todo_write", "run_command"]);

beforeAll(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "census-co-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src/a.ts"), "export function cong(a: number, b: number) {\n  return a + b;\n}\n");
  fs.writeFileSync(path.join(REPO, "src/A.st"), "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x;\nEND_FUNCTION_BLOCK\n");
  fs.writeFileSync(path.join(REPO, "src/B.st"), "FUNCTION_BLOCK B\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK\n");
  fs.writeFileSync(path.join(REPO, ".env"), "SECRET=abc\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  xoaSoNganSach();
  _datLaiChiMucMa();
  process.env.AI_KIEM_BIEN_DICH_ST = "agent";
  process.env.AI_REPO_SANDBOX_ROOTS = `census=Census|${REPO}`;
});
afterAll(() => {
  delete process.env.AI_KIEM_BIEN_DICH_ST;
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("CENSUS — mọi tool tác nhân, đầu vào sạch ⇒ KHÔNG tự gắn cờ chèn lệnh (dangNgo vắng)", () => {
  it("★ bảng ca phủ ĐỦ TEN_CONG_CU (tool mới chưa có ca ⇒ đỏ)", () => {
    const co = new Set(CA.map((c) => c.ten));
    expect(TEN_CONG_CU.filter((t) => !co.has(t) && !LOI.has(t))).toEqual([]);
  });
  for (const c of CA) {
    it(`${c.ten} — ${c.nhan}`, async () => {
      const kt = kiemThamSo(c.ten, c.thamSo);
      expect(kt.ok, c.ten).toBe(true);
      if (!kt.ok) return;
      const kq = await taoBo(c.co).chay(
        { id: `c-${c.ten}-${c.nhan}`, ten: c.ten, thamSo: kt.thamSo },
        { cheDo: c.cheDo ?? "tu-dong", runId: "census", luot: 1, signal: new AbortController().signal, phat: () => undefined },
      );
      expect(typeof kq.choModel).toBe("string");
      // ★ chống "lưới quét hư không": ca phải tới ĐÚNG nhánh đã khai (vd compile_st lỗi phải thật sự là "Compilation FAILED")
      if (c.kyVong) expect(kq.choModel, `${c.ten}/${c.nhan}`).toMatch(c.kyVong);
      expect(kq.dangNgo, `${c.ten}/${c.nhan} tự gắn cờ: ${JSON.stringify(kq.dangNgo)} — chữ: ${kq.choModel.slice(0, 300)}`).toBeUndefined();
    });
  }
});
