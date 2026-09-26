/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — LƯỚI TẤT ĐỊNH cho PHÁN QUYẾT ĐĂNG KÝ/XOÁ + ẢNH CHỤP DB.
 *
 * Chứng minh, không DB thật (tầng dữ liệu bị mock — lưới CSDL thật nằm ở
 * `server/routers/quanLyDuAnRepo.test.ts`):
 *   • `kiemTraDangKyDuAn` FAIL-CLOSED: MỖI mệnh đề hỏng cho đúng MỘT mã (đường tương đối ·
 *     không tồn tại · là TỆP · lồng gốc đã có (CẢ HAI chiều) · thư mục cấm · id/tên xấu · trùng id
 *     · vượt trần) — và chiều DƯƠNG: một thư mục sạch ĐƯỢC nhận (không có chiều dương thì một bản
 *     vá "từ chối tất cả" cũng xanh trọn vẹn).
 *   • `napLaiDuAnTuDb` XÁC THỰC LẠI từng hàng lúc nạp — một hàng bị đầu độc bằng SQL thẳng (id là
 *     đường dẫn / gốc không tồn tại) KHÔNG vào được ảnh chụp.
 *   • Phép hợp nhất: env THẮNG khi trùng id · mục DB mất gốc bị lọc Ở CỬA ĐỌC · `gocTheoId` phân
 *     giải được dự án DB (đường thực thi tool hưởng theo, không mã riêng).
 *   • `kiemTraXoaDuAn`: mục env (kể cả dự án mặc định) từ chối; mục DB cho qua; id méo từ chối.
 *
 * ⚠ Mock `../../db/aiRepoDuAn` là CÙNG module id mà `repoProjects.napLaiDuAnTuDb` import động —
 *   lưới chạy ĐÚNG đường nạp thật (kể cả vòng xác thực), chỉ thay nguồn hàng.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { hangDb } = vi.hoisted(() => ({
  hangDb: { current: [] as Array<{ id: string; ten: string; goc: string }> },
}));
vi.mock("../../db/aiRepoDuAn", () => ({
  danhSachDuAnDb: async () => hangDb.current,
}));

import {
  BIEN_DANH_SACH_GOC,
  ID_DU_AN_MAC_DINH,
  TRAN_DU_AN_DB,
  danhSachDuAn,
  gocTheoId,
  kiemTraDangKyDuAn,
  kiemTraXoaDuAn,
  napLaiDuAnTuDb,
} from "./repoProjects";
import { BIEN_GOC_HOP_CAT } from "./repoSandbox";

let GOC = ""; // thư mục cha của mọi vật thử — mkdtemp riêng, KHÔNG chạm sandbox-projects/
let A = ""; // gốc env "projA"
let SACH = ""; // thư mục sạch để đăng ký thành công
let TEP = ""; // một TỆP (không phải thư mục)

beforeAll(() => {
  GOC = fs.mkdtempSync(path.join(os.tmpdir(), "qlda-"));
  A = path.join(GOC, "goc-a");
  SACH = path.join(GOC, "sach");
  fs.mkdirSync(path.join(A, "con"), { recursive: true });
  fs.mkdirSync(SACH, { recursive: true });
  TEP = path.join(GOC, "mot-tep.txt");
  fs.writeFileSync(TEP, "x", "utf8");
});

