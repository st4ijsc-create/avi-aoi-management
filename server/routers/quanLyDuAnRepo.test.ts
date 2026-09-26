/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — LƯỚI VÒNG THẬT trên CSDL: ba thủ tục admin của
 * `repoWorkspaceRouter` (`danhSachDayDu` / `themDuAn` / `xoaDuAn`) + bảng `ai_repo_du_an`
 * (mig 0337) + ảnh chụp `repoProjects`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CHẠM CSDL THẬT — cùng lý lẽ `aiCodingSessionScope.test.ts`: thứ được canh là một
 * chuỗi *mutation → hàng thật → nạp lại ảnh chụp → `danhSachDuAn()` (SYNC) thấy ngay*. Một `db`
 * giả trả mảng do lưới nạp thì "thấy ngay không cần restart" — mệnh đề ĂN TIỀN của cả màn này —
 * không được đo ở đâu cả.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Bốn hàng rào đo ở đây, mỗi cái một ĐỘT BIẾN phải bắt:
 *   §1 RBAC — non-admin ⇒ FORBIDDEN (đột biến: đổi sàn adminProcedure → protectedProcedure ⇒ ĐỎ);
 *      admin CHƯA 2FA ⇒ FORBIDDEN (sàn adminProcedure đòi 2FA — không dựng cổng mới).
 *   §2 fail-closed — mỗi đường dẫn xấu đúng MÃ, và **DB KHÔNG THÊM HÀNG** (đột biến: bỏ
 *      realpath/kiểm tồn tại trong `kiemTraDangKyDuAn` ⇒ ĐỎ vì hàng ma xuất hiện).
 *   §3 thêm xong ⇒ `danhSachDuAn()` sync thấy NGAY (đột biến: bỏ `napLaiDuAnTuDb()` sau mutation
 *      ⇒ ĐỎ); CHECK 0337 của CSDL chặn INSERT thẳng một id-là-đường-dẫn.
 *   §4 xoá — mục env từ chối (đột biến: cho xoá env ⇒ ĐỎ); mục DB xoá được, kể cả hàng MẤT GỐC
 *      (danh sách admin vẫn hiện nó với hoatDong:false — không có hàng mồ côi vĩnh viễn).
 *   §5 (2026-08-23, BỘ CHỌN THƯ MỤC) — `duyetThuMuc` qua ĐÚNG tuyến tRPC: cùng sàn admin+2FA;
 *      ổ đĩa có `C:\`; thấy đúng con trong thư mục tạm; đường xấu ⇒ `DUONG_KHONG_HOP_LE` (không
 *      ném thô); trần 500 đo bằng **501 thư mục THẬT** (rẻ: mkdirSync rỗng) + hằng/logic cắt thuần.
 *
 * ⚠ Dọn dẹp GIỚI HẠN theo tiền tố id CHÍNH FILE NÀY tạo — vitest chạy song song trên MỘT CSDL test.
 * ⚠ Dự án thử = thư mục TẠM `fs.mkdtempSync` (KHÔNG trỏ vào `sandbox-projects/`).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray, like, sql as dsql } from "drizzle-orm";

/**
 * ⚠ `LICENSE_MODULE_GATE_ENABLED=false`: ba thủ tục đứng sau `adminProcedure.use(moduleGate)` —
 *   để nguyên thì §1 xanh vì LICENSE chứ không vì RBAC (đúng lớp "xanh vì lý do sai").
 *   `AUDIT_ALL_MUTATIONS=false`: bỏ middleware audit fire-and-forget; lượt audit TƯỜNG MINH
 *   (`logCrudOperation` trong mutation) vẫn chạy — nó nuốt lỗi FK nếu userId thử không có thật.
 */
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { getDb } from "../db/connection";
import { users, aiRepoDuAn } from "../../drizzle/schema";
import { repoWorkspaceRouter } from "./repoWorkspaceRouter";
import { danhSachDuAn, gocTheoId } from "../services/aiLocalTools/repoProjects";
import { TRAN_MUC_MOI_CAP, apDungTranMuc } from "../services/aiLocalTools/duyetThuMuc";

const TAG = `qlda${Date.now().toString(36)}`; // tiền tố id: [A-Za-z0-9_-] — hợp khuôn CHECK 0337
const idThu = (s: string): string => `${TAG}-${s}`;

let GOC = "";
let idAdmin = 0;
let idEng = 0;
let coDb = false;

// adminProcedure đọc `ctx.user.role` + `ctx.user.twoFactorEnabled` — ctx dựng tay, DB chỉ cần hàng
// users THẬT cho các lượt đọc phụ (phaiDoiMatKhau của thuTucGoc với vai không miễn trừ).
const ctxFor = (id: number, role: string, twoFa: boolean) =>
  ({ user: { id, role, twoFactorEnabled: twoFa } }) as never;
const caller = (id: number, role: string, twoFa = true) =>
  repoWorkspaceRouter.createCaller(ctxFor(id, role, twoFa));

async function mkUser(tag: string, role: "engineer" | "admin"): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `qlda ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u!.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  GOC = fs.mkdtempSync(path.join(os.tmpdir(), "qlda-router-"));
  idAdmin = await mkUser("admin", "admin");
  idEng = await mkUser("eng", "engineer");
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    // GIỚI HẠN đúng vật FILE NÀY tạo (tiền tố TAG) — không quét rộng.
    await db.delete(aiRepoDuAn).where(like(aiRepoDuAn.id, `${TAG}%`));
    const ids = [idAdmin, idEng].filter((x) => x > 0);
    if (ids.length > 0) await db.delete(users).where(inArray(users.id, ids));
  }
  try { fs.rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** Đếm hàng THẬT trong bảng cho một id — "DB không thêm hàng" phải đo bằng DB, không bằng lời khai. */
async function soHang(id: string): Promise<number> {
  const db = await getDb();
  const ra = await db!.select({ n: dsql<number>`count(*)::int` }).from(aiRepoDuAn).where(eq(aiRepoDuAn.id, id));
  return Number(ra[0]?.n ?? 0);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — RBAC: sàn adminProcedure (admin + 2FA), KHÔNG cổng tự chế", () => {
  it("★★★ engineer (có 2FA) gọi themDuAn/xoaDuAn/danhSachDayDu ⇒ FORBIDDEN — server chặn, không phải client", async () => {
    if (!coDb) return;
    const c = caller(idEng, "engineer", true);
    for (const goi of [
      () => c.themDuAn({ id: idThu("rbac"), ten: "T", duongDan: GOC }),
      () => c.xoaDuAn({ id: idThu("rbac") }),
      () => c.danhSachDayDu(),
    ]) {
      await expect(goi()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await soHang(idThu("rbac")), "lượt bị chặn KHÔNG được để lại hàng").toBe(0);
  });

  it("★★★ admin CHƯA BẬT 2FA ⇒ FORBIDDEN (đòi 2FA là của sàn adminProcedure — dùng đúng khuôn có sẵn)", async () => {
    if (!coDb) return;
    // Chế độ 2FA theo triển khai (2026-08-24): sàn adminProcedure nay đọc `AUTH_2FA_BAT_BUOC` —
    // ca này khai hành vi của chế độ BẮT BUỘC nên GHIM cờ "1" trong ca (lưới không nạp `.env`,
    // nhưng lời khai không được phụ thuộc env của máy chạy). Chiều cờ "0": lưới riêng
    // `_core/cheDo2faTheoTrienKhai.test.ts`.
    const coTruoc = process.env.AUTH_2FA_BAT_BUOC;
    process.env.AUTH_2FA_BAT_BUOC = "1";
    try {
      const c = caller(idAdmin, "admin", false);
      await expect(c.themDuAn({ id: idThu("no2fa"), ten: "T", duongDan: GOC })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await soHang(idThu("no2fa"))).toBe(0);
    } finally {
      if (coTruoc === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
      else process.env.AUTH_2FA_BAT_BUOC = coTruoc;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — FAIL-CLOSED qua ĐÚNG tuyến tRPC: đúng mã, và DB KHÔNG thêm hàng", () => {
  it("★★★ tương đối · không tồn tại · là TỆP · lồng gốc đã có · thư mục cấm ⇒ đúng mã, 0 hàng", async () => {
    if (!coDb) return;
    const c = caller(idAdmin, "admin");
    const tep = path.join(GOC, "mot-tep.txt");
    fs.writeFileSync(tep, "x", "utf8");
    const cam = path.join(GOC, "node_modules", "goi");
    fs.mkdirSync(cam, { recursive: true });
    const ca: Array<[string, string, string]> = [
      [idThu("rel"), "./tuong-doi", "DUONG_DAN_KHONG_TUYET_DOI"],
      [idThu("ghost"), path.join(GOC, "khong-co-that"), "DUONG_DAN_KHONG_TON_TAI"],
      [idThu("file"), tep, "KHONG_PHAI_THU_MUC"],
      // `server/` nằm TRONG gốc hộp cát mặc định (repo) — hai hộp cát chồng lấn, phải từ chối.
      [idThu("nested"), path.resolve(process.cwd(), "server"), "NAM_TRONG_GOC_DA_CO"],
      [idThu("banned"), cam, "THU_MUC_CAM"],
    ];
    for (const [id, duongDan, ma] of ca) {
      const r = await c.themDuAn({ id, ten: "Thử", duongDan });
      expect(r, `${id} ← ${duongDan}`).toEqual({ ok: false, ma });
      expect(await soHang(id), `${id}: lượt TỪ CHỐI không được để lại hàng`).toBe(0);
    }
  });

  it("★★★ id trùng mục ENV (dự án mặc định `repo`) ⇒ TRUNG_ID — env không bao giờ bị che", async () => {
    if (!coDb) return;
    const r = await caller(idAdmin, "admin").themDuAn({ id: "repo", ten: "Chiếm chỗ", duongDan: GOC });
    expect(r).toEqual({ ok: false, ma: "TRUNG_ID" });
    expect(await soHang("repo")).toBe(0);
  });

  it("★★ CSDL TỪ CHỐI id-là-đường-dẫn ngay cả khi VÒNG QUA tRPC (CHECK 0337 — lớp cuối)", async () => {
    if (!coDb) return;
    const db = await getDb();
    await expect(
      db!.insert(aiRepoDuAn).values({ id: "D:\\SOURCES\\bi-mat", ten: "độc", goc: GOC, nguoiTao: idAdmin }),
    ).rejects.toThrow();
    await expect(
      db!.insert(aiRepoDuAn).values({ id: idThu("ten-doc"), ten: "a;b=c", goc: GOC, nguoiTao: idAdmin }),
    ).rejects.toThrow(); // CHECK tên cấm ; = (bài học dotenv)
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — THÊM: hàng thật vào bảng, và `danhSachDuAn()` SYNC thấy NGAY (không restart)", () => {
  it("★★★ vòng đầy đủ: thêm ⇒ hàng trong DB ⇒ danh sách sync có mục nguon:'db' ⇒ gocTheoId phân giải", async () => {
    if (!coDb) return;
    const id = idThu("song");
    const duAn = path.join(GOC, "du-an-song");
    fs.mkdirSync(duAn, { recursive: true });
    const c = caller(idAdmin, "admin");

    const truoc = danhSachDuAn().map((d) => d.id);
    expect(truoc, "chiều ÂM trước: chưa thêm thì chưa thấy — không có nó, ca dương tự thoả").not.toContain(id);

    const r = await c.themDuAn({ id, ten: "Dự án sống", duongDan: duAn });
    expect(r).toEqual({ ok: true, ma: null });
    expect(await soHang(id), "hàng THẬT phải nằm trong bảng").toBe(1);

    // ĐO MỆNH ĐỀ ĂN TIỀN: hàm SYNC (qua ảnh chụp) thấy ngay trong CÙNG tiến trình — không F5,
    // không restart. Đột biến "bỏ napLaiDuAnTuDb() sau mutation" phải làm ba dòng này ĐỎ.
    const muc = danhSachDuAn().find((d) => d.id === id);
    expect(muc).toMatchObject({ ten: "Dự án sống", nguon: "db", goc: fs.realpathSync(duAn) });
    expect(gocTheoId(id)).toBe(fs.realpathSync(duAn));

    // danhSachDayDu (màn admin): mục env mang nhãn env, mục mới mang nhãn db + hoatDong.
    const ds = await c.danhSachDayDu();
    expect(ds.projects.find((p) => p.id === "repo")).toMatchObject({ nguon: "env", hoatDong: true });
    expect(ds.projects.find((p) => p.id === id)).toMatchObject({ nguon: "db", hoatDong: true, goc: fs.realpathSync(duAn) });
  });

  it("★★ thêm TRÙNG id vừa thêm ⇒ TRUNG_ID (ảnh chụp đã tươi nên bắt được ngay ở phán quyết)", async () => {
    if (!coDb) return;
    const r = await caller(idAdmin, "admin").themDuAn({ id: idThu("song"), ten: "Lặp", duongDan: GOC });
    expect(r).toEqual({ ok: false, ma: "TRUNG_ID" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — XOÁ: mục env TỪ CHỐI; mục DB xoá được, kể cả hàng MẤT GỐC", () => {
  it("★★★ xoá mục env (`repo`) ⇒ MUC_ENV_KHONG_XOA_DUOC — .env chỉ sửa được bằng tay", async () => {
    if (!coDb) return;
    const r = await caller(idAdmin, "admin").xoaDuAn({ id: "repo" });
    expect(r).toEqual({ ok: false, ma: "MUC_ENV_KHONG_XOA_DUOC" });
    expect(danhSachDuAn().some((d) => d.id === "repo"), "mục env phải CÒN NGUYÊN sau lượt xoá bị chặn").toBe(true);
  });

  it("★★★ xoá mục DB ⇒ hàng biến mất + danh sách sync mất mục NGAY", async () => {
    if (!coDb) return;
    const id = idThu("song"); // mục đã thêm ở §3
    const r = await caller(idAdmin, "admin").xoaDuAn({ id });
    expect(r).toEqual({ ok: true, ma: null });
    expect(await soHang(id)).toBe(0);
    expect(danhSachDuAn().some((d) => d.id === id), "ảnh chụp phải tươi ngay sau xoá").toBe(false);
    expect(gocTheoId(id)).toBeNull();
  });

  it("★★ hàng MẤT GỐC (thư mục đã xoá trên đĩa) vẫn hiện ở danhSachDayDu với hoatDong:false và XOÁ được — không có hàng mồ côi vĩnh viễn", async () => {
    if (!coDb) return;
    const id = idThu("mo-coi");
    const duAn = path.join(GOC, "sap-mat-goc");
    fs.mkdirSync(duAn, { recursive: true });
    const c = caller(idAdmin, "admin");
    expect((await c.themDuAn({ id, ten: "Sắp mất gốc", duongDan: duAn })).ok).toBe(true);
    fs.rmSync(duAn, { recursive: true, force: true });

    expect(danhSachDuAn().some((d) => d.id === id), "selectBox KHÔNG được mở một gốc ma").toBe(false);
    const ds = await c.danhSachDayDu();
    expect(ds.projects.find((p) => p.id === id), "màn admin PHẢI còn thấy để xoá").toMatchObject({
      nguon: "db",
      hoatDong: false,
    });
    expect(await c.xoaDuAn({ id })).toEqual({ ok: true, ma: null });
    expect(await soHang(id)).toBe(0);
  });

  it("★ xoá id không tồn tại ⇒ KHONG_TIM_THAY (DB phán, không đoán)", async () => {
    if (!coDb) return;
    const r = await caller(idAdmin, "admin").xoaDuAn({ id: idThu("khong-co") });
    expect(r).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — BỘ CHỌN THƯ MỤC (`duyetThuMuc`) qua ĐÚNG tuyến tRPC: RBAC + fail-closed + trần", () => {
  it("★★★ engineer (có 2FA) VÀ admin CHƯA 2FA ⇒ FORBIDDEN — cùng sàn adminProcedure với themDuAn", async () => {
    if (!coDb) return;
    // Ghim cờ "1" cùng lý do ca no2fa ở §1: nhánh admin-chưa-2FA của ca này khai chế độ BẮT BUỘC.
    const coTruoc = process.env.AUTH_2FA_BAT_BUOC;
    process.env.AUTH_2FA_BAT_BUOC = "1";
    try {
      await expect(caller(idEng, "engineer", true).duyetThuMuc({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(idAdmin, "admin", false).duyetThuMuc({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      if (coTruoc === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
      else process.env.AUTH_2FA_BAT_BUOC = coTruoc;
    }
  });

  it("★★★ admin+2FA, KHÔNG `duong` ⇒ danh sách Ổ ĐĨA (Windows: có C:\\) — chưa đứng ở thư mục nào", async () => {
    if (!coDb) return;
    const r = await caller(idAdmin, "admin").duyetThuMuc({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duongHienTai).toBeNull();
    expect(r.duongCha).toBeNull();
    if (process.platform === "win32") {
      expect(r.muc.some((m) => /^[Cc]:\\$/.test(m.duong)), "máy Windows nào cũng phải thấy C:\\").toBe(true);
    } else {
      expect(r.muc.some((m) => m.duong === "/")).toBe(true);
    }
  });

  it("★★★ duyệt thư mục tạm ⇒ thấy ĐÚNG các con (CHỈ thư mục — tệp bị lọc) + `duongCha` cho nút lên-cấp", async () => {
    if (!coDb) return;
    const cha = path.join(GOC, "duyet-cha");
    fs.mkdirSync(path.join(cha, "con-a"), { recursive: true });
    fs.mkdirSync(path.join(cha, "con-b"), { recursive: true });
    fs.writeFileSync(path.join(cha, "mot-tep.txt"), "x", "utf8");
    const r = await caller(idAdmin, "admin").duyetThuMuc({ duong: cha });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chaThat = fs.realpathSync(cha);
    expect(r.duongHienTai).toBe(chaThat);
    expect(r.duongCha).toBe(fs.realpathSync(GOC));
    expect(r.muc.map((m) => m.ten), "tệp mot-tep.txt KHÔNG được lộ — API chỉ trả THƯ MỤC").toEqual(["con-a", "con-b"]);
    expect(r.muc.map((m) => m.duong)).toEqual([path.join(chaThat, "con-a"), path.join(chaThat, "con-b")]);
    expect(r.biCat).toBe(false);
  });

  it("★★ tương đối / không tồn tại / là TỆP ⇒ `DUONG_KHONG_HOP_LE` (fail-closed, KHÔNG ném thô)", async () => {
    if (!coDb) return;
    const c = caller(idAdmin, "admin");
    const tep = path.join(GOC, "duyet-tep.txt");
    fs.writeFileSync(tep, "x", "utf8");
    for (const duong of ["./tuong-doi", path.join(GOC, "khong-co-that-x"), tep]) {
      expect(await c.duyetThuMuc({ duong }), duong).toEqual({ ok: false, ma: "DUONG_KHONG_HOP_LE" });
    }
  });

  it("★★★ TRẦN: dựng TRAN+1 thư mục con THẬT ⇒ trả đúng TRAN mục + biCat + `tran` khai từ server", async () => {
    if (!coDb) return;
    const to = path.join(GOC, "duyet-tran");
    fs.mkdirSync(to, { recursive: true });
    for (let i = 0; i < TRAN_MUC_MOI_CAP + 1; i++) {
      fs.mkdirSync(path.join(to, `d${String(i).padStart(4, "0")}`));
    }
    try {
      const r = await caller(idAdmin, "admin").duyetThuMuc({ duong: to });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.muc.length, "chạm trần thì trả ĐÚNG trần, không tràn payload").toBe(TRAN_MUC_MOI_CAP);
      expect(r.biCat).toBe(true);
      expect(r.tran, "client hiện con số CỦA SERVER — server phải khai nó").toBe(TRAN_MUC_MOI_CAP);
    } finally {
      fs.rmSync(to, { recursive: true, force: true }); // 501 thư mục rỗng — dọn ngay cho afterAll nhẹ
    }
  });

  it("★ hằng trần đúng lời khai (500) + logic cắt THUẦN trên bảng giả (đột biến nới biên ⇒ ĐỎ)", () => {
    expect(TRAN_MUC_MOI_CAP).toBe(500);
    expect(apDungTranMuc([1, 2, 3], 3)).toEqual({ muc: [1, 2, 3], biCat: false });
    expect(apDungTranMuc([1, 2, 3, 4], 3)).toEqual({ muc: [1, 2, 3], biCat: true });
    expect(apDungTranMuc([], 3)).toEqual({ muc: [], biCat: false });
  });

  it("★ gốc Ổ ĐĨA ⇒ `duongCha` = null (lên cấp = quay về danh sách ổ đĩa)", async () => {
    if (!coDb || process.platform !== "win32") return;
    const oDia = path.parse(GOC).root; // vd "C:\\"
    const r = await caller(idAdmin, "admin").duyetThuMuc({ duong: oDia });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duongHienTai).toBe(fs.realpathSync(oDia));
    expect(r.duongCha).toBeNull();
  });
});
