/**
 * ★★★ Lô B7-B (dieu-phoi duyệt, 2026-10-26) — BỘ QUÉT CẮT TỈA lượt chạy cũ của Luồng AI (spec §4.8: "mặc định giữ 14 ngày hoặc 10.000 run").
 *
 * AN TOÀN (đóng theo mặc định):
 *   • TẮT mặc định — bật bằng `FLOW_RETENTION_ENABLED=true`. Khi bật mà KHÔNG đặt `FLOW_RETENTION_DRY_RUN=false` ⇒ chỉ BÁO số lượt SẼ xoá (khuôn `dataRetentionService`).
 *   • Chỉ lượt ĐÃ ĐÓNG (xong / loi / huy) có `finishedAt`; không bao giờ đụng dang-chay / cho-duyet; lượt CHA còn lượt con đang mở thì giữ.
 *   • Luật xoá (độc lập, KHÔNG nới cho nhau):
 *       - lượt thường (hạng phiên bản thuần / doc): xoá nếu đóng quá `FLOW_RETENTION_DAYS` (14) NGÀY, HOẶC nằm ngoài `FLOW_RETENTION_GIU_MOI_NHAT` (10.000) lượt mới nhất của luồng
 *         VÀ đã đóng quá 24 giờ (không xoá lượt vừa xong, đang được điều tra);
 *       - lượt có tác dụng phụ ra ngoài (phiên bản hạng ngoai-ghi / ot, hoặc phiên bản KHÔNG còn ⇒ coi là cao): CHỈ xoá khi đóng quá `FLOW_RETENTION_DAYS_NGOAI_GHI` (365, tạm) NGÀY — luật đếm KHÔNG áp.
 *   • Bằng chứng duyệt / bước ngoai-ghi đã nằm trong `audit_logs` (WORM, lô A) — cắt tỉa KHÔNG làm mất dấu "ai đã duyệt". Mỗi lượt quét có xoá ghi MỘT dòng `FLOW_CAT_TIA` (số lượt, cửa sổ, dry-run).
 *   • Xoá theo lô (`FLOW_RETENTION_BATCH`, mặc định 500) qua `DELETE ai_flow_runs` — bảng con (steps/events/queue/waits/inbox) đi theo ON DELETE CASCADE.
 * Bảng ai_flow_* KHÔNG phải WORM (kiểm: 0 trigger; vai ứng dụng xoá được) nên việc xoá là hợp lệ về kỹ thuật; ranh giới ở đây là LUẬT NGHIỆP VỤ ở trên.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { banGhiKiemToan } from "./kiemToan";
import { createAuditLog } from "../../db/system";

export interface CauHinhCatTia {
  batHoatDong: boolean;
  chiBao: boolean;
  ngay: number;
  ngayNgoaiGhi: number;
  giuMoiNhat: number;
  lo: number;
  nhapPhut: number;
}

const so = (v: string | undefined, md: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : md;
};

export function docCauHinhCatTia(env: NodeJS.ProcessEnv = process.env): CauHinhCatTia {
  return {
    batHoatDong: env.FLOW_RETENTION_ENABLED === "true",
    chiBao: env.FLOW_RETENTION_DRY_RUN !== "false",
    ngay: so(env.FLOW_RETENTION_DAYS, 14, 1, 3650),
    ngayNgoaiGhi: so(env.FLOW_RETENTION_DAYS_NGOAI_GHI, 365, 1, 3650),
    giuMoiNhat: so(env.FLOW_RETENTION_GIU_MOI_NHAT, 10_000, 1, 10_000_000),
    lo: so(env.FLOW_RETENTION_BATCH, 500, 1, 5000),
    nhapPhut: so(env.FLOW_RETENTION_NHIP_PHUT, 60, 1, 10_080),
  };
}

export interface KetQuaCatTia {
  /** `false` ⇒ bộ quét TẮT, không làm gì. */
  chay: boolean;
  chiBao: boolean;
  /** Số lượt đã xoá (hoặc SẼ xoá khi chiBao). */
  soLuot: number;
  soLo: number;
}