afterAll(async () => {
  hangDb.current = [];
  await napLaiDuAnTuDb(); // trả ảnh chụp module về RỖNG (file test này là tiến trình riêng, nhưng dọn cho tất định)
  try { fs.rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const CU: Record<string, string | undefined> = {};
beforeEach(async () => {
  CU[BIEN_DANH_SACH_GOC] = process.env[BIEN_DANH_SACH_GOC];
  CU[BIEN_GOC_HOP_CAT] = process.env[BIEN_GOC_HOP_CAT];
  process.env[BIEN_DANH_SACH_GOC] = `projA=Dự án A|${A}`;
  process.env[BIEN_GOC_HOP_CAT] = A; // ghim gốc hộp cát mặc định về vật thử — không phụ thuộc cwd
  hangDb.current = [];
  await napLaiDuAnTuDb();
});
afterEach(() => {
  for (const k of [BIEN_DANH_SACH_GOC, BIEN_GOC_HOP_CAT]) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
});

describe("§1 — CHIỀU DƯƠNG: một thư mục sạch ĐƯỢC nhận, gốc trả về là realpath", () => {
  it("★★★ đăng ký hợp lệ ⇒ ok:true, goc = realpath, id/tên đã trim", () => {
    const kq = kiemTraDangKyDuAn({ id: " du-an-moi ", ten: " Dự án mới ", duongDan: SACH });
    expect(kq).toEqual({ ok: true, id: "du-an-moi", ten: "Dự án mới", goc: fs.realpathSync(SACH) });
  });
});

describe("§2 — FAIL-CLOSED: mỗi mệnh đề hỏng đúng MỘT mã", () => {
  const ma = (v: { id: unknown; ten: unknown; duongDan: unknown }): string =>
    (kiemTraDangKyDuAn(v) as { ok: false; ma: string }).ma;

  it("★★ id xấu ⇒ ID_KHONG_HOP_LE (khoảng trắng · rỗng · quá dài · không phải chuỗi)", () => {
    for (const id of ["co khoang trang", "", "x".repeat(65), 42 as unknown, null as unknown, "đường-có-dấu"]) {
      expect(ma({ id, ten: "T", duongDan: SACH }), String(id)).toBe("ID_KHONG_HOP_LE");
    }
  });

  it("★★ tên xấu ⇒ TEN_KHONG_HOP_LE (rỗng · >100 · chứa từng ký tự cấm #;=| — bài học dotenv)", () => {
    for (const ten of ["", "x".repeat(101), "a#b", "a;b", "a=b", "a|b", 7 as unknown]) {
      expect(ma({ id: "ok-id", ten, duongDan: SACH }), String(ten)).toBe("TEN_KHONG_HOP_LE");
    }
  });

  it("★★★ id trùng env ⇒ TRUNG_ID (env không bao giờ bị che)", () => {
    expect(ma({ id: "projA", ten: "T", duongDan: SACH })).toBe("TRUNG_ID");
  });

  it("★★★ id trùng một dự án DB đã có ⇒ TRUNG_ID", async () => {
    const B = path.join(GOC, "goc-db-trung");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "tu-db", ten: "Từ DB", goc: B }];
    await napLaiDuAnTuDb();
    expect(ma({ id: "tu-db", ten: "T", duongDan: SACH })).toBe("TRUNG_ID");
  });

  it("★★★ đường TƯƠNG ĐỐI / rỗng / không phải chuỗi ⇒ DUONG_DAN_KHONG_TUYET_DOI", () => {
    for (const d of ["./tuong-doi", "con/chau", "", 9 as unknown]) {
      expect(ma({ id: "ok-id", ten: "T", duongDan: d }), String(d)).toBe("DUONG_DAN_KHONG_TUYET_DOI");
    }
  });

  it("★★★ đường KHÔNG TỒN TẠI ⇒ DUONG_DAN_KHONG_TON_TAI", () => {
    expect(ma({ id: "ok-id", ten: "T", duongDan: path.join(GOC, "khong-co-that") })).toBe(
      "DUONG_DAN_KHONG_TON_TAI",
    );
  });

  it("★★★ trỏ vào một TỆP ⇒ KHONG_PHAI_THU_MUC", () => {
    expect(ma({ id: "ok-id", ten: "T", duongDan: TEP })).toBe("KHONG_PHAI_THU_MUC");
  });

  it("★★ node_modules/.git/dist ở BẤT KỲ đoạn nào ⇒ THU_MUC_CAM", () => {
    for (const doan of ["node_modules", ".git", "dist"]) {
      const d = path.join(GOC, "cam", doan, "goi");
      fs.mkdirSync(d, { recursive: true });
      expect(ma({ id: "ok-id", ten: "T", duongDan: d }), doan).toBe("THU_MUC_CAM");
    }
  });

  it("★★★ nằm TRONG (hoặc TRÙNG) gốc đã có ⇒ NAM_TRONG_GOC_DA_CO — kể cả gốc hộp cát mặc định", () => {
    // Trong gốc env projA:
    expect(ma({ id: "ok-id", ten: "T", duongDan: path.join(A, "con") })).toBe("NAM_TRONG_GOC_DA_CO");
    // Trùng hẳn gốc env:
    expect(ma({ id: "ok-id", ten: "T", duongDan: A })).toBe("NAM_TRONG_GOC_DA_CO");
    // Env VẮNG ⇒ dự án mặc định (gocHopCat) vẫn phải được bảo vệ:
    delete process.env[BIEN_DANH_SACH_GOC];
    expect(ma({ id: "ok-id", ten: "T", duongDan: path.join(A, "con") })).toBe("NAM_TRONG_GOC_DA_CO");
  });

  it("★★★ CHỨA một gốc đã có ⇒ CHUA_GOC_DA_CO (chiều ngược của cùng lỗi chồng lấn)", () => {
    // GOC chứa A (gốc env projA) ⇒ từ chối.
    expect(ma({ id: "ok-id", ten: "T", duongDan: GOC })).toBe("CHUA_GOC_DA_CO");
  });

  it("★★ hàng xóm KHÔNG lồng nhau thì KHÔNG bị hai mã lồng bắt oan (chống vá quá tay)", () => {
    // SACH là anh em của A dưới GOC — không trong, không chứa ⇒ phải ok.
    expect(kiemTraDangKyDuAn({ id: "ok-id", ten: "T", duongDan: SACH }).ok).toBe(true);
  });

  it(`★★ đủ ${TRAN_DU_AN_DB} mục nguồn DB ⇒ VUOT_TRAN_DU_AN`, async () => {
    const cha = path.join(GOC, "tran");
    const nhieu: Array<{ id: string; ten: string; goc: string }> = [];
    for (let i = 0; i < TRAN_DU_AN_DB; i++) {
      const d = path.join(cha, `m${i}`);
      fs.mkdirSync(d, { recursive: true });
      nhieu.push({ id: `tran-${i}`, ten: `Trần ${i}`, goc: d });
    }
    hangDb.current = nhieu;
    await napLaiDuAnTuDb();
    const themMoi = path.join(GOC, "them-sau-tran");
    fs.mkdirSync(themMoi, { recursive: true });
    expect(ma({ id: "qua-tran", ten: "T", duongDan: themMoi })).toBe("VUOT_TRAN_DU_AN");
  });
});

describe("§3 — ẢNH CHỤP DB: nạp có XÁC THỰC LẠI, hợp nhất env-thắng, lọc ở cửa đọc", () => {
  it("★★★ hàng DB sạch vào danh sách với nguon:'db', và gocTheoId phân giải được (tool hưởng theo)", async () => {
    const B = path.join(GOC, "goc-db-sach");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "tu-db", ten: "Từ DB", goc: B }];
    const kq = await napLaiDuAnTuDb();
    expect(kq).toEqual({ ok: true, soMuc: 1 });
    const ds = danhSachDuAn();
    expect(ds.map((d) => d.id)).toEqual(["projA", "tu-db"]);
    expect(ds.find((d) => d.id === "tu-db")).toMatchObject({ nguon: "db", goc: path.resolve(B) });
    expect(ds.find((d) => d.id === "projA")).toMatchObject({ nguon: "env" });
    expect(gocTheoId("tu-db")).toBe(path.resolve(B));
  });

  it("★★★ hàng bị ĐẦU ĐỘC bằng SQL thẳng KHÔNG vào được ảnh chụp: id là ĐƯỜNG DẪN · gốc tương đối · gốc không tồn tại", async () => {
    const B = path.join(GOC, "goc-db-ok");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [
      { id: "D:\\SOURCES\\bi-mat", ten: "id là đường dẫn", goc: B },
      { id: "goc-tuong-doi", ten: "gốc tương đối", goc: "./x" },
      { id: "goc-ma", ten: "gốc không tồn tại", goc: path.join(GOC, "khong-co") },
      { id: "hop-le", ten: "Hợp lệ", goc: B },
    ];
    const kq = await napLaiDuAnTuDb();
    expect(kq.soMuc, "chỉ MỘT hàng sạch được vào ảnh chụp").toBe(1);
    expect(danhSachDuAn().map((d) => d.id)).toEqual(["projA", "hop-le"]);
    expect(gocTheoId("D:\\SOURCES\\bi-mat")).toBeNull();
  });

  it("★★★ trùng id với env ⇒ ENV THẮNG (mục DB bị bỏ, gốc của env giữ nguyên)", async () => {
    const B = path.join(GOC, "goc-db-tranh-cho");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "projA", ten: "Chiếm chỗ", goc: B }];
    await napLaiDuAnTuDb();
    const ds = danhSachDuAn();
    expect(ds.filter((d) => d.id === "projA")).toHaveLength(1);
    expect(gocTheoId("projA"), "gốc phải là của ENV, không phải của hàng DB").toBe(path.resolve(A));
  });

  it("★★ gốc DB BIẾN MẤT sau lượt nạp ⇒ bị lọc Ở CỬA ĐỌC (không sập, không mở gốc ma)", async () => {
    const B = path.join(GOC, "goc-se-xoa");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "sap-mo-coi", ten: "Sắp mồ côi", goc: B }];
    await napLaiDuAnTuDb();
    expect(gocTheoId("sap-mo-coi")).toBe(path.resolve(B));
    fs.rmSync(B, { recursive: true, force: true });
    expect(gocTheoId("sap-mo-coi"), "gốc đã biến mất phải bị từ chối ngay lượt đọc sau").toBeNull();
    expect(danhSachDuAn().map((d) => d.id)).toEqual(["projA"]);
  });

  it("★ tầng dữ liệu NÉM ⇒ giữ ảnh chụp cũ + ok:false (CLI offline đi lối này, không sập)", async () => {
    const B = path.join(GOC, "goc-db-giu");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "giu-lai", ten: "Giữ lại", goc: B }];
    await napLaiDuAnTuDb();
    const nem = vi.spyOn(await import("../../db/aiRepoDuAn"), "danhSachDuAnDb").mockRejectedValueOnce(new Error("DB sập"));
    const kq = await napLaiDuAnTuDb();
    expect(kq.ok).toBe(false);
    expect(kq.soMuc, "ảnh chụp CŨ phải còn nguyên").toBe(1);
    expect(gocTheoId("giu-lai")).toBe(path.resolve(B));
    nem.mockRestore();
  });
});

