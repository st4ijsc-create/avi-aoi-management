/**
 * ★ AI Local Đợt 5.2 — SỔ của lượt eval mã (`kb_eval_ma_runs`, mig 0397). Người ghi/đọc DUY NHẤT của bảng; logic ở
 * `kbStudioEvalMa.ts`. Mốc giờ ghi bằng `now()` phía SQL (cột `timestamptz`). Bảng vắng (chưa migrate) ⇒ `tao` NÉM (lượt
 * không bắt đầu — một lượt không có sổ là một con số không ai đọc lại được); các lượt ghi giữa chừng nuốt lỗi.
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { kbEvalMaRuns } from "../../drizzle/schema";
import type { HangEvalMa, KetQuaLuotMa, SoEvalMa } from "./kbStudioEvalMa";

export class KbEvalMaBangVangError extends Error {
  constructor() {
    super('kb_eval_ma_runs chưa migrate (chạy "node scripts/apply-migration-0397.mjs --dev-only" bằng owner "aoi").');
    this.name = "KbEvalMaBangVangError";
  }
}

const iso = (d: unknown) => (d == null ? null : (d instanceof Date ? d : new Date(String(d))).toISOString());

export const soEvalMaThat: SoEvalMa = {
  async tao(h) {
    const db = await getDb();
    if (!db) throw new KbEvalMaBangVangError();
    try {
      await db.insert(kbEvalMaRuns).values({
        id: h.id,
        corpus: h.corpus,
        boBai: h.boBai,
        boBaiHash: h.boBaiHash,
        trangThai: "dang-chay",
        soBai: h.soBai,
        soLap: h.soLap,
        tienTrinh: h.tienTrinh,
        createdBy: h.createdBy,
      });
    } catch (e) {
      const { isMissingTable } = await import("../_core/dbErrors");
      if (isMissingTable(e)) throw new KbEvalMaBangVangError();
      throw e;
    }
  },

  async tienDo(id, tienDo, ketQua) {
    const db = await getDb();
    if (!db) return;
    await db
      .update(kbEvalMaRuns)
      .set({ tienDo: Math.max(0, Math.min(99, tienDo)), ketQua, capNhat: sql`now()` })
      .where(eq(kbEvalMaRuns.id, id));
  },

  async ket(id, k) {
    const db = await getDb();
    if (!db) return;
    await db
      .update(kbEvalMaRuns)
      .set({
        trangThai: k.trangThai,
        tongHop: k.tongHop,
        ketQua: k.ketQua,
        lyDo: k.lyDo ? k.lyDo.slice(0, 1000) : null,
        tienDo: Math.max(0, Math.min(100, k.tienDo)),
        ketThuc: sql`now()`,
        capNhat: sql`now()`,
      })
      .where(eq(kbEvalMaRuns.id, id));
  },

  async danhSach(corpus, gioiHan) {
    const db = await getDb();
    if (!db) return [];
    try {
      const rows = await db
        .select()
        .from(kbEvalMaRuns)
        .where(eq(kbEvalMaRuns.corpus, corpus))
        .orderBy(desc(kbEvalMaRuns.batDau))
        .limit(gioiHan);
      return rows.map(
        (r): HangEvalMa => ({
          id: r.id,
          corpus: r.corpus,
          boBai: r.boBai,
          boBaiHash: r.boBaiHash,
          trangThai: r.trangThai,
          tienDo: r.tienDo,
          soBai: r.soBai,
          soLap: r.soLap,
          tongHop: r.tongHop ?? null,
          ketQua: (Array.isArray(r.ketQua) ? r.ketQua : []) as KetQuaLuotMa[],
          lyDo: r.lyDo ?? null,
          tienTrinh: r.tienTrinh,
          createdBy: r.createdBy ?? null,
          batDau: iso(r.batDau)!,
          ketThuc: iso(r.ketThuc),
        }),
      );
    } catch (e) {
      const { isMissingTable } = await import("../_core/dbErrors");
      if (isMissingTable(e)) return [];
      throw e;
    }
  },
};
