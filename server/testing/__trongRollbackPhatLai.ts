/**
 * MỘT vỏ giao dịch ROLLBACK duy nhất cho mọi ca phát lại chạm sổ (tên `__*.ts` = bộ dựng lưới, đúng quy ước của `permissionsDonCacheCensus` (3)) (`phatLaiFixture.test.ts`, `phatLaiLuot.test.ts`, `phatLaiFixture.epDo.db.test.ts`): ba tệp KHÔNG tự dựng vỏ (khoá AST ở `trongRollbackPhatLai.test.ts`).
 * Việc của vỏ: mở giao dịch trên kết nối THẬT (lấy bằng `vi.importActual` — trong tệp test `../db/connection` bị mock), đặt `kenh.db = tx`, tạo người dùng thử CHỈ trong giao dịch, chạy thân ca,
 * rồi trong `finally` — TRƯỚC khi trả kênh về `null` — đếm rò rỉ theo userId (`ghiNhanRoRi`, cả khi thân ca ném); cuối giao dịch luôn `throw new RollbackPhatLai()` ⇒ ROLLBACK.
 * Ngoài giao dịch, `catch` chỉ nuốt `RollbackPhatLai` (`nuotRollback`): lỗi của thân ca (expect hỏng, lỗi lượt chạy) LAN RA ⇒ ca ĐỎ, không bị nuốt.
 * `vi.mock("../db/connection", …)` phải ở lại từng tệp test (vitest kéo nó lên đầu tệp), nhưng chỉ có ba dòng: `getDb` ⇒ `layDbTheoKenh(kenh)`, bốn hàm kết nối khác ⇒ `ghiNoiKhac`.
 * KHÔNG DELETE / TRUNCATE. `tuyChon` chỉ để kiểm vỏ bằng CSDL giả (`trongRollbackPhatLai.test.ts`).
 */
import { vi } from "vitest";
import { users } from "../../drizzle/schema";
import type { getDb } from "../db/connection";
import { LoiKhungThu, RollbackPhatLai, nuotRollback, type KenhGiaoDich } from "./kenhGiaoDich";
import { ghiNhanRoRi, type HangRoRi } from "./kiemRoRiDb";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type GiaoDichPhatLai = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface BoiCanhRollback {
  /** giao dịch của ca (cũng là `kenh.db` suốt thân ca) */
  tx: GiaoDichPhatLai;
  /** người dùng thử — chỉ tồn tại trong giao dịch */
  userId: number;
}

export interface TuyChonVo {
  /** lấy CSDL THẬT; mặc định `vi.importActual("../db/connection").getDb()` (bản không bị mock) */
  layDb?: () => Promise<unknown>;
  /** bộ đếm rò rỉ; mặc định `demHangRoRi` qua kết nối riêng */
  dem?: (userId: number) => Promise<HangRoRi>;
}

export async function trongRollbackPhatLai(kenh: KenhGiaoDich, tenNguoi: string, than: (b: BoiCanhRollback) => Promise<void>, tuyChon: TuyChonVo = {}): Promise<void> {
  const dbThat = (await (tuyChon.layDb ?? (async () => (await vi.importActual<typeof import("../db/connection")>("../db/connection")).getDb()))()) as Db | null;
  if (!dbThat) throw new LoiKhungThu("THIEU_CSDL_TEST", "cần CSDL _test (DATABASE_URL)");
  try {
    await dbThat.transaction(async (tx) => {
      kenh.db = tx;
      let nguoiId: number | null = null;
      try {
        const ten = `${tenNguoi}_${process.pid}_${Date.now()}`;
        const [nguoi] = await tx.insert(users).values({ openId: ten, username: ten, name: `người dùng thử ${tenNguoi}`, role: "admin", loginMethod: "local" }).returning({ id: users.id });
        nguoiId = nguoi!.id;
        await than({ tx, userId: nguoiId });
      } finally {
        if (nguoiId !== null) await ghiNhanRoRi(kenh, nguoiId, tuyChon.dem);
        kenh.db = null;
        // census permissionsDonCache: nơi ghi `users` phải dọn auth cache — cache là của TIẾN TRÌNH, ROLLBACK DB không hoàn tác nó.
        if (nguoiId !== null) await (await import("../services/authSessionCache")).invalidateAuthUser(nguoiId);
      }
      throw new RollbackPhatLai();
    });
  } catch (e) {
    nuotRollback(e);
  }
}