describe("§4 — PHÁN QUYẾT XOÁ: chỉ mục nguồn DB", () => {
  it("★★★ mục env ⇒ MUC_ENV_KHONG_XOA_DUOC — kể cả dự án mặc định khi env vắng", () => {
    expect(kiemTraXoaDuAn("projA")).toEqual({ ok: false, ma: "MUC_ENV_KHONG_XOA_DUOC" });
    delete process.env[BIEN_DANH_SACH_GOC];
    expect(kiemTraXoaDuAn(ID_DU_AN_MAC_DINH)).toEqual({ ok: false, ma: "MUC_ENV_KHONG_XOA_DUOC" });
  });

  it("★★ mục DB ⇒ cho qua; id KHÔNG có ở env cũng cho qua (hàng mồ côi phải xoá được — DB phán tồn tại)", async () => {
    const B = path.join(GOC, "goc-db-xoa");
    fs.mkdirSync(B, { recursive: true });
    hangDb.current = [{ id: "xoa-duoc", ten: "Xoá được", goc: B }];
    await napLaiDuAnTuDb();
    expect(kiemTraXoaDuAn("xoa-duoc")).toEqual({ ok: true, id: "xoa-duoc" });
    expect(kiemTraXoaDuAn("khong-co-hang"), "hàng mồ côi: cho qua để DB phán DELETE 0 hàng").toEqual({
      ok: true,
      id: "khong-co-hang",
    });
  });

  it("★ id méo (đường dẫn / rỗng / không phải chuỗi) ⇒ KHONG_TIM_THAY", () => {
    for (const id of ["D:\\SOURCES\\x", "", null as unknown, "co khoang trang"]) {
      expect(kiemTraXoaDuAn(id), String(id)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    }
  });
});
