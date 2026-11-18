/**
 * HA-3 — TRẦN lượt agent theo THẺ. Chỉ các khoá thẻ TƯỜNG MINH được áp (chữ tự do "8 vòng" trong GIỚI HẠN KHÔNG bao giờ được phân tích để áp trần):
 *   TRẦN LƯỢT MODEL: <số>      một "vòng" = MỘT lần gọi model (cùng đơn vị với soLuotToiDa / luotMax); 1..120
 *   TRẦN PHÚT: <số>            trần thời gian của lượt agent; 1..120
 *   TRẦN TOKEN RA: <số>        trần token model sinh ra của lượt; 1000..400000
 * Trần lượt thực dùng = min(khoá thẻ, biến AI_AGENT_SO_LUOT_TOI_DA (mặc định 30), trần cứng 120). Thẻ KHÔNG có khoá nào ⇒ không áp gì (hành vi như cũ).
 * THUẦN: không fs, không process.env (env truyền vào).
 */
import { soLuotToiDaTuEnv, SO_LUOT_MAC_DINH, TRAN_CUNG_SO_LUOT } from "../../server/services/ai/agent/gioiHanLuot";

export interface TranTheoThe {
  luotModel?: number;
  phut?: number;
  tokenRa?: number;
}

export interface TranLuotKetQua {
  /** đơn vị của "vòng" trong báo cáo này */
  donVi: "luot-goi-model";
  khoaThe: { luotModel: number | null; phut: number | null; tokenRa: number | null };
  /** AI_AGENT_SO_LUOT_TOI_DA đã kẹp, hoặc null nếu chưa đặt / không hợp lệ */
  luotEnv: number | null;
  tranCung: number;
  /** số lượt model thực sự được phép dùng: min(khoá thẻ, env hoặc 30, trần cứng) */
  luotThucDung: number;
  phutThucDung: number | null;
  tokenRaThucDung: number | null;
  /** có khoá thẻ ⇒ bộ chạy ÉP trần này vào lượt agent */
  apDungTuThe: boolean;
  /** số lượt thẻ XIN (khoá TRẦN LƯỢT MODEL) hoặc null nếu thẻ không khoá */
  theYeuCau: number | null;
  /** = luotThucDung (tên rõ nghĩa cho người đọc JSON) */
  thucDung: number;
  /** thẻ xin NHIỀU hơn số được phép ⇒ trần bị kẹp xuống */
  biKep: boolean;
  /** vì sao bị kẹp (nêu biến / mặc định / trần cứng) hoặc null khi không kẹp */
  lyDoKep: string | null;
}

/** Phần `gioiHan` bộ chạy ép vào lượt agent (khoá nào thẻ không nêu thì vắng). */
export interface GioiHanLuotChoDriver {
  soLuotToiDa?: number;
  msToiDa?: number;
  tokenRaToiDa?: number;
}

export const GIOI_PHUT = { min: 1, max: 120 } as const;
export const GIOI_TOKEN_RA = { min: 1000, max: 400_000 } as const;

/** Số nguyên dương thuần chữ số trong [min, max]; ngược lại null. */
export function docSoTran(tho: string | undefined, min: number, max: number): number | null {
  const t = (tho ?? "").trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function tinhTranLuot(tran: TranTheoThe, env: Record<string, string | undefined>): TranLuotKetQua {
  const luotEnv = soLuotToiDaTuEnv(env) ?? null;
  const tranEnv = luotEnv ?? SO_LUOT_MAC_DINH;
  const k = tran.luotModel ?? null;
  const luotThucDung = k === null ? tranEnv : Math.min(k, tranEnv, TRAN_CUNG_SO_LUOT);
  const biKep = k !== null && k > luotThucDung;
  // tranEnv ≤ trần cứng (soLuotToiDaTuEnv đã kẹp) nên kẹp luôn do env / mặc định — trần cứng chỉ "thắng" qua chính tranEnv khi env = 120
  const thoEnv = (env.AI_AGENT_SO_LUOT_TOI_DA ?? "").trim();
  // biến ĐÃ đặt nhưng không hợp lệ (vd "abc", "0") khác với CHƯA đặt. KHÔNG BAO GIỜ chép giá trị lạ vào JSON/stderr (ai đó đặt nhầm một bí mật vào biến này sẽ lộ):
  // chỉ ghi nguyên văn khi trông như một SỐ (^[0-9.+-]{1,12}$ — không thể là bí mật), còn lại chỉ ghi độ dài.
  const dangEnvKhongHopLe = /^[0-9.+-]{1,12}$/.test(thoEnv) ? `"${thoEnv}"` : `độ dài ${thoEnv.length}, không phải số`;
  const lyDoKep = !biKep
    ? null
    : luotEnv !== null
      ? `AI_AGENT_SO_LUOT_TOI_DA=${luotEnv}`
      : thoEnv !== ""
        ? `mặc định ${SO_LUOT_MAC_DINH} (AI_AGENT_SO_LUOT_TOI_DA không hợp lệ: ${dangEnvKhongHopLe})`
        : `mặc định ${SO_LUOT_MAC_DINH} (AI_AGENT_SO_LUOT_TOI_DA chưa đặt)`;
  return {
    donVi: "luot-goi-model",
    khoaThe: { luotModel: k, phut: tran.phut ?? null, tokenRa: tran.tokenRa ?? null },
    luotEnv,
    tranCung: TRAN_CUNG_SO_LUOT,
    luotThucDung,
    theYeuCau: k,
    thucDung: luotThucDung,
    biKep,
    lyDoKep,
    phutThucDung: tran.phut ?? null,
    tokenRaThucDung: tran.tokenRa ?? null,
    apDungTuThe: k !== null || tran.phut !== undefined || tran.tokenRa !== undefined,
  };
}

/** MỘT dòng cảnh báo đầu lượt khi trần của thẻ bị kẹp xuống; null khi không kẹp. */
export function dongCanhBaoKep(t: TranLuotKetQua): string | null {
  if (!t.biKep) return null;
  return `CẢNH BÁO: trần thẻ ${t.theYeuCau} bị kẹp còn ${t.thucDung} bởi ${t.lyDoKep}`;
}

/** Phần `gioiHan` đưa vào quanLyLuotChay; undefined khi thẻ không có khoá (không ép gì). */
export function gioiHanChoLuot(t: TranLuotKetQua): GioiHanLuotChoDriver | undefined {
  if (!t.apDungTuThe) return undefined;
  return {
    ...(t.khoaThe.luotModel !== null ? { soLuotToiDa: t.luotThucDung } : {}),
    ...(t.phutThucDung !== null ? { msToiDa: t.phutThucDung * 60_000 } : {}),
    ...(t.tokenRaThucDung !== null ? { tokenRaToiDa: t.tokenRaThucDung } : {}),
  };
}

/** Dòng báo trần cho model ngay đầu lượt (chỉ khi thẻ có khoá). */
export function dongBaoTran(t: TranLuotKetQua): string[] {
  if (!t.apDungTuThe) return [];
  const ra: string[] = [];
  if (t.khoaThe.luotModel !== null) ra.push(`TRẦN LƯỢT MODEL: ${t.luotThucDung} (một vòng = một lần gọi model; chạm trần là lượt dừng, nên chia việc cho vừa)`);
  if (t.phutThucDung !== null) ra.push(`TRẦN PHÚT: ${t.phutThucDung}`);
  if (t.tokenRaThucDung !== null) ra.push(`TRẦN TOKEN RA: ${t.tokenRaThucDung}`);
  return ra;
}
