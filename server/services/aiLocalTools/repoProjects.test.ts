/**
 * ★★★ doc 79 · TRỤC 2 — LƯỚI TẤT ĐỊNH cho DANH SÁCH TRẮNG DỰ ÁN (thay Playwright ở phần cơ chế).
 *
 * Chứng minh, không Playwright, không LLM:
 *   • `danhSachDuAn()` đọc + phân tích + XÁC THỰC (tuyệt đối · tồn tại · thư mục); mục xấu bị bỏ,
 *     không làm sập cả danh sách.
 *   • `gocTheoId("csharp")` → đường demo C#; `gocTheoId("id-lạ")` → **null** (fail-closed), KHÔNG rơi
 *     về `gocHopCat()`.
 *   • **CLIENT GỬI ĐƯỜNG DẪN thay vì id ⇒ bị bỏ qua/từ chối** — `gocTheoId`/`phanGiaiGoc` với một
 *     đường dẫn (không phải id trong danh sách) trả null/`PROJECT_NOT_FOUND`.
 *   • CÔ LẬP theo gốc: chọn dự án A ⇒ liệt kê/đọc được tệp CỦA A, KHÔNG thấy tệp của B.
 *   • Mọi ĐỘT BIẾN hộp cát của pha A (`..`, tuyệt đối, `C:` giữa đường, `.env`) chạy lại trên MỌI gốc.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BIEN_DANH_SACH_GOC,
  ID_DU_AN_MAC_DINH,
  danhSachDuAn,
  gocTheoId,
  duAnMacDinh,
  phanGiaiGoc,
} from "./repoProjects";
import { gocHopCat, lietKeTrongHopCat, moTepTrongHopCat, MA_TU_CHOI_HOP_CAT } from "./repoSandbox";
import { BIEN_GOC_HOP_CAT } from "./repoSandbox";

// ── Hai gốc TẠM, mỗi gốc một tệp RIÊNG + một tệp bí mật, để đo cô lập + đột biến trên MỌI gốc ──
let A = "";
let B = "";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CSHARP_DEMO = path.resolve(REPO_ROOT, "sandbox-projects/csharp-demo");

function ghi(p: string, s: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}

beforeAll(() => {
  A = fs.mkdtempSync(path.join(os.tmpdir(), "duanA-"));
  B = fs.mkdtempSync(path.join(os.tmpdir(), "duanB-"));
  ghi(path.join(A, "chi-co-o-A.ts"), "export const chiCoOA = 1;\n");
  ghi(path.join(B, "chi-co-o-B.ts"), "export const chiCoOB = 2;\n");
  ghi(path.join(A, ".env"), "SECRET=abc\n"); // tệp bí mật để đo DENIED_SECRET trên gốc A
});

afterAll(() => {
  for (const d of [A, B]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const CU: Record<string, string | undefined> = {};
beforeEach(() => {
  CU[BIEN_DANH_SACH_GOC] = process.env[BIEN_DANH_SACH_GOC];
  CU[BIEN_GOC_HOP_CAT] = process.env[BIEN_GOC_HOP_CAT];
});
afterEach(() => {
  for (const k of [BIEN_DANH_SACH_GOC, BIEN_GOC_HOP_CAT]) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
});

describe("§1 — phân tích + XÁC THỰC danh sách trắng", () => {
  it("★★★ hai gốc hợp lệ ⇒ hai dự án đúng id + gốc tuyệt đối", () => {
    process.env[BIEN_DANH_SACH_GOC] = `projA=Dự án A|${A};projB=Dự án B|${B}`;
    const ds = danhSachDuAn();
    expect(ds.map((d) => d.id).sort()).toEqual(["projA", "projB"]);
    expect(gocTheoId("projA")).toBe(path.resolve(A));
    expect(gocTheoId("projB")).toBe(path.resolve(B));
    expect(ds.every((d) => path.isAbsolute(d.goc))).toBe(true);
  });

  it("★★ mục XẤU bị bỏ (không sập danh sách): đường tương đối · không tồn tại · id trùng · thiếu '='", () => {
    process.env[BIEN_DANH_SACH_GOC] = [
      `projA=Dự án A|${A}`,
      `tuongDoi=Rel|./khong-tuyet-doi`,
      `khongTonTai=Ghost|${path.join(A, "khong-co-thu-muc-nay")}`,
      `projA=Trùng id|${B}`, // id trùng ⇒ bỏ mục sau
      `thieu-bang-thi-bo`,
    ].join(";");
    const ds = danhSachDuAn();
    expect(ds.map((d) => d.id)).toEqual(["projA"]); // chỉ mục hợp lệ ĐẦU TIÊN sống
    expect(gocTheoId("projA")).toBe(path.resolve(A)); // giữ mục ĐẦU, không phải mục trùng
    expect(gocTheoId("tuongDoi")).toBeNull();
    expect(gocTheoId("khongTonTai")).toBeNull();
  });

  it("★★ cấu hình có mặt nhưng 0 mục hợp lệ ⇒ rơi về dự án mặc định (không sập)", () => {
    process.env[BIEN_DANH_SACH_GOC] = `x=Rel|./a;y=|;=thieu-id`;
    process.env[BIEN_GOC_HOP_CAT] = A;
    const ds = danhSachDuAn();
    expect(ds).toHaveLength(1);
    expect(ds[0]!.id).toBe(ID_DU_AN_MAC_DINH);
    expect(ds[0]!.goc).toBe(gocHopCat());
  });

  it("★★★ VẮNG env ⇒ MỘT dự án mặc định = gocHopCat() (tương thích ngược)", () => {
    delete process.env[BIEN_DANH_SACH_GOC];
    process.env[BIEN_GOC_HOP_CAT] = A;
    const ds = danhSachDuAn();
    expect(ds).toHaveLength(1);
    expect(ds[0]!.id).toBe(ID_DU_AN_MAC_DINH);
    expect(gocTheoId(ID_DU_AN_MAC_DINH)).toBe(path.resolve(A));
    expect(duAnMacDinh().id).toBe(ID_DU_AN_MAC_DINH);
  });
});

describe("§2 — FAIL-CLOSED: id lạ / client gửi ĐƯỜNG DẪN ⇒ TỪ CHỐI (không rơi về gốc mặc định)", () => {
  beforeEach(() => {
    process.env[BIEN_DANH_SACH_GOC] = `projA=Dự án A|${A};projB=Dự án B|${B}`;
    process.env[BIEN_GOC_HOP_CAT] = REPO_ROOT; // gốc mặc định KHÁC hẳn A/B
  });

  it("★★★ id LẠ ⇒ null, KHÔNG rơi về gocHopCat()", () => {
    expect(gocTheoId("khong-ton-tai")).toBeNull();
    expect(gocTheoId("khong-ton-tai")).not.toBe(gocHopCat());
  });

  it("★★★ client gửi ĐƯỜNG DẪN thay vì id ⇒ bị từ chối (không mở được gốc tuỳ ý)", () => {
    // Mọi hình dạng đường dẫn một client có thể thử — KHÔNG cái nào là id trong danh sách ⇒ null.
    for (const dp of ["../../etc/passwd", "C:\\Windows", "/etc/shadow", A, B, "sandbox-projects", "..\\.."]) {
      expect(gocTheoId(dp), `đường dẫn "${dp}" KHÔNG được phân giải thành gốc`).toBeNull();
    }
  });

  it("★★ id không phải chuỗi / rỗng ⇒ null", () => {
    expect(gocTheoId(123 as unknown)).toBeNull();
    expect(gocTheoId("")).toBeNull();
    expect(gocTheoId(null as unknown)).toBeNull();
    expect(gocTheoId({ id: "projA" } as unknown)).toBeNull();
  });

  it("★★★ phanGiaiGoc: VẮNG ⇒ ok+goc null · hợp lệ ⇒ ok+goc · lạ/đường dẫn ⇒ PROJECT_NOT_FOUND", () => {
    expect(phanGiaiGoc(undefined)).toEqual({ ok: true, id: null, goc: null });
    expect(phanGiaiGoc("")).toEqual({ ok: true, id: null, goc: null });
    expect(phanGiaiGoc("projA")).toEqual({ ok: true, id: "projA", goc: path.resolve(A) });
    expect(phanGiaiGoc("id-la")).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc("../../etc")).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc(A)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
  });
});

describe("§3 — CÔ LẬP: chọn dự án A ⇒ thấy tệp CỦA A, KHÔNG thấy của B (chống vá quá tay)", () => {
  beforeEach(() => {
    process.env[BIEN_DANH_SACH_GOC] = `projA=Dự án A|${A};projB=Dự án B|${B}`;
  });

  it("★★★ list gốc A chỉ có tệp của A; gốc B chỉ có tệp của B", () => {
    const gA = gocTheoId("projA")!;
    const gB = gocTheoId("projB")!;
    const lkA = lietKeTrongHopCat("", gA);
    const lkB = lietKeTrongHopCat("", gB);
    expect(lkA.ok && lkA.muc.some((m) => m.name === "chi-co-o-A.ts")).toBe(true);
    expect(lkA.ok && lkA.muc.some((m) => m.name === "chi-co-o-B.ts")).toBe(false);
    expect(lkB.ok && lkB.muc.some((m) => m.name === "chi-co-o-B.ts")).toBe(true);
    expect(lkB.ok && lkB.muc.some((m) => m.name === "chi-co-o-A.ts")).toBe(false);
  });

  it("★★★ read_file bám gốc: đọc được tệp CỦA A trên gốc A; cùng tên KHÔNG có ở gốc B ⇒ NOT_FOUND", () => {
    const gA = gocTheoId("projA")!;
    const gB = gocTheoId("projB")!;
    const rA = moTepTrongHopCat("chi-co-o-A.ts", { goc: gA });
    expect(rA.ok).toBe(true);
    expect(rA.ok && rA.noiDung).toContain("chiCoOA");
    const rB = moTepTrongHopCat("chi-co-o-A.ts", { goc: gB });
    expect(rB.ok).toBe(false);
    expect(!rB.ok && rB.ma).toBe(MA_TU_CHOI_HOP_CAT.NOT_FOUND);
  });
});

describe("§4 — ĐỘT BIẾN hộp cát pha A chạy lại trên MỌI gốc", () => {
  it("★★★ thoát gốc / tuyệt đối / 'C:' giữa đường ⇒ PATH_REJECTED trên cả A và B", () => {
    for (const goc of [A, B]) {
      expect(moTepTrongHopCat("../ngoai.ts", { goc }).ok).toBe(false);
      expect(moTepTrongHopCat("../ngoai.ts", { goc })).toMatchObject({ ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED });
      expect(moTepTrongHopCat(path.join(goc, "chi-co-o-A.ts"), { goc })).toMatchObject({
        ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED,
      }); // đường TUYỆT ĐỐI bị chặn
      expect(moTepTrongHopCat("a/C:/x.ts", { goc })).toMatchObject({ ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED });
    }
  });

  it("★★★ `.env` trong gốc A vẫn bị DENIED_SECRET (danh sách cấm áp cho MỌI gốc)", () => {
    const r = moTepTrongHopCat(".env", { goc: A });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.ma).toBe(MA_TU_CHOI_HOP_CAT.DENIED_SECRET);
  });
});

describe("§5 — DỰ ÁN THỬ C# THẬT (đúng phép đo brief yêu cầu)", () => {
  it("★★★ gocTheoId('csharp') → đường demo C#, đọc được Calculator.cs (nội dung C# THẬT)", () => {
    if (!fs.existsSync(CSHARP_DEMO)) return; // môi trường không có demo ⇒ bỏ qua (khai ở báo cáo)
    process.env[BIEN_DANH_SACH_GOC] = `csharp=Demo C#|${CSHARP_DEMO}`;
    expect(gocTheoId("csharp")).toBe(path.resolve(CSHARP_DEMO));
    const r = moTepTrongHopCat("src/Calculator.cs", { goc: gocTheoId("csharp")! });
    expect(r.ok, `phải đọc được Calculator.cs: ${JSON.stringify(r)}`).toBe(true);
    expect(r.ok && r.noiDung).toContain("namespace");
  });
});
