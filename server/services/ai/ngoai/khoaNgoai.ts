/**
 * ★ Đợt 10.3 B3 — KHOÁ AI ngoài theo nhà máy. Khoá chỉ được GIẢI MÃ bên trong nhà cung cấp, qua THUNK gọi ngay trước khi gửi; thunk đọc
 * TƯƠI mỗi lần (không đệm) ⇒ xoay khoá giữa hai lần thử lại thì lần sau dùng khoá mới, thu hồi thì lần sau bị từ chối.
 * Khoá của nhà máy khác / không `active` / không phải bản mã `enc:v1:` (legacy) / giải mã hỏng ⇒ `NGOAI_KHOA_KHONG_HOP_LE`.
 * Thủ tục quản trị tạo / xoay / thu hồi: Task 7.
 */
import { sql } from "drizzle-orm";
import { decryptSecret, isEncrypted } from "../../security/secretBox";
import type { DbDoc } from "./cauHinhNgoai";
import { LoiNgoai } from "./loi";

const hang = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

export function layKhoaChoNhaCungCap(db: DbDoc, keyId: number, factoryId: number): () => Promise<string> {
  return async () => {
    const [r] = hang(await db.execute(sql`SELECT "encryptedKey", status, "factoryId" FROM ai_api_keys WHERE id = ${keyId}`));
    if (!r || Number(r.factoryId) !== factoryId || r.status !== "active") throw new LoiNgoai("NGOAI_KHOA_KHONG_HOP_LE", "", { chuaGui: true });
    const ma = String(r.encryptedKey ?? "");
    if (!isEncrypted(ma)) throw new LoiNgoai("NGOAI_KHOA_KHONG_HOP_LE", "legacy", { chuaGui: true });
    const khoa = decryptSecret(ma);
    if (!khoa) throw new LoiNgoai("NGOAI_KHOA_KHONG_HOP_LE", "giai-ma", { chuaGui: true });
    return khoa;
  };
}

/** `endpoint` của khoá (chỉ cho `openai_compat`); đọc tươi. */
export async function layEndpointKhoa(db: DbDoc, keyId: number): Promise<string | null> {
  const [r] = hang(await db.execute(sql`SELECT endpoint FROM ai_api_keys WHERE id = ${keyId}`));
  return typeof r?.endpoint === "string" && r.endpoint ? r.endpoint : null;
}
