/**
 * ÉP MỘT CA ĐỎ và đo RÒ RỈ: phát lại một fixture THẬT nhưng cố ý làm LỆCH một lượt SAU lượt đầu tiên có đề xuất ghi tệp (`edit_file` / `write_file` / `apply_diff`), rồi khẳng định — bằng một KẾT NỐI RIÊNG —
 * không còn hàng `audit_logs` / `ai_pending_actions` nào mang userId của người dùng thử (người dùng chỉ tồn tại trong giao dịch ROLLBACK; hai bảng đó KHÔNG có khoá ngoại tới `users`).
 * Bối cảnh đo thật 16/11: bản cổng chạy SAI cwd cho 6/6 ca đỏ và để lại 6 cặp audit + pending (`ai_action_proposed`, `ai_action_denied`; `apply_diff` `proposed`) mang đúng userId người dùng thử đã rollback.
 * Ca này phải ĐỎ trên mã còn lỗ rò và XANH khi không còn lỗ. Đếm THEO userId người dùng thử (không đếm tổng bảng ⇒ không bị phiên khác làm nhiễu).
 * CSDL: chỉ `aoi_management_test` (skipIf). Mọi ghi nằm trong giao dịch ROLLBACK; kết nối đếm chỉ SELECT. Không DELETE / TRUNCATE.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, count, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { congCheckpointThat, taoQuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { taoGoiModelMayChu } from "../services/ai/agent/goiModelMayChu";
import { auditLogs, permissions, users } from "../../drizzle/schema";
import { banCoKhiPhatLai } from "./coAnhHuongByte";
import { RollbackPhatLai, ghiNoiKhac, kiemKhongLot, layDbTheoKenh, nuotRollback, tomTatGoi, type KenhGiaoDich } from "./kenhGiaoDich";
import { cauBaoRoRi, demHangRoRi } from "./kiemRoRiDb";
import { donDuAnTam, dungDuAn } from "./phatLaiDuAn";
import { taoStreamPhatLai, TOKEN_GOC, type FixturePhatLai } from "./phatLaiLuot";

const co = /aoi_management_test/.test(process.env.DATABASE_URL ?? "");
const THU_MUC = path.join(__dirname, "fixtures", "phat-lai");
const FIXTURE = "ts-gio-hang-8be2acc5.json.gz";
const ENV0 = { ...process.env };
const CO_CO_DINH_KHUNG_THU = { AI_AGENT_THEO_VAI_TRO: "0", AI_CODING_TU_TRI_GHI: "1" } as const;

const kenh = vi.hoisted((): KenhGiaoDich => ({ db: null, lot: [], goi: {} }));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return {
    ...goc,
    getDb: async () => layDbTheoKenh(kenh),
    getJobsDb: async () => ghiNoiKhac(kenh, "getJobsDb"),
    getReadDb: async () => ghiNoiKhac(kenh, "getReadDb"),
    openSessionClient: () => ghiNoiKhac(kenh, "openSessionClient"),
    getNotifyClient: () => ghiNoiKhac(kenh, "getNotifyClient"),
  };
});

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY ??= "khoa-thu-phat-lai-0123456789";
  process.env.AI_AGENT_THEO_VAI_TRO = "0";
  process.env.AI_CODING_TU_TRI_GHI = "1";
  delete process.env.AI_GHI_LUOT_DIR;
});
afterEach(() => {
  kenh.lot.splice(0);
  kenh.goi = {};
});
afterAll(() => {
  for (const k of ["AI_AGENT_THEO_VAI_TRO", "AI_CODING_TU_TRI_GHI", "AI_REPO_SANDBOX_ROOTS", "SECRET_ENCRYPTION_KEY"]) {
    if (ENV0[k] === undefined) delete process.env[k];
    else process.env[k] = ENV0[k];
  }
  donDuAnTam();
});

/** Fixture thật, làm LỆCH tin đầu tiên của lượt NGAY SAU lượt đầu tiên có lời gọi ghi tệp. Trả chỉ số lượt bị làm lệch. */
function napFixtureLech(): { fx: FixturePhatLai; luotLech: number } {
  const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(THU_MUC, FIXTURE))).toString("utf8")) as FixturePhatLai;
  const idx = fx.luot.findIndex((l) => /edit_file|write_file|apply_diff/.test(JSON.stringify(l.manh)));
  if (idx < 0 || !fx.luot[idx + 1]) throw new Error("fixture không có lượt ghi tệp theo sau bởi một lượt nữa");
  const tin = fx.luot[idx + 1]!.yeuCau.tinMoi[0] as { content?: string };
  tin.content = `${tin.content ?? ""}\n[CỐ Ý LÀM LỆCH — ca ép đỏ]`;
  return { fx, luotLech: idx + 1 };
}

