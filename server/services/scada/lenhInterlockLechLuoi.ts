/**
 * SCADA R1b-1 rà soát cuối I-1 (2026-10-25) — luật interlock ĐÃ BẬT mà hành động bảo vệ sẽ bị `dispatch()` TỪ CHỐI lúc chạy.
 *
 * Vì sao: T13 cho cổng kênh sớm của `dispatch()` từ chối `OFF_STEP` một giá trị lệch lưới thô trên tag int CHƯA khai có scale ≠ 1 / offset ≠ 0
 * (trước T13 driver làm tròn im lặng: scale 10, lệnh 25 ⇒ thô 3 = 30). Kiểm lúc cấu hình của T13 (`kiemLenhInterlockTx`) chỉ chạy ở
 * create / update / approve / enable ⇒ một luật ĐÃ bật trước bản build này với `commandValue` lệch lưới KHÔNG được ai kiểm lại: hành động bảo
 * vệ của nó bị `OFF_STEP` đúng lúc cần. Chỉ DEV / TEST đã được đo (0 luật như vậy). Hàm này cho:
 *   • posture (`oversightRouter.fetchInterlockCauHinhHong`) — đếm là "cấu hình hỏng", cạnh `dieuKienInterlockCauHinhHong`;
 *   • một khối lỗi MỘT lần lúc khởi động (`canhBaoLuatLenhLechLuoiKhiKhoiDong`, index.ts) — chỉ log, không chặn gì;
 *   • truy vấn trước triển khai BẮT BUỘC (báo cáo nghiệm thu R1b-1 §4) là bản SQL thuần của cùng điều kiện, cho DB chưa chạy bản build này.
 *
 * Cách tính: SQL chỉ LỌC ỨNG VIÊN theo CẤU TRÚC (`dieuKienUngVienLenhLechLuoi`: luật bật, không phải `alert`, đích (targetAdapterId +
 * commandTag) là tag int có scale / offset khác mặc định — chuẩn hoá NHƯ driver: scale NULL / 0 ⇒ 1, offset NULL ⇒ 0). Phán quyết "ghi được
 * không" là CHÍNH hàm cổng `dispatch()` và kiểm cấu hình dùng: `kiemLenhInterlockTrenKenh(tag, giaTriLenhInterlock(luat))` (tag chưa khai ⇒
 * lưới thô `kiemLuoiThoChuaKhai`, null ⇒ true ⇒ 1, dung sai dấu phẩy động của `kiemLuoiTho`; tag đã khai ⇒ `kiemNhatQuanKenh`) — không chép
 * công thức lưới sang SQL. Tag đã khai nằm trong tập ứng viên cũng được phán bằng đúng luật dispatch (dải / bước / kiểu) ⇒ tập đếm ⊇ tập lệch
 * lưới của truy vấn §4.
 *
 * Không chạm DB lúc import. Luật bật mà CHƯA duyệt cũng đếm (engine chỉ tự gửi luật đã duyệt, nhưng một luật bật hỏng vẫn là cấu hình hỏng).
 */
