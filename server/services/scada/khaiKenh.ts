/**
 * SCADA R1b-2a Task 6 — KIỂM MỘT LƯỢT KHAI CỘT KÊNH (mig 0431) cho MỘT tag: hàm DÙNG CHUNG của `scadaKenh.capNhat` (một tag) và
 * `scadaKenh.khaiHangLoat` (≤ `TRAN_KENH_DA_KHAI_MOT_LO` tag, một mã TOTP). Rút nguyên văn từ thân kiểm của `capNhat` (scadaKenhRouter.ts) —
 * cùng mã lỗi, cùng thứ tự — và thêm `tagId` vào params của mọi lỗi (lô 200 tag phải nói ĐÚNG tag nào hỏng).
 *
 * THỨ TỰ KIỂM (`kiemPatchKenh`, không DB, không mã — bên gọi đã khoá ADAPTER → LUẬT → TAG theo troLaiKenh.ts):
 *   1. hợp lệ trên hàng ĐÃ GỘP (chạy cả khi không đổi gì): min ≤ max; dải / bước chỉ cho kênh số; loại kênh GHI ⇒ tag phải writable
 *      (`INVALID_VALUE` × 3);
 *   2. không cột nào đổi ⇒ `doi: false` (bên gọi không đòi mã, không ghi, không audit);
 *   3. chạm loại kênh / dải / bước (`COT_CONG_KENH` — cột mà cổng kênh của `dispatch()` đọc):
 *      – giá trị DỪNG đang ghim phải còn ghi được trên khai báo mới (`STOP_PIN_NGOAI_DAI`);
 *      – `commandValue` của mọi luật interlock ĐANG BẬT nhắm tag phải còn ghi được (`INTERLOCK_NGOAI_DAI`);
 *   4. MỚI (điều phối DUYỆT 2026-10-25) — tag đang ghim DỪNG mà mức tác động HIỆU LỰC đi từ ≤ `MUC_TOI_DA_STOP_HMI` (1) lên cao hơn (kể cả bỏ
 *      khai ⇒ NULL ⇒ 5) ⇒ `STOP_PIN_GO_TRUOC`. Vì sao: STOP HMI (`dungMay`, R1b-1) chỉ gửi ghim của tag mức ≤ 1 (`phanLoaiGhimStopHmi`), nên
 *      lượt khai ấy sẽ LẶNG LẼ gỡ tag khỏi STOP HMI. Mất STOP phải là một thao tác riêng có lý do (phán quyết T9 b): gỡ ghim trước, rồi khai.
 *
 * Không hàm nào ở đây chạm cột nằm trong bám định nghĩa của duyệt interlock (address / dataType / scale / offset / adapterId —
 * `interlock/dinhNghiaDuyet.ts`): khai mức / dải không làm mất duyệt của luật nhắm tag.
 */
import { z } from "zod";
import { appError } from "../../_core/appError";
import { sql } from "drizzle-orm";
import { deviceTags, scadaChannelKindEnum, type DeviceTag } from "../../../drizzle/schema";
import { laKenhGhi, mucTacDongKenh } from "./kenhScada";
import { kiemNhatQuanKenh, thamSoNgoaiDaiInterlock, thamSoNgoaiDaiStopPin, viPhamInterlock, type DbHoacTx, type KenhNhatQuan, type LuatNhamTag } from "./nhatQuanKenh";
import { MUC_TOI_DA_STOP_HMI, validateStopValue } from "../ot/stopPin";
import { loiGoGhimTruoc } from "./troLaiKenh";
import { kiemThamSoLo } from "../audit/controlAuditService";

