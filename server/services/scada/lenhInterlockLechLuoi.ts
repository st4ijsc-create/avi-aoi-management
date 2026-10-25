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
 * commandTag) là tag int — R1b-2a T1: MỌI tag int, kể cả scale 1 / offset 0). Phán quyết "ghi được không" là CHÍNH hàm cổng `dispatch()` và
 * kiểm cấu hình dùng: `kiemLenhInterlockTrenKenh(tag, giaTriLenhInterlock(luat))` (tag chưa khai ⇒ `kiemLuoiThoChuaKhai`: null ⇒ true ⇒ 1,
 * giá trị không phải số hữu hạn ⇒ TYPE_MISMATCH, lưới thô so ở không gian thô, |thô| ≥ 2^53 ⇒ OUT_OF_RANGE; tag đã khai ⇒ `kiemNhatQuanKenh`:
 * kiểu / dải / bước / loại kênh / lưới thô) — không chép công thức sang SQL.
 *
 * R1b-2a T1 (điều phối 2026-10-25; phán quyết K2 của bộ điều khiển) — PHẠM VI của truy vấn trước triển khai `TRUY_VAN_TRUOC_TRIEN_KHAI`: nó chỉ
 * phủ LƯỚI THÔ (số nguyên sau (v − o)/s, |thô| ≥ 2^52 — biên dư so với 2^53 của JS) và giá trị SQL KHÔNG PARSE ĐƯỢC. Với tag int CHƯA khai, đó là toàn bộ luật JS ⇒ mọi luật
 * hàm JS từ chối đều có hàng trong SQL (SQL chỉ được báo DƯ). Với tag ĐÃ khai, dải / bước / kiểu / loại kênh được cưỡng chế LÚC CẤU HÌNH
 * (`nhatQuanKenh`: interlock create / update / approve / enable, `scadaKenh.capNhat`, `tags.update`) và được posture đếm qua hàm này — SQL KHÔNG
 * lặp lại chúng, nên KHÔNG khẳng định "tập SQL ⊇ tập JS" cho tag đã khai.
 *
 * Không chạm DB lúc import. Luật bật mà CHƯA duyệt cũng đếm (engine chỉ tự gửi luật đã duyệt, nhưng một luật bật hỏng vẫn là cấu hình hỏng).
 */
import { and, eq, ne, type SQL } from "drizzle-orm";
import { deviceTags, interlockRules } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { giaTriLenhInterlock, kiemLenhInterlockTrenKenh, type DbHoacTx, type MaViPham } from "./nhatQuanKenh";

/**
 * Điều kiện SQL của ỨNG VIÊN (cần `innerJoin(deviceTags, dieuKienNoiDichLenh())`): luật bật, ghi lệnh, đích là tag int. R1b-2a T1: bỏ vế
 * "scale ≠ 1 / offset ≠ 0" — tag int scale 1 cũng có lưới thô (số nguyên) và cũng từ chối giá trị không phải số hữu hạn.
 */
export function dieuKienUngVienLenhLechLuoi(): SQL {
  return and(eq(interlockRules.enabled, true), ne(interlockRules.action, "alert"), eq(deviceTags.dataType, "int")) as SQL;
}

/** Nối luật ↔ tag đích (cùng khoá `kiemLenhInterlockTx` đọc). */
export function dieuKienNoiDichLenh(): SQL {
  return and(eq(deviceTags.adapterId, interlockRules.targetAdapterId), eq(deviceTags.tagKey, interlockRules.commandTag)) as SQL;
}

