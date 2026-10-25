/**
 * kiem-dinh R1b-1 fix round 2 (điều phối 2026-10-25, phương án B — TOFU) — ĐÓNG DẤU bám định nghĩa cho luật interlock đã duyệt TRƯỚC mig 0434.
 *
 * Vấn đề: sau 0434 mọi luật đã duyệt có `approvedDefHash` NULL ⇒ "Cần duyệt lại" (fail-closed) ⇒ không bật được, không tự chặn. TOFU (trust on
 * first use): chụp bám định nghĩa HIỆN TẠI lúc triển khai, coi đó là định nghĩa đã được duyệt. GIỚI HẠN đã chấp nhận (status quo trước R1b-1): một
 * thay đổi định nghĩa xảy ra GIỮA lần duyệt gốc và lúc triển khai KHÔNG phát hiện được ⇒ admin rà lại luật bảo vệ trong tuần đầu (báo cáo §4).
 *
 * Điều kiện của điều phối (nguyên văn trong brief fix round 2):
 *   (1) dùng ĐÚNG hàm bám JS của ứng dụng — IMPORT (`bamDinhNghia` / `dinhNghiaNhieuLuat` của `dinhNghiaDuyet.ts`), không chép;
 *   chạy khô mặc định (`ghi: false`); in bảng (ruleId, tên, trạng thái duyệt, bám) + số đếm; CHỈ đóng dấu luật `approvedBy` khác NULL VÀ
 *   `approvedDefHash` NULL; MỘT dòng audit mỗi luật (ai chạy, lý do "TOFU 0434"); idempotent (lần hai 0 hàng);
 *   (2) luật mà tag nguồn / đích VẮNG, hoặc định nghĩa không đọc được ⇒ KHÔNG đóng dấu, liệt kê riêng, giữ chưa duyệt (fail-closed).
 *
 * "Vắng / không đọc được":
 *   • đích: `targetAdapterId` khác NULL mà adapter không tồn tại, hoặc có `commandTag` mà tag không tồn tại trên adapter đó;
 *   • nguồn: `sourceType = 'telemetry_tag'` mà thiếu `machineId` / `sourceKey`, hoặc KHÔNG tag thiết bị nào của máy mang `sourceKey` (kể cả nguồn
 *     đọc qua `ot_telemetry` — TOFU không đoán; luật đó cần admin duyệt lại bằng tay);
 *   • đọc định nghĩa ném ⇒ mọi luật của lượt "không đọc được" (không ghi gì).
 * Khoá: luật FOR UPDATE (thứ tự LUẬT → TAG như mọi đường interlock); tag / adapter đọc không khoá. UPDATE có canh `approvedBy IS NOT NULL AND
 * "approvedDefHash" IS NULL` (chạy đồng thời hai lần vẫn chỉ đóng dấu một lần).
 */
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { interlockRules } from "../../../drizzle/schema";
import { recordAuditEvent } from "../audit/controlAuditService";
import { bamDinhNghia, dinhNghiaNhieuLuat, type DinhNghiaLuat } from "./dinhNghiaDuyet";

export const LY_DO_TOFU = "TOFU 0434";
export const AUDIT_TOFU = "approve_def_hash_tofu";

export type HangBackfill = {
  ruleId: number;
  ten: string;
  trangThai: string;
  bam: string | null;
  /** vắng ⇒ đóng dấu được; có ⇒ lý do KHÔNG đóng dấu */
  boQua?: string;
};
export type KetQuaBackfill = {
  ghi: boolean;
  ungVien: number;
  dongDau: HangBackfill[];
  khongDongDau: HangBackfill[];
  daGhi: number;
};

type DbCoTx = { transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T> };

/** THUẦN — lý do KHÔNG đóng dấu một luật theo định nghĩa đọc được (null = đóng dấu được). */
export function lyDoKhongDongDau(
  l: { sourceType: string; machineId: number | null; sourceKey: string | null; targetAdapterId: number | null; commandTag: string | null },
  dn: DinhNghiaLuat | undefined,
): string | null {
  if (!dn) return "khong_doc_duoc_dinh_nghia";
  if (l.targetAdapterId != null) {
    if (!dn.dich || !dn.dich.adapterTonTai) return "adapter_dich_vang";
    if (l.commandTag && !dn.dich.tag) return "tag_dich_vang";
  }
  if (l.sourceType === "telemetry_tag") {
    if (l.machineId == null || !l.sourceKey) return "nguon_thieu_may_hoac_khoa";
    if (!dn.nguon || dn.nguon.tags.length === 0) return "tag_nguon_vang";
  }
  return null;
}

