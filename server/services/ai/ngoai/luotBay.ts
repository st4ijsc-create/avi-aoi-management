/**
 * ★ Đợt 10.4b L0a' (kế hoạch v2.1 §2 D10-ii, rà kiem-dinh 6b-3) — MỘT lượt AI NGOÀI đang bay mỗi NGƯỜI (chống xả song song).
 * Bảng `ai_ngoai_dang_bay` (migration 0418): giữ = INSERT … ON CONFLICT … WHERE hàng cũ HẾT HẠN (nguyên tử, sống qua nhiều tiến trình /
 * khởi động lại); `batDau` / `hetHan` tính trong CÙNG câu SQL từ `now()` (không đồng hồ JS — dieu-phoi duyệt SQL); thả = DELETE đúng token.
 * Tiến trình chết giữa chừng ⇒ hàng tự hết hạn sau TTL — người dùng không kẹt vĩnh viễn.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { LoiNgoai } from "./loi";

export interface DbBay {
  execute(q: ReturnType<typeof sql>): Promise<unknown>;
}

/** TTL mặc định: đủ cho một lời gọi nhà cung cấp chậm nhất (kèm thử lại) — CHECK bảng ≤ 15 phút. */
export const TTL_LUOT_BAY_GIAY = 600;

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

/** Giữ lượt bay của `userId`; đang có lượt CÒN HẠN ⇒ `NGOAI_DANG_CHAY` (409). Trả token để thả. */
export async function giuLuotBay(db: DbBay, userId: number, factoryId: number, ttlGiay = TTL_LUOT_BAY_GIAY): Promise<string> {
  const token = randomUUID();
  let r: Array<Record<string, unknown>>;
  try {
    r = hang(
      await db.execute(sql`
        INSERT INTO ai_ngoai_dang_bay ("userId", "factoryId", token, "batDau", "hetHan")
        VALUES (${userId}, ${factoryId}, ${token}, now(), now() + make_interval(secs => ${ttlGiay}))
        ON CONFLICT ("userId") DO UPDATE
          SET token = EXCLUDED.token, "factoryId" = EXCLUDED."factoryId", "batDau" = now(), "hetHan" = now() + make_interval(secs => ${ttlGiay})
          WHERE ai_ngoai_dang_bay."hetHan" < now()
        RETURNING token`),
    );
  } catch {
    throw new LoiNgoai("NGOAI_DEM_HONG", "luot-bay");
  }
  if (r.length !== 1) throw new LoiNgoai("NGOAI_DANG_CHAY", "nguoi");
  return token;
}

/** Thả — chỉ khi hàng còn là của token này (lượt khác đã chiếm sau khi ta hết hạn thì không xoá nhầm). Lỗi ⇒ nuốt (TTL dọn). */
export async function thaLuotBay(db: DbBay, userId: number, token: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM ai_ngoai_dang_bay WHERE "userId" = ${userId} AND token = ${token}`);
  } catch {
    /* TTL tự dọn */
  }
}