/** Cột kênh (mig 0431) — before/after của audit và kết quả trả về. */
export const COT_KENH = ["channelKind", "displayName", "displayFormat", "writeMin", "writeMax", "writeStep", "actuationLevel"] as const;
export type CotKenh = (typeof COT_KENH)[number];
export type KhaiKenh = Pick<DeviceTag, CotKenh>;
/** Cột mà cổng kênh của `dispatch()` đọc (đổi một trong số này ⇒ kiểm nhất quán với ghim DỪNG + luật interlock). */
export const COT_CONG_KENH: ReadonlySet<CotKenh> = new Set(["channelKind", "writeMin", "writeMax", "writeStep"]);

export function khaiCua(t: KhaiKenh): KhaiKenh {
  return {
    channelKind: t.channelKind ?? null,
    displayName: t.displayName ?? null,
    displayFormat: t.displayFormat ?? null,
    writeMin: t.writeMin ?? null,
    writeMax: t.writeMax ?? null,
    writeStep: t.writeStep ?? null,
    actuationLevel: t.actuationLevel ?? null,
  };
}

const loaiKenhInput = z.enum(["input", "input_output", "calculated", "calculated_output", "output"]);
const chuoiHienThi = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

/** Patch một phần các cột kênh: trường vắng = giữ nguyên, `null` = bỏ khai. */
export const patchKenhInput = z
  .object({
    channelKind: loaiKenhInput.nullable().optional(),
    displayName: chuoiHienThi(128),
    displayFormat: chuoiHienThi(64),
    writeMin: z.number().finite().nullable().optional(),
    writeMax: z.number().finite().nullable().optional(),
    writeStep: z.number().finite().positive().nullable().optional(),
    actuationLevel: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)]).nullable().optional(),
  })
  .strict();
export type PatchKenh = z.infer<typeof patchKenhInput>;

/** Bỏ trường `undefined` khỏi patch (đã qua zod). Không còn trường nào ⇒ `FIELD_REQUIRED {field:"patch"}` (+ `tagId` khi có). */
export function patchKhaiKenh(p: PatchKenh, tagId?: number): Partial<KhaiKenh> {
  const patch: Partial<KhaiKenh> = {};
  for (const k of COT_KENH) {
    const v = p[k];
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw appError(
      "BAD_REQUEST",
      "FIELD_REQUIRED",
      tagId === undefined ? { field: "patch" } : { field: "patch", tagId },
      tagId === undefined ? "Patch không có trường nào để đổi." : `Patch của tag #${tagId} không có trường nào để đổi.`,
    );
  }
  return patch;
}

/**
 * NÉM appError — mọi kiểm của MỘT lượt khai cột kênh trên `tag` (hàng ĐÃ khoá FOR UPDATE), TRỪ TOTP (bên gọi gọi `kiemTotpCauHinh` khi
 * `doi`, CUỐI, sau mọi kiểm). `luatNham` = luật interlock nhắm (adapterId, tagKey) của tag (bật hay tắt — chỉ luật bật, không `alert`, bị kiểm).
 * Xem thứ tự ở đầu tệp.
 */
