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
    const c = caller(idAdmin, "admin", false);
    await expect(c.themDuAn({ id: idThu("no2fa"), ten: "T", duongDan: GOC })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await soHang(idThu("no2fa"))).toBe(0);
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
