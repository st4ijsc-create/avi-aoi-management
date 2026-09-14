/**
 * §9.2 — ĐO CỔNG QUYỀN CỦA `user.assignableTechnicians` BẰNG VAI KHÔNG-ADMIN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NỢ ĐƯỢC ĐÓNG
 * ══════════════════════════════════════════════════════════════════════════════
 * Dropdown "Gán kỹ thuật viên" của `NganXuLy` gọi `user.list`, là thủ tục
 * **ADMIN-ONLY**. Nghĩa là nó **RỖNG với MỌI tài khoản không phải admin** — tức
 * với đúng những vai mà tính năng ấy sinh ra để phục vụ. QA trước tái hiện bằng
 * admin nên không thấy, vì `checkPermission` có
 * `if (isAdmin && !scopedAdminEnabled()) return true` — **admin BYPASS mọi
 * `requirePermission`**, nên một phép đo chạy bằng admin chứng minh ĐÚNG SỐ 0.
 * Ô rỗng vì bị chặn trông y hệt ô rỗng vì "chưa có ai để gán".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI NÀY **SEED USER RIÊNG** THAY VÌ DÙNG `engineer1`/`operator1`
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐO ĐƯỢC 2026-09-07, và nó suýt làm cả lưới này XANH GIẢ: `vitest.setup.ts`
 * **ép `DATABASE_URL` sang một DB CLONE riêng** (`aoi_management_test`). Trong
 * DB ấy, `SELECT ... FROM users WHERE username IN ('engineer1','operator1', …)`
 * trả **0 hàng** — bốn tài khoản thật CHỈ tồn tại ở DB dev. Bản viết đầu của
 * lưới này ghim id 48/51 và ca "cầu chì" ĐỎ với `expected undefined to be
 * truthy`, trong khi **4 ca còn lại vẫn XANH** — tức chúng xanh mà không hề
 * chạm tới thứ định đo.
 *
 * ⇒ Lưới tự dựng hai user mang **ĐÚNG hình dạng quyền đã đo trên dev**, nên nó
 *   chạy được ở mọi môi trường (G23: cùng con số phải đúng ở cả hai nơi):
 *     operator1  (48)  machine_status  canView=t canCreate=f  ⇒ PHẢI bị chặn
 *     engineer1  (51)  machine_status  canView=t canCreate=t  ⇒ PHẢI lấy được
 *   Hai hàng ấy là thứ làm lưới có nghĩa: nếu cả hai cùng có (hoặc cùng không
 *   có) `canCreate` thì hai ca dưới không phân biệt được gì (G5).
 *
 * ★ Phép đo trên CHÍNH `engineer1`/`operator1` được làm RIÊNG, sống, trên DB
 *   dev — xem báo cáo đóng nợ. Lưới này là nửa ghim-hồi-quy của cùng một câu.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ G21 — "ĐỊNH TUYẾN" KHÔNG PHẢI "PHÂN QUYỀN"
 * ══════════════════════════════════════════════════════════════════════════════
 * Dòng mã kiểm quyền của NGƯỜI NHẬN là
 * `.use(requirePermission(MODULE_PHIEU, "canCreate"))` trong `userRouters.ts`.
 * Lưới gọi THẲNG router (không qua HTTP) nên nó đo đúng dòng ấy, chứ không đo
 * một phép nhóm theo thuộc tính dữ liệu nào.
 *
 * ⚠ ĐÍNH CHÍNH SPEC: §6.4 ghi *"canCreate trên module maintenance"* — tên đó
 *   KHÔNG có trong `PERMISSION_MODULES`. Module THẬT là `machine_monitoring`
 *   (`maintenanceRouter.ts:35`), alias về `machine_status`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users, permissions } from "../../drizzle/schema";
import { userRouter } from "./userRouters";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const TAG = `GANKTV_${Date.now().toString(36).toUpperCase()}`;

/** Hình dạng quyền CỦA `engineer1` (51) — có `canCreate`. */
let idNhuEngineer = 0;
/** Hình dạng quyền CỦA `operator1` (48) — KHÔNG có `canCreate`. */
let idNhuOperator = 0;
/** Tài khoản `isActive = false`, để ca T-4 có tập phân biệt. */
let idVoHieuHoa = 0;

function ctxFor(userId: number, role: string): TrpcContext {
  return {
    user: { id: userId, role, name: `${TAG}-${userId}` } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
/** ⚠ `role` KHÔNG BAO GIỜ là `admin` — admin bypass sẽ làm mọi ca xanh giả. */
const caller = (userId: number, role = "operator") => userRouter.createCaller(ctxFor(userId, role));

async function mkUser(tag: string, opts: { canCreate: boolean; isActive?: boolean }): Promise<number> {
  const db = (await getDb())!;
  const [u] = await db
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `GanKTV ${tag}`,
      role: "operator",
      loginMethod: "local",
      isActive: opts.isActive ?? true,
    })
    .returning({ id: users.id });
  await db.insert(permissions).values({
    userId: u!.id,
    category: "machine_monitoring",
    /*
     * ★★★ SEED PHẢI GHI `machine_status`, KHÔNG PHẢI `machine_monitoring`.
     *
     * ⚠ Bản viết đầu ghi `machine_monitoring` (chuỗi mà router KHAI) và 3/5 ca
     *   ĐỎ với *"Bạn không có quyền create cho module machine_monitoring"* —
     *   trong khi hàng `permissions` có `canCreate = t` và ca cầu chì XANH.
     *   Lý do: `checkPermission` query bằng `resolvePermissionModule(moduleName)`
     *   (`accessControl.ts:214,221`), tức nó tìm hàng `machine_status`. Chuỗi ở
     *   ĐIỂM GỌI được alias, chuỗi trong BẢNG thì không.
     * ⇒ Đây cũng đúng hình dạng dữ liệu THẬT: đo trên dev, cả 4 tài khoản
     *   non-admin đều mang `moduleName = 'machine_status'`, không ai mang
     *   `machine_monitoring`. Seed lệch với dữ liệu thật là seed đo nhầm thế giới.
     */
    moduleName: "machine_status",
    canView: true,
    canCreate: opts.canCreate,
    canEdit: false,
    canDelete: false,
    canExport: false,
  });
  return u!.id;
}

