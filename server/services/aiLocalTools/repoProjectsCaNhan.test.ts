/**
 * ★★★ Đợt 3a — `phanGiaiGoc(id, nguoiGoi)` TÔN TRỌNG CHỦ SỞ HỮU của dự án cá nhân (ảnh chụp DB mock — cùng module id
 * mà `napLaiDuAnTuDb` import động, nên vòng xác thực lúc nạp chạy THẬT):
 *   • chủ ⇒ ok · admin ⇒ ok · người khác ⇒ PROJECT_NOT_FOUND · không biết người gọi (null) ⇒ PROJECT_NOT_FOUND;
 *   • `gocTheoId` (cửa không biết người gọi) ⇒ null cho dự án cá nhân;
 *   • `danhSachDuAnChoNguoi` chỉ đưa dự án cá nhân cho chủ/admin; mục env/admin thì mọi người;
 *   • hàng cá nhân có gốc NGOÀI thư mục của chủ (hàng bị sửa tay) ⇒ không vào ảnh chụp;
 *   • trần dự án ADMIN không đếm dự án cá nhân; admin không đăng ký được thư mục trong gốc quản lý.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { hangDb } = vi.hoisted(() => ({
  hangDb: { current: [] as Array<{ id: string; ten: string; goc: string; chuSoHuu?: number | null; cachTao?: string | null }> },
}));
vi.mock("../../db/aiRepoDuAn", () => ({
  danhSachDuAnDb: async () => hangDb.current,
}));

import {
  BIEN_DANH_SACH_GOC,
  danhSachDuAn,
  danhSachDuAnChoNguoi,
  gocTheoId,
  kiemTraDangKyDuAn,
  napLaiDuAnTuDb,
  phanGiaiGoc,
} from "./repoProjects";
import { BIEN_GOC_HOP_CAT } from "./repoSandbox";
import { BIEN_GOC_DU_AN_CA_NHAN } from "./gocDuAnCaNhan";

let TAM = "";
let GOC_CN = "";
let ENV_A = "";
let DA_U7 = "";
let DA_LAC = "";
const CU: Record<string, string | undefined> = {};
const BIEN = [BIEN_DANH_SACH_GOC, BIEN_GOC_HOP_CAT, BIEN_GOC_DU_AN_CA_NHAN];

beforeAll(() => {
  TAM = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rpcn-")));
  GOC_CN = path.join(TAM, "AI-Projects");
  ENV_A = path.join(TAM, "env-a");
  DA_U7 = path.join(GOC_CN, "u7", "u7-aaaa");
  DA_LAC = path.join(GOC_CN, "u8", "u8-lac"); // hàng nói chủ là u7 nhưng gốc ở cây u8
  for (const d of [ENV_A, DA_U7, DA_LAC]) fs.mkdirSync(d, { recursive: true });
});
afterAll(async () => {
  hangDb.current = [];
  await napLaiDuAnTuDb();
  fs.rmSync(TAM, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const k of BIEN) CU[k] = process.env[k];
  process.env[BIEN_DANH_SACH_GOC] = `envA=Env A|${ENV_A}`;
  process.env[BIEN_GOC_HOP_CAT] = ENV_A;
  process.env[BIEN_GOC_DU_AN_CA_NHAN] = GOC_CN;
  hangDb.current = [
    { id: "u7-aaaa", ten: "Của u7", goc: DA_U7, chuSoHuu: 7, cachTao: "rong" },
    { id: "u7-lac", ten: "Lạc chỗ", goc: DA_LAC, chuSoHuu: 7, cachTao: "rong" },
  ];
  await napLaiDuAnTuDb();
});
afterEach(() => {
  for (const k of BIEN) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
});

const U7 = { id: 7, role: "engineer" };
const U8 = { id: 8, role: "engineer" };
const ADMIN = { id: 1, role: "admin" };

describe("§1 — phanGiaiGoc theo chủ sở hữu", () => {
  it("★★★ chủ ⇒ ok (đúng gốc); admin ⇒ ok", () => {
    expect(phanGiaiGoc("u7-aaaa", U7)).toEqual({ ok: true, id: "u7-aaaa", goc: path.resolve(DA_U7) });
    expect(phanGiaiGoc("u7-aaaa", ADMIN)).toMatchObject({ ok: true });
  });

  it("★★★ NGƯỜI KHÁC ⇒ PROJECT_NOT_FOUND — cùng mã với id không tồn tại (không kênh dò)", () => {
    expect(phanGiaiGoc("u7-aaaa", U8)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc("u7-khong-co", U8)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
  });

  it("★★★ KHÔNG BIẾT người gọi (null / id méo) ⇒ PROJECT_NOT_FOUND (fail-closed); mục env vẫn ok", () => {
    expect(phanGiaiGoc("u7-aaaa", null)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc("u7-aaaa", { id: 0, role: "admin" })).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc("u7-aaaa", { id: Number.NaN, role: "engineer" })).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc("envA", null)).toMatchObject({ ok: true, id: "envA" });
  });

  it("★★ gocTheoId (không biết người gọi) ⇒ null cho dự án cá nhân, gốc cho mục env", () => {
    expect(gocTheoId("u7-aaaa")).toBeNull();
    expect(gocTheoId("envA")).toBe(path.resolve(ENV_A));
  });
});

describe("§2 — danh sách theo người gọi + chỗ đứng", () => {
  it("★★★ u8 KHÔNG thấy dự án của u7; u7 thấy; admin thấy; null chỉ thấy env", () => {
    const ids = (n: { id: number; role: string } | null) => danhSachDuAnChoNguoi(n).map((d) => d.id).sort();
    expect(ids(U8)).toEqual(["envA"]);
    expect(ids(U7)).toEqual(["envA", "u7-aaaa"]);
    expect(ids(ADMIN)).toEqual(["envA", "u7-aaaa"]);
    expect(ids(null)).toEqual(["envA"]);
  });

  it("★★★ hàng cá nhân có gốc nằm trong cây NGƯỜI KHÁC (sửa tay) ⇒ không vào ảnh chụp, không phân giải được kể cả admin", () => {
    expect(danhSachDuAn().map((d) => d.id)).not.toContain("u7-lac");
    expect(phanGiaiGoc("u7-lac", ADMIN)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
  });
});

describe("§3 — đăng ký admin không đụng cây cá nhân", () => {
  it("★★ admin đăng ký một thư mục TRONG gốc quản lý ⇒ NAM_TRONG_GOC_DA_CO", () => {
    const d = path.join(GOC_CN, "u9");
    fs.mkdirSync(d, { recursive: true });
    expect(kiemTraDangKyDuAn({ id: "adm-u9", ten: "x", duongDan: d })).toEqual({ ok: false, ma: "NAM_TRONG_GOC_DA_CO" });
  });
});