export function kiemPatchKenh(
  tag: DeviceTag,
  luatNham: ReadonlyArray<LuatNhamTag>,
  patch: Partial<KhaiKenh>,
): { truoc: KhaiKenh; sau: KhaiKenh; doi: boolean } {
  const khoa = COT_KENH.filter((k) => patch[k] !== undefined);
  const truoc = khaiCua(tag);
  const sau: KhaiKenh = { ...truoc };
  for (const k of khoa) (sau as Record<string, unknown>)[k] = patch[k];
  const tagId = tag.id;

  if (sau.writeMin != null && sau.writeMax != null && sau.writeMin > sau.writeMax) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "writeMin", reason: "scadaDaiMinLonHonMax", tagId },
      `Giới hạn dưới ${sau.writeMin} lớn hơn giới hạn trên ${sau.writeMax}.`,
    );
  }
  const coDai = sau.writeMin != null || sau.writeMax != null || sau.writeStep != null;
  if (coDai && tag.dataType !== "int" && tag.dataType !== "float" && khoa.some((k) => k === "writeMin" || k === "writeMax" || k === "writeStep")) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "writeMin", reason: "scadaDaiChiChoKenhSo", tagId },
      `Dải / bước chỉ áp cho kênh số (int / float); tag này kiểu ${tag.dataType}.`,
    );
  }
  // fix round 1 (minor 4) — loại kênh GHI (input_output / output / calculated_output) trên tag không ghi được (writable !== true):
  // khai báo nói dối — dispatch() vẫn từ chối mọi lệnh ghi (tag phải writable ở bước 3) mà M12/M4 lại hiện nó như kênh ra.
  if (khoa.includes("channelKind") && sau.channelKind != null && laKenhGhi({ channelKind: sau.channelKind, writable: tag.writable }) && tag.writable !== true) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "channelKind", reason: "scadaKenhGhiTrenTagKhongGhi", tagId },
      `Loại kênh ${sau.channelKind} nhận lệnh ghi nhưng tag ${tag.tagKey} không cho phép ghi (writable=false).`,
    );
  }
  if (khoa.every((k) => sau[k] === truoc[k])) return { truoc, sau, doi: false };

  const coGhim = tag.stopValue !== null && tag.stopValue !== undefined;
  if (khoa.some((k) => COT_CONG_KENH.has(k))) {
    const kenhMoi: KenhNhatQuan = {
      dataType: tag.dataType,
      writable: tag.writable,
      channelKind: sau.channelKind,
      writeMin: sau.writeMin,
      writeMax: sau.writeMax,
      writeStep: sau.writeStep,
      scale: tag.scale, // kiem-dinh P1-3 — lưới thô (int) như dispatch()
      offset: tag.offset,
    };
    // Ghim DỪNG (kể cả khi tag đang tắt — bật lại thì ghim có hiệu lực ngay). Ghim không còn hợp lệ với dataType ⇒ dispatch bỏ qua nó.
    if (coGhim) {
      const v = validateStopValue(String(tag.dataType), tag.stopValue);
      const nq = v.ok ? kiemNhatQuanKenh(kenhMoi, v.value) : ({ ok: true } as const);
      if (!nq.ok) {
        throw appError(
          "BAD_REQUEST",
          "STOP_PIN_NGOAI_DAI",
          {
            ma: "STOP_PIN_NGOAI_DAI",
            lyDo: nq.ma,
            tagKey: tag.tagKey,
            stopValue: String(v.ok ? v.value : tag.stopValue),
            ...thamSoNgoaiDaiStopPin(sau, nq), // R1b-2a T2 (K17) — min / max / step (lưới vừa trượt) / goiY
            tagId,
          },
          `Giá trị DỪNG đang ghim của kênh ${tag.tagKey} không ghi được với khai báo mới (${nq.chiTiet}). Gỡ / đổi ghim trước.`,
        );
      }
    }
    const vp = viPhamInterlock(luatNham, kenhMoi);
    if (vp) {
      throw appError(
        "BAD_REQUEST",
        "INTERLOCK_NGOAI_DAI",
        {
          ma: "INTERLOCK_NGOAI_DAI",
          lyDo: vp.ma,
          tagKey: tag.tagKey,
          ...thamSoNgoaiDaiInterlock(sau, vp), // R1b-1 T13 polish m1: lưới thật (bước / |scale|, gốc, goiY)
          ruleId: vp.ruleId,
          tagId,
        },
        `Luật interlock đang bật #${vp.ruleId} (${vp.ruleName}) ghi một giá trị không ghi được với khai báo mới (${vp.chiTiet}).`,
      );
    }
  }
  // R1b-2a T6 (điều phối DUYỆT) — nâng mức hiệu lực của tag ĐANG GHIM DỪNG qua ngưỡng STOP HMI ⇒ gỡ ghim trước (xem đầu tệp).
  if (coGhim && mucTacDongKenh(truoc) <= MUC_TOI_DA_STOP_HMI && mucTacDongKenh(sau) > MUC_TOI_DA_STOP_HMI) {
    loiGoGhimTruoc(tag, `nâng mức tác động lên ${mucTacDongKenh(sau)} (STOP HMI chỉ gửi ghim của tag mức ≤ ${MUC_TOI_DA_STOP_HMI})`, tagId);
  }
  return { truoc, sau, doi: true };
}