/**
 * Chạy backfill trên `db` (drizzle). `ghi: false` ⇒ chỉ đọc (không khoá, không ghi). `ghi: true` ⇒ MỘT giao dịch: khoá ứng viên, tính bám,
 * UPDATE có canh + MỘT dòng audit mỗi luật (actor `actorId`, lý do `LY_DO_TOFU`). Lỗi giữa chừng ⇒ rollback cả lượt.
 */
export async function chayBackfillDinhNghiaDuyet(
  db: unknown,
  o: { ghi: boolean; actorId: number | null; /** CHỈ cho test (CSDL `_test` dùng chung): giới hạn theo id; CLI không bao giờ truyền */ chiRuleIds?: number[] },
): Promise<KetQuaBackfill> {
  const lam = async (d: any, khoa: boolean): Promise<KetQuaBackfill> => {
    let q = d
      .select()
      .from(interlockRules)
      .where(
        and(
          isNotNull(interlockRules.approvedBy),
          isNull(interlockRules.approvedDefHash),
          o.chiRuleIds ? inArray(interlockRules.id, o.chiRuleIds.length ? o.chiRuleIds : [-1]) : undefined,
        ),
      )
      .orderBy(asc(interlockRules.id));
    if (khoa) q = q.for("update");
    const rows: Array<typeof interlockRules.$inferSelect> = await q;
    let dn: Map<number, DinhNghiaLuat> | null = null;
    try {
      dn = await dinhNghiaNhieuLuat(d, rows);
    } catch {
      dn = null;
    }
    const dongDau: HangBackfill[] = [];
    const khongDongDau: HangBackfill[] = [];
    for (const r of rows) {
      const trangThai = `duyet_boi_${r.approvedBy}${r.enabled ? "_dang_bat" : "_tat"}`;
      const x = dn?.get(r.id);
      const ly = lyDoKhongDongDau(r, x);
      if (ly || !x) khongDongDau.push({ ruleId: r.id, ten: r.name, trangThai, bam: null, boQua: ly ?? "khong_doc_duoc_dinh_nghia" });
      else dongDau.push({ ruleId: r.id, ten: r.name, trangThai, bam: bamDinhNghia(x) });
    }
    let daGhi = 0;
    if (o.ghi) {
      for (const h of dongDau) {
        const capNhat = await d
          .update(interlockRules)
          .set({ approvedDefHash: h.bam })
          .where(and(eq(interlockRules.id, h.ruleId), isNotNull(interlockRules.approvedBy), isNull(interlockRules.approvedDefHash)))
          .returning({ id: interlockRules.id });
        if (capNhat.length === 0) continue;
        daGhi++;
        await recordAuditEvent(d, {
          entityType: "interlock_rule",
          entityId: h.ruleId,
          action: AUDIT_TOFU,
          actorId: o.actorId,
          before: { approvedDefHash: null },
          after: { approvedDefHash: h.bam, dinhNghia: dn?.get(h.ruleId) ?? null },
          reason: LY_DO_TOFU,
        });
      }
    }
    return { ghi: o.ghi, ungVien: rows.length, dongDau, khongDongDau, daGhi };
  };
  if (!o.ghi) return lam(db, false);
  return (db as DbCoTx).transaction((tx) => lam(tx, true));
}

/** Bảng chữ (in ra màn hình) — ruleId, tên, trạng thái duyệt, bám / lý do bỏ qua, và số đếm. */
export function bangBackfill(k: KetQuaBackfill): string {
  const dong = (h: HangBackfill) => `  ${String(h.ruleId).padStart(7)}  ${h.ten.slice(0, 40).padEnd(40)}  ${h.trangThai.padEnd(24)}  ${h.bam ?? `BỎ QUA: ${h.boQua}`}`;
  return [
    `${k.ghi ? "[GHI]" : "[CHẠY KHÔ]"} ứng viên (approvedBy khác NULL, approvedDefHash NULL): ${k.ungVien}`,
    `  ${"ruleId".padStart(7)}  ${"tên".padEnd(40)}  ${"trạng thái duyệt".padEnd(24)}  bám`,
    ...k.dongDau.map(dong),
    `ĐÓNG DẤU được: ${k.dongDau.length}${k.ghi ? ` — đã ghi ${k.daGhi}` : " (chạy khô — không ghi gì; thêm --ghi để ghi)"}`,
    `KHÔNG đóng dấu (giữ "Cần duyệt lại", fail-closed): ${k.khongDongDau.length}`,
    ...k.khongDongDau.map(dong),
  ].join("\n");
}