interface KetQuaEp {
  uid: number;
  lech: number;
  luotDaRut: number;
  roTruocRollback: Awaited<ReturnType<typeof demHangRoRi>>;
  /** số hàng audit_logs `ai_action_denied` mang userId người dùng thử, đếm TRONG giao dịch (chứng minh đường từ chối đã chạy thật) */
  daTuChoi: number;
  /** số hàng audit_logs `ai_action_proposed` mang userId thử, đếm TRONG giao dịch (cặp proposed → denied) */
  daDeXuat: number;
}

/**
 * `lech`: chỉ làm lệch một lượt (người gọi `admin`, ghi tệp được ĐỀ XUẤT rồi tự duyệt).
 * `tu-choi-apply-diff`: thêm — tái hiện đúng kiểu rò sáng 16/11 (cặp `ai_action_proposed` → `ai_action_denied` + hàng `ai_pending_actions` của `apply_diff`):
 * người gọi là vai `operator` có hàng quyền `ai_repo_read` (canView + canEdit) và `ai_repo_exec` ⇒ lượt chạy được và ĐỀ XUẤT được; rồi cổng checkpoint (tiêm) THU HỒI `canEdit` ngay trước bước duyệt
 * ⇒ `confirmAction` bị từ chối ở RBAC lần 2 (`MISSING_PERMISSION`, stage execute): audit denied mang userId người dùng thử, hàng pending chuyển `denied`.
 * `edit_file` / `write_file` đều đi qua `apply_diff`; `apply_diff` được MIỄN phạm vi nhà máy nên không dùng được `OUT_OF_SCOPE`. Chỉ UPDATE trong giao dịch ROLLBACK, không DELETE.
 */
type KieuEp = "lech" | "tu-choi-apply-diff";

/** Chạy fixture lệch trong giao dịch ROLLBACK (đúng vỏ của phatLaiFixture.test.ts); `nemLoi` ⇒ ném MỘT lỗi trong thân (mô phỏng `expect` hỏng). Kết quả ghi vào `kq` (có cả khi ném). */
async function epDo(nemLoi: string | null, kq: Partial<KetQuaEp> = {}, kieu: KieuEp = "lech"): Promise<KetQuaEp> {
  const { fx } = napFixtureLech();
  const dbThat = await (await vi.importActual<typeof import("../db/connection")>("../db/connection")).getDb();
  if (!dbThat) throw new Error("cần CSDL _test");
  try {
    await dbThat.transaction(async (tx) => {
      kenh.db = tx;
      try {
        const [nguoi] = await tx
          .insert(users)
          .values({ openId: `phatlaifx_epdo_${process.pid}_${Date.now()}`, username: `phatlaifx_epdo_${process.pid}_${Date.now()}`, name: "người dùng ép đỏ", role: "admin", loginMethod: "local" })
          .returning({ id: users.id });
        kq.uid = nguoi!.id;
        const goc = dungDuAn(fx);
        const ban = banCoKhiPhatLai(fx.lenh.moiTruong, CO_CO_DINH_KHUNG_THU);
        const env0 = Object.fromEntries([...Object.keys(ban.dat), ...ban.xoa].map((k) => [k, process.env[k]]));
        Object.assign(process.env, ban.dat);
        for (const k of ban.xoa) delete process.env[k];
        try {
          process.env.AI_REPO_SANDBOX_ROOTS = `phatlaifx=Phat lai fixture|${goc}`;
          const p = taoStreamPhatLai(fx, { goc });
          const tuChoi = kieu === "tu-choi-apply-diff";
          const uidNguoi = kq.uid;
          if (tuChoi) {
            for (const [mod, quyen] of [["ai_repo_read", { canView: true, canEdit: true }], ["ai_repo_exec", { canView: true, canCreate: true }]] as const) {
              await tx.insert(permissions).values({ userId: uidNguoi, category: "dashboard", moduleName: mod, ...quyen });
            }
          }
          const ql = taoQuanLyLuotChay({
            goiModel: taoGoiModelMayChu({ chatStream: p.stream, khongGhiDauVet: true }),
            ...(tuChoi
              ? {
                  checkpoint: (userId: number) => {
                    const that = congCheckpointThat(userId);
                    return {
                      chupTruocGhi: async (y: Parameters<typeof that.chupTruocGhi>[0]) => {
                        // đề xuất ĐÃ qua RBAC lần 1; thu hồi quyền ghi NGAY TRƯỚC bước duyệt ⇒ RBAC lần 2 từ chối
                        await tx.update(permissions).set({ canEdit: false }).where(and(eq(permissions.userId, uidNguoi), eq(permissions.moduleName, "ai_repo_read")));
                        return that.chupTruocGhi(y);
                      },
                      chotSauGhi: that.chotSauGhi,
                    };
                  },
                }
              : {}),
          });
          const lk = await ql.taoLuotChay({ user: { id: kq.uid, role: tuChoi ? "operator" : "admin" }, cauHoi: fx.lenh.cauHoi.split(TOKEN_GOC).join(goc), projectId: "phatlaifx", cheDo: fx.lenh.cheDo });
          if (!lk.ok) throw new Error(`${lk.ma} ${lk.thongDiep ?? ""}`);
          await lk.luot.xong;
          kq.lech = p.lech.length;
          kq.luotDaRut = fx.luot.length - p.conLai();
          if (nemLoi !== null) throw new Error(nemLoi); // mô phỏng một expect hỏng GIỮA giao dịch
        } finally {
          for (const [k, v] of Object.entries(env0)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        }
      } finally {
        if (kq.uid !== undefined) {
          const [d] = await tx.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.userId, kq.uid), eq(auditLogs.action, "ai_action_denied")));
          kq.daTuChoi = Number(d?.n ?? 0);
          const [dx] = await tx.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.userId, kq.uid), eq(auditLogs.action, "ai_action_proposed")));
          kq.daDeXuat = Number(dx?.n ?? 0);
        }
        kq.roTruocRollback = await demHangRoRi(kq.uid!);
        kenh.db = null;
      }
      throw new RollbackPhatLai();
    });
  } catch (e) {
    nuotRollback(e);
  }
  return kq as KetQuaEp;
}