import { and, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { deviceTags, interlockRules } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { giaTriLenhInterlock, kiemLenhInterlockTrenKenh, type DbHoacTx, type MaViPham } from "./nhatQuanKenh";

/**
 * Điều kiện SQL của ỨNG VIÊN (cần `innerJoin(deviceTags, dieuKienNoiDichLenh())`): luật bật, ghi lệnh, đích là tag int có lưới thô khác số nguyên.
 */
export function dieuKienUngVienLenhLechLuoi(): SQL {
  return and(
    eq(interlockRules.enabled, true),
    ne(interlockRules.action, "alert"),
    eq(deviceTags.dataType, "int"),
    or(sql`COALESCE(NULLIF(${deviceTags.scale}, 0), 1) <> 1`, sql`COALESCE(${deviceTags.offset}, 0) <> 0`),
  ) as SQL;
}

/** Nối luật ↔ tag đích (cùng khoá `kiemLenhInterlockTx` đọc). */
export function dieuKienNoiDichLenh(): SQL {
  return and(eq(deviceTags.adapterId, interlockRules.targetAdapterId), eq(deviceTags.tagKey, interlockRules.commandTag)) as SQL;
}

/**
 * Truy vấn TRƯỚC TRIỂN KHAI (báo cáo nghiệm thu R1b-1 §4, CHỈ ĐỌC, chép NGUYÊN VĂN vào báo cáo): bản SQL thuần cho DB chưa chạy bản build này.
 * Giá trị gửi như `giaTriLenhInterlock` + `Number()` của `kiemLuoiThoChuaKhai`: NULL / JSON null ⇒ 1 (true), boolean ⇒ 1 / 0, số ⇒ chính nó,
 * chuỗi số thập phân (cắt khoảng trắng) ⇒ số, chuỗi rỗng ⇒ 0; còn lại (đối tượng, chuỗi chữ) ⇒ không kiểm (driver không làm tròn được).
 * Lệch lưới ⇔ |v − (o + round((v − o)/s)·s)| > 1e-9·max(1, |s|) (numeric chính xác ⇒ không cần vế dung sai tương đối của bản double).
 * Khác bản JS ở biên hiếm: chuỗi hex / "Infinity", |(v − o)/s| ≥ 2^53 (JS bỏ qua, SQL vẫn báo) — chiều báo DƯ, an toàn cho một cổng chặn
 * triển khai. Tag đã khai cũng chỉ được kiểm lưới thô ở đây (posture kiểm đủ dải / bước / kiểu). `interlockRouter.r1b.db.test.ts` §5 chạy
 * chính chuỗi này trên `_test` và so với `luatLenhLechLuoi`.
 */
export const TRUY_VAN_TRUOC_TRIEN_KHAI = String.raw`WITH ung_vien AS (
  SELECT r.id, r.name, r."commandValue" AS cv, r."targetAdapterId", t."tagKey",
         COALESCE(NULLIF(t.scale, 0), 1)::numeric AS s, COALESCE(t."offset", 0)::numeric AS o
  FROM interlock_rules r
  JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
  WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'int'
    AND (COALESCE(NULLIF(t.scale, 0), 1) <> 1 OR COALESCE(t."offset", 0) <> 0)
), gia_tri AS (
  SELECT u.*,
    CASE
      WHEN u.cv IS NULL OR jsonb_typeof(u.cv) = 'null' THEN 1::numeric
      WHEN jsonb_typeof(u.cv) = 'number' THEN (u.cv #>> '{}')::numeric
      WHEN jsonb_typeof(u.cv) = 'boolean' THEN CASE WHEN (u.cv #>> '{}')::boolean THEN 1::numeric ELSE 0::numeric END
      WHEN jsonb_typeof(u.cv) = 'string' AND btrim(u.cv #>> '{}') = '' THEN 0::numeric
      WHEN jsonb_typeof(u.cv) = 'string' AND btrim(u.cv #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
        THEN btrim(u.cv #>> '{}')::numeric
      ELSE NULL
    END AS v
  FROM ung_vien u
)
SELECT id, name, "targetAdapterId", "tagKey", cv AS "commandValue", s AS scale, o AS "offset", v AS gia_tri_gui,
       o + round((v - o) / s) * s AS diem_luoi_gan_nhat
FROM gia_tri
WHERE v IS NOT NULL AND abs(v - (o + round((v - o) / s) * s)) > 1e-9 * greatest(1, abs(s))
ORDER BY id`;

export type LuatLenhLechLuoi = { id: number; name: string; ma: MaViPham; chiTiet: string };

/**
 * Luật ĐANG BẬT mà giá trị GỬI không ghi được lên tag đích theo đúng cổng kênh sớm của `dispatch()` (xem đầu tệp). `them` = điều kiện SQL
 * thêm (test lọc theo tiền tố tên của riêng mình). Thứ tự theo id.
 */
export async function luatLenhLechLuoi(d: DbHoacTx, them?: SQL): Promise<LuatLenhLechLuoi[]> {
  const hang = await d
    .select({
      id: interlockRules.id,
      name: interlockRules.name,
      commandValue: interlockRules.commandValue,
      dataType: deviceTags.dataType,
      channelKind: deviceTags.channelKind,
      writable: deviceTags.writable,
      writeMin: deviceTags.writeMin,
      writeMax: deviceTags.writeMax,
      writeStep: deviceTags.writeStep,
      scale: deviceTags.scale,
      offset: deviceTags.offset,
    })
    .from(interlockRules)
    .innerJoin(deviceTags, dieuKienNoiDichLenh())
    .where(them ? and(dieuKienUngVienLenhLechLuoi(), them) : dieuKienUngVienLenhLechLuoi())
    .orderBy(interlockRules.id);
  const ra: LuatLenhLechLuoi[] = [];
  for (const h of hang) {
    const kq = kiemLenhInterlockTrenKenh(h, giaTriLenhInterlock(h));
    if (!kq.ok) ra.push({ id: h.id, name: h.name, ma: kq.ma, chiTiet: kq.chiTiet });
  }
  return ra;
}

/**
 * Lúc khởi động (index.ts, không chờ): có luật như vậy ⇒ MỘT khối `console.error` nêu id / tên / mã và cách sửa. Không kiểm được (DB chưa sẵn,
 * thiếu 0431, …) ⇒ một dòng cảnh báo. Không bao giờ ném. Trả số luật (null = không kiểm được) — cho test.
 */
export async function canhBaoLuatLenhLechLuoiKhiKhoiDong(
  deps: { layDb?: () => Promise<DbHoacTx | null>; logLoi?: (m: string) => void } = {},
): Promise<number | null> {
  const logLoi = deps.logLoi ?? ((m: string) => console.error(m));
  try {
    const d = await (deps.layDb ?? getDb)();
    if (!d) {
      logLoi("[SCADA R1b] KHÔNG kiểm được luật interlock lệch lưới thô lúc khởi động: không có kết nối DB.");
      return null;
    }
    const ds = await luatLenhLechLuoi(d);
    if (ds.length) {
      const vien = "█".repeat(100);
      logLoi(
        [
          "",
          vien,
          `█  [SCADA R1b] ${ds.length} LUẬT INTERLOCK ĐANG BẬT có lệnh bảo vệ mà dispatch() sẽ TỪ CHỐI (T13: lệch lưới thô của tag int có scale/offset).`,
          ...ds.slice(0, 20).map((r) => `█    #${r.id} "${r.name}" — ${r.ma}: ${r.chiTiet}`),
          ...(ds.length > 20 ? [`█    … và ${ds.length - 20} luật khác (posture: interlockRulesCauHinhHong).`] : []),
          "█  Hậu quả: khi điều kiện xảy ra, hành động bảo vệ KHÔNG tới thiết bị (OFF_STEP). Sửa commandValue về điểm lưới (offset + k·scale) rồi duyệt lại.",
          vien,
          "",
        ].join("\n"),
      );
    }
    return ds.length;
  } catch (err) {
    logLoi(`[SCADA R1b] KHÔNG kiểm được luật interlock lệch lưới thô lúc khởi động: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}