/**
 * Truy vấn TRƯỚC TRIỂN KHAI (báo cáo nghiệm thu R1b-1 §4, CHỈ ĐỌC, chép NGUYÊN VĂN vào báo cáo): bản SQL thuần cho DB chưa chạy bản build này.
 * Giá trị gửi như `giaTriLenhInterlock` + bộ đọc số của `kiemLuoiThoChuaKhai`: NULL / JSON null ⇒ 1 (true), boolean ⇒ 1 / 0, số ⇒ chính nó,
 * chuỗi số thập phân SẠCH (cắt dấu cách đầu/cuối) ⇒ số.
 * kiem-dinh R1b-1 N-1 (điều phối 2026-10-25) — MỌI giá trị khác (chuỗi hex / 0b / 0o, chuỗi có TAB / xuống dòng / NBSP, chuỗi chữ, mảng, đối tượng)
 *   ⇒ MỘT HÀNG `ket_luan = 'KHONG_PARSE_DUOC'` (gia_tri_gui / diem_luoi_gan_nhat NULL) — ĐẾM LÀ CHẶN, không bỏ qua như trước: JS đọc được một số
 *   trong vài giá trị đó (`Number("0x19")` = 25, `Number("\t25")` = 25) và dispatch sẽ từ chối nếu lệch lưới; SQL không chép lại được bộ đọc số
 *   của JS nên báo DƯ (người triển khai xem tay từng hàng) thay vì BỎ SÓT.
 * R1b-2a T1 (Q-T13 b + kiem-dinh M1 / M2, điều phối 2026-10-25) — SQL ĐI THEO JS:
 *   • ứng viên = MỌI luật bật, không `alert`, đích tag int (bỏ vế scale ≠ 1 / offset ≠ 0 — scale 1 ⇒ lưới số nguyên: 2.5 ⇒ LECH_LUOI);
 *   • chuỗi rỗng / chỉ khoảng trắng ⇒ KHONG_PARSE_DUOC (JS nay TYPE_MISMATCH; trước SQL đọc là 0); mảng / đối tượng / "abc" / "Infinity" vẫn
 *     KHONG_PARSE_DUOC (JS nay TYPE_MISMATCH thay vì bỏ qua);
 *   • phép so ở KHÔNG GIAN THÔ: n = round(v − o, 30) / s (thang 30 chữ số thập phân ⇒ phép chia numeric chính xác tới 1e-30); lệch ⇔
 *     |n − round(n)| > 1e-9 (`LECH_LUOI`) HOẶC |n| ≥ 2^52 (`VUOT_MIEN_AN_TOAN`, diem_luoi_gan_nhat NULL — JS OUT_OF_RANGE từ 2^53).
 *     Polish M2 (task-1-review) — biên 2^52 thay 2^53: JS tính n bằng double nên một n numeric = 2^53 − 1 (vd scale 0.000001, 9007199254.740991)
 *     bị JS làm tròn thành 2^53 và từ chối; SQL báo từ 2^52 (báo dư, không bỏ sót).
 *   • Polish M3 — chuỗi số chỉ được đọc khi dài ≤ 100 ký tự và số mũ ≤ 4 chữ số; ngoài ra ⇒ KHONG_PARSE_DUOC (trước: "1e200000" làm `::numeric`
 *     tràn và CẢ truy vấn hỏng).
 *   • Polish M4 — diem_luoi_gan_nhat = o + floor(n + 0.5)·s: hoà .5 về phía +∞ như `Math.round` (goiY của JS; −2.5 trên scale 1 ⇒ −2).
 *   Dung sai JS (1e-9 + 4·EPSILON·(|n| + (|v| + |o|)/|s|)) ≥ 1e-9 và phủ sai số double của v, o, phép chia ⇒ JS từ chối ⇒ SQL có hàng: trên tag
 *   int CHƯA khai, tập luật hàm JS từ chối ⊆ tập hàng SQL (chỉ báo DƯ). Tag ĐÃ khai: SQL chỉ phủ lưới thô + không parse được — dải / bước / kiểu /
 *   loại kênh được cưỡng chế lúc cấu hình (`nhatQuanKenh`) và đếm ở posture (phán quyết K2; xem đầu tệp).
 * Cột ra giữ nguyên như R1b-1 (id, name, targetAdapterId, tagKey, commandValue, scale, offset, gia_tri_gui, diem_luoi_gan_nhat, ket_luan).
 * `interlockRouter.r1b.db.test.ts` §5 và `lenhInterlockLechLuoi.r1b2.db.test.ts` chạy chính chuỗi này trên `_test` và so với `luatLenhLechLuoi`.
 */
export const TRUY_VAN_TRUOC_TRIEN_KHAI = String.raw`WITH ung_vien AS (
  SELECT r.id, r.name, r."commandValue" AS cv, r."targetAdapterId", t."tagKey",
         COALESCE(NULLIF(t.scale, 0), 1)::numeric AS s, COALESCE(t."offset", 0)::numeric AS o
  FROM interlock_rules r
  JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
  WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'int'
), gia_tri AS (
  SELECT u.*,
    CASE
      WHEN u.cv IS NULL OR jsonb_typeof(u.cv) = 'null' THEN 1::numeric
      WHEN jsonb_typeof(u.cv) = 'number' THEN (u.cv #>> '{}')::numeric
      WHEN jsonb_typeof(u.cv) = 'boolean' THEN CASE WHEN (u.cv #>> '{}')::boolean THEN 1::numeric ELSE 0::numeric END
      WHEN jsonb_typeof(u.cv) = 'string' AND char_length(btrim(u.cv #>> '{}')) <= 100
        AND btrim(u.cv #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,4})?$'
        THEN btrim(u.cv #>> '{}')::numeric
      ELSE NULL
    END AS v
  FROM ung_vien u
), tho AS (
  SELECT g.*, round(g.v - g.o, 30) / g.s AS n
  FROM gia_tri g
)
SELECT id, name, "targetAdapterId", "tagKey", cv AS "commandValue", s AS scale, o AS "offset", v AS gia_tri_gui,
       CASE WHEN v IS NULL OR abs(n) >= 4503599627370496 THEN NULL ELSE o + floor(n + 0.5) * s END AS diem_luoi_gan_nhat,
       CASE WHEN v IS NULL THEN 'KHONG_PARSE_DUOC' WHEN abs(n) >= 4503599627370496 THEN 'VUOT_MIEN_AN_TOAN' ELSE 'LECH_LUOI' END AS ket_luan
FROM tho
WHERE v IS NULL OR abs(n) >= 4503599627370496 OR abs(n - round(n)) > 1e-9
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
          `█  [SCADA R1b] ${ds.length} LUẬT INTERLOCK ĐANG BẬT có lệnh bảo vệ mà dispatch() sẽ TỪ CHỐI (T13 / R1b-2a T1: lệch lưới thô hoặc không phải số hữu hạn trên tag int).`,
          ...ds.slice(0, 20).map((r) => `█    #${r.id} "${r.name}" — ${r.ma}: ${r.chiTiet}`),
          ...(ds.length > 20 ? [`█    … và ${ds.length - 20} luật khác (posture: interlockRulesCauHinhHong).`] : []),
          "█  Hậu quả: khi điều kiện xảy ra, hành động bảo vệ KHÔNG tới thiết bị (OFF_STEP / TYPE_MISMATCH / OUT_OF_RANGE). Sửa commandValue thành một SỐ trên điểm lưới (offset + k·scale) rồi duyệt lại.",
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