/** Tham số bind của MỘT hàng trong `ghiKenhLoTx` (id + 7 cột `COT_KENH`); +1 cho `updatedAt` dùng chung. */
export const SO_THAM_SO_MOT_HANG_KENH = 1 + COT_KENH.length;

/**
 * R1b-2b-1 T11 (mục 48) — ghi các tag ĐỔI của một lô khai kênh bằng MỘT `UPDATE device_tags AS t SET … FROM (VALUES …) AS v(…) WHERE t.id = v.id`
 * (trước: một `UPDATE` mỗi tag). Giá trị là `sau` ĐẦY ĐỦ của `kiemPatchKenh` (mọi cột `COT_KENH`) — cột patch không chạm có `sau` = `truoc` = giá
 * trị hiện tại của hàng ĐANG khoá FOR UPDATE, nên ghi lại nó không đổi gì. Bên gọi đã khoá mọi hàng (ADAPTER → LUẬT → TAG ORDER BY id FOR UPDATE).
 *
 * Kiểu SQL TƯỜNG MINH cho MỌI cột của VALUES (kể cả cột cả lô đều NULL — không ép thì Postgres suy `text` rồi lỗi khi gán vào enum / số): theo
 * ĐÚNG kiểu cột trong schema drizzle (`drizzle/schema/ot.ts`): `id` serial ⇒ `::int`; `channel_kind` ⇒ enum `scada_channel_kind`;
 * `display_name` / `display_format` varchar ⇒ `::text`; `write_min/max/step` doublePrecision ⇒ `::double precision` (không `::numeric` — tránh
 * vòng numeric→float8); `actuation_level` smallint ⇒ `::smallint`. Tên cột lấy từ `deviceTags.<cột>.name`, không gõ tay.
 * `updatedAt` qua `sql.param(now, deviceTags.updatedAt)` — CÙNG bộ ánh xạ của `.set({ updatedAt })` trước đây.
 * Cổng tham số bind < 65535 (`kiemThamSoLo`; ≤ 200 tag × 8 + 1 = 1601).
 */
export async function ghiKenhLoTx(tx: DbHoacTx, hang: ReadonlyArray<{ id: number; sau: KhaiKenh }>, now: Date): Promise<void> {
  if (hang.length === 0) return;
  kiemThamSoLo(hang.length, SO_THAM_SO_MOT_HANG_KENH, 1);
  const cot = (c: "id" | CotKenh | "updatedAt") => sql.identifier(deviceTags[c].name);
  const loaiKenh = sql.identifier(scadaChannelKindEnum.enumName);
  const values = sql.join(
    hang.map(
      ({ id, sau }) =>
        sql`(${id}::int, ${sau.channelKind}::${loaiKenh}, ${sau.displayName}::text, ${sau.displayFormat}::text, ${sau.writeMin}::double precision, ${sau.writeMax}::double precision, ${sau.writeStep}::double precision, ${sau.actuationLevel}::smallint)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`UPDATE ${deviceTags} AS t SET
      ${cot("channelKind")} = v.ck, ${cot("displayName")} = v.dn, ${cot("displayFormat")} = v.df,
      ${cot("writeMin")} = v.wmin, ${cot("writeMax")} = v.wmax, ${cot("writeStep")} = v.ws, ${cot("actuationLevel")} = v.al,
      ${cot("updatedAt")} = ${sql.param(now, deviceTags.updatedAt)}
    FROM (VALUES ${values}) AS v(id, ck, dn, df, wmin, wmax, ws, al)
    WHERE t.${cot("id")} = v.id`);
}