/** Mệnh đề chọn lượt XOÁ ĐƯỢC (dùng chung cho đếm và xoá). */
function chonLuot(c: CauHinhCatTia, tienToFlow: string | undefined, gioiHan: number) {
  const loc = tienToFlow ? sql`AND r."flowId" LIKE ${tienToFlow.replace(/[\\%_]/g, (k) => "\\" + k) + "%"}` : sql``;
  return sql`WITH xep AS (
      SELECT r.id, r."flowId", r."finishedAt",
             COALESCE(v."riskClass" IN ('ngoai-ghi', 'ot'), TRUE) AS cao,
             row_number() OVER (PARTITION BY r."flowId" ORDER BY r."startedAt" DESC) AS "thuTu"
        FROM ai_flow_runs r LEFT JOIN ai_flow_versions v ON v."flowId" = r."flowId" AND v.version = r.version
       WHERE r.status IN ('xong', 'loi', 'huy') AND r."finishedAt" IS NOT NULL ${loc})
    SELECT x.id FROM xep x
     WHERE (
             (x.cao AND x."finishedAt" < now() - (${c.ngayNgoaiGhi}::int * interval '1 day'))
          OR (NOT x.cao AND (x."finishedAt" < now() - (${c.ngay}::int * interval '1 day')
                             OR (x."thuTu" > ${c.giuMoiNhat}::bigint AND x."finishedAt" < now() - interval '1 day')))
           )
       AND NOT EXISTS (SELECT 1 FROM ai_flow_runs con WHERE con."parentRunId" = x.id AND con.status IN ('dang-chay', 'cho-duyet'))
     ORDER BY x."finishedAt" LIMIT ${gioiHan}`;
}

/**
 * MỘT lượt quét. `tienToFlow` chỉ để LƯỚI cô lập (chỉ xét luồng có id bắt đầu bằng tiền tố). Tắt ⇒ `{chay:false}`. Chỉ báo ⇒ đếm (tới trần 1.000.000) không xoá.
 */
export async function chayCatTiaMotLan(env: NodeJS.ProcessEnv = process.env, tienToFlow?: string): Promise<KetQuaCatTia> {
  const c = docCauHinhCatTia(env);
  if (!c.batHoatDong) return { chay: false, chiBao: c.chiBao, soLuot: 0, soLo: 0 };
  const db = await getDb();
  if (!db) return { chay: false, chiBao: c.chiBao, soLuot: 0, soLo: 0 };
  let tong = 0;
  let soLo = 0;
  if (c.chiBao) {
    const [d] = (await db.execute(sql`SELECT count(*)::int AS n FROM (${chonLuot(c, tienToFlow, 1_000_000)}) t`)) as unknown as { n: number }[];
    tong = d?.n ?? 0;
  } else {
    for (let i = 0; i < 10_000; i++) {
      const xoa = (await db.execute(sql`DELETE FROM ai_flow_runs WHERE id IN (${chonLuot(c, tienToFlow, c.lo)}) RETURNING id`)) as unknown as unknown[];
      if (!xoa.length) break;
      tong += xoa.length;
      soLo++;
    }
  }
  if (tong > 0) {
    await createAuditLog(
      banGhiKiemToan({
        nguoi: null,
        hanhDong: "FLOW_CAT_TIA",
        loaiThucThe: "ai_flow",
        thucThe: tienToFlow ?? "(mọi luồng)",
        chiTiet: { soLuot: tong, chiBao: c.chiBao, ngay: c.ngay, ngayNgoaiGhi: c.ngayNgoaiGhi, giuMoiNhat: c.giuMoiNhat, soLo },
      }),
    ).catch((e: unknown) => console.error("[luong-ai] không ghi được kiểm toán FLOW_CAT_TIA:", (e as Error)?.message ?? e));
  }
  console.log(`[luong-ai] cắt tỉa lượt cũ: ${c.chiBao ? "CHỈ BÁO — sẽ xoá" : "đã xoá"} ${tong} lượt (thường > ${c.ngay} ngày hoặc ngoài ${c.giuMoiNhat} mới nhất; ngoai-ghi/ot > ${c.ngayNgoaiGhi} ngày).`);
  return { chay: true, chiBao: c.chiBao, soLuot: tong, soLo };
}

let hen: ReturnType<typeof setInterval> | null = null;
/** Khởi bộ quét nền (gọi lần hai = no-op). Tắt (mặc định) ⇒ không đặt hẹn giờ. Lần đầu sau 5 phút, rồi mỗi `FLOW_RETENTION_NHIP_PHUT` phút. */
export function khoiChayCatTia(env: NodeJS.ProcessEnv = process.env): void {
  if (hen || !docCauHinhCatTia(env).batHoatDong) return;
  const nhip = docCauHinhCatTia(env).nhapPhut * 60_000;
  const lan = () => void chayCatTiaMotLan(env).catch((e: unknown) => console.error("[luong-ai] cắt tỉa lỗi:", (e as Error)?.message ?? e));
  const dau = setTimeout(() => {
    lan();
    hen = setInterval(lan, nhip);
    hen.unref?.();
  }, 5 * 60_000);
  dau.unref?.();
  hen = dau as unknown as ReturnType<typeof setInterval>;
}

export function dungCatTia(): void {
  if (hen) clearInterval(hen);
  hen = null;
}