describe.skipIf(!co)("phát lại — ép một ca ĐỎ: KHÔNG rò hàng ra ngoài giao dịch ROLLBACK", () => {
  it("★★★ lệch cố ý SAU lượt đề xuất ghi tệp: ca thật sự đỏ (lệch > 0, đã qua lượt ghi) và KHÔNG hàng audit_logs / ai_pending_actions nào mang userId người dùng thử — trước lẫn sau ROLLBACK; kênh không ghi nhận lời gọi lọt", async () => {
    const { luotLech } = napFixtureLech();
    const k = await epDo(null);
    expect(k.lech, "ca phải ĐỎ thật (có lệch)").toBeGreaterThan(0);
    expect(k.luotDaRut, "phải đã rút qua lượt có đề xuất ghi tệp").toBeGreaterThanOrEqual(luotLech);
    const sau = await demHangRoRi(k.uid);
    const thongTin = `ai đã gọi getDb qua kênh: ${tomTatGoi(kenh)}; lot: ${kenh.lot.join(" | ").slice(0, 400)}`;
    expect(k.roTruocRollback, `RÒ trước rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    expect(sau, `RÒ sau rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    kiemKhongLot(kenh);
  }, 300_000);

  it("★★★ một `expect` hỏng GIỮA giao dịch (lỗi ném ra khỏi thân) ⇒ lỗi LAN RA ngoài (ca đỏ, không bị nuốt), vẫn KHÔNG rò hàng nào trước lẫn sau ROLLBACK", async () => {
    const kq: Partial<KetQuaEp> = {};
    await expect(epDo("ca đỏ cố ý giữa giao dịch", kq)).rejects.toThrow("ca đỏ cố ý giữa giao dịch");
    expect(kq.uid, "người dùng thử phải đã được tạo trong giao dịch").toBeGreaterThan(0);
    const sau = await demHangRoRi(kq.uid!);
    const thongTin = `ai đã gọi getDb qua kênh: ${tomTatGoi(kenh)}; lot: ${kenh.lot.join(" | ").slice(0, 400)}`;
    expect(kq.roTruocRollback, `RÒ trước rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    expect(sau, `RÒ sau rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    kiemKhongLot(kenh);
  }, 300_000);

  it("★★★ ép lượt GHI TỆP bị TỪ CHỐI (`edit_file` / `write_file` đều đi qua `apply_diff`; người gọi thiếu quyền ghi ⇒ `proposeAction` MISSING_PERMISSION): đường từ chối đã chạy thật (có hàng `ai_action_denied` trong giao dịch) và KHÔNG hàng audit_logs / ai_pending_actions nào mang userId người dùng thử rò ra ngoài — trước lẫn sau ROLLBACK", async () => {
    const k = await epDo(null, {}, "tu-choi-apply-diff");
    expect(k.daDeXuat, "phải đã ĐỀ XUẤT (cặp proposed → denied)").toBeGreaterThan(0);
    expect(k.daTuChoi, "đường từ chối PHẢI đã chạy (nếu 0 ⇒ ca không ép được từ chối, không phải bằng chứng không rò)").toBeGreaterThan(0);
    const sau = await demHangRoRi(k.uid);
    const thongTin = `ai đã gọi getDb qua kênh: ${tomTatGoi(kenh)}; lot: ${kenh.lot.join(" | ").slice(0, 400)}`;
    expect(k.roTruocRollback, `RÒ trước rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    expect(sau, `RÒ sau rollback — ${thongTin}`).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    kiemKhongLot(kenh);
  }, 300_000);
});