describe.skipIf(!DB_URL)("§9.2 — `user.assignableTechnicians`: cổng quyền đo bằng vai KHÔNG-admin", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    idNhuEngineer = await mkUser("nhu-engineer", { canCreate: true });
    idNhuOperator = await mkUser("nhu-operator", { canCreate: false });
    idVoHieuHoa = await mkUser("vo-hieu-hoa", { canCreate: false, isActive: false });
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    const ids = [idNhuEngineer, idNhuOperator, idVoHieuHoa].filter((x) => x > 0);
    if (ids.length > 0) {
      await db.delete(permissions).where(inArray(permissions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  it("cầu chì: hai user đo PHẢI khác nhau ĐÚNG ở `canCreate`, và KHÔNG ai là admin", async () => {
    /*
     * Không có cầu chì này, hai ca dưới có thể cùng xanh vì một lý do KHÔNG
     * PHẢI thứ ta định đo (seed hỏng, vai bị nâng, alias đổi…).
     */
    const db = (await getDb())!;
    const doQuyen = async (id: number) => {
      const [h] = await db
        .select({ canCreate: permissions.canCreate })
        .from(permissions)
        .where(eq(permissions.userId, id));
      return h?.canCreate ?? false;
    };
    const vai = async (id: number) => {
      const [h] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
      return h?.role;
    };
    expect(await doQuyen(idNhuEngineer), "user kiểu engineer1 phải CÓ canCreate").toBe(true);
    expect(await doQuyen(idNhuOperator), "user kiểu operator1 phải KHÔNG có canCreate").toBe(false);
    expect(await vai(idNhuEngineer)).not.toBe("admin");
    expect(await vai(idNhuOperator)).not.toBe("admin");
  });

  it("★★★ vai KHÔNG-admin CÓ `canCreate` LẤY ĐƯỢC danh sách — chính cái nợ được đóng", async () => {
    const ds = await caller(idNhuEngineer).assignableTechnicians();
    expect(Array.isArray(ds)).toBe(true);
    // Rỗng thì lưới không chứng minh gì — rỗng ĐÚNG LÀ triệu chứng của lỗi cũ.
    expect(ds.length, "danh sách PHẢI có người — rỗng trông y hệt lỗi cũ").toBeGreaterThan(0);
  });

  it("★★★ ĐỐI CHỨNG — vai KHÔNG-admin THIẾU `canCreate` bị chặn FORBIDDEN", async () => {
    /*
     * Không có ca này, ca trên không chứng minh cổng CÓ TỒN TẠI: một
     * `protectedProcedure` TRẦN cũng cho user kia qua y hệt.
     */
    await expect(caller(idNhuOperator).assignableTechnicians()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("★★★ CHỈ trả `{id, name}` — KHÔNG email/vai/hash/gì khác (lộ dữ liệu nhân sự)", async () => {
    const ds = await caller(idNhuEngineer).assignableTechnicians();
    for (const u of ds) {
      // Khoá ĐÚNG BẰNG tập {id, name} — thừa một khoá là ĐỎ, kể cả khoá vô hại.
      expect(Object.keys(u).sort()).toEqual(["id", "name"]);
    }
    const gop = JSON.stringify(ds);
    for (const cam of ["passwordHash", "twoFactorSecret", "email", "role", "username", "openId"]) {
      expect(gop, `truong "${cam}" KHONG duoc roi may chu qua thu tuc nay`).not.toContain(cam);
    }
  });

  it("★★★ KHÔNG chứa tài khoản `isActive = false` (T-4: phiếu gán cho người đã nghỉ)", async () => {
    const db = (await getDb())!;
    const tatCa = await db.select({ id: users.id, isActive: users.isActive }).from(users);
    const idVoHieu = new Set(tatCa.filter((u) => u.isActive === false).map((u) => u.id));

    // Cầu chì: phải CÓ tài khoản vô hiệu hoá (lưới tự dựng 1), nếu không ca này
    // đo trên tập rỗng và sẽ xanh kể cả khi bộ lọc `isActive` bị gỡ hẳn (G5).
    expect(idVoHieu.size, "phải có ít nhất 1 tài khoản isActive=false").toBeGreaterThan(0);
    expect(idVoHieu.has(idVoHieuHoa), "user vô hiệu hoá của lưới phải nằm trong tập ấy").toBe(true);

    const ds = await caller(idNhuEngineer).assignableTechnicians();
    // Neu DICH DANH hang luoi tu dung — cau loi chi thang vao ca hong.
    expect(ds.map((u) => u.id), "user isActive=false KHONG duoc vao danh sach gan").not.toContain(idVoHieuHoa);
    for (const u of ds) {
      expect(idVoHieu.has(u.id), `user ${u.id} da vo hieu hoa ma van nam trong danh sach gan`).toBe(false);
    }
    // …và đối chiếu TỔNG: số trả về phải bằng số tài khoản đang hoạt động.
    const soHoatDong = tatCa.filter((u) => u.isActive !== false).length;
    expect(ds.length, "danh sách phải phủ ĐÚNG tập đang hoạt động").toBe(soHoatDong);
  });
});
