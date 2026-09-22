/**
 * hoSoSampling.ts — ★ B2 (2026-09-22): **HỒ SƠ SAMPLING theo chế độ nghĩ — THUẦN, không I/O, có cần gạt A/B.**
 *
 * ─── VÌ SAO MODULE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Rà soát tương thích Qwen3.6-35B-A3B (docs/superpowers/audits/2026-09-22-ra-soat-tuong-thich-…, mục T2)
 * đo được đường ống gửi `temperature 0,25 (mã) / 0,15 (KB, sửa) · top_p 0,9 · repeat 1,05/1,0` và KHÔNG
 * gửi `top_k / min_p / presence_penalty` ⇒ server điền mặc định của NÓ (`/props` :8091: `top_k 20 ·
 * min_p 0,05 · presence 0`). Tài liệu chính hãng cho model này lại khuyến nghị:
 *
 *   · chế độ NGHĨ (coding):   temperature 0,6 · top_p 0,95 · top_k 20 · min_p 0   · presence 0   · repeat 1,0
 *   · chế độ KHÔNG nghĩ:      temperature 0,7 · top_p 0,8  · top_k 20 · min_p 0   · presence 1,5 · repeat 1,0
 *
 * Hai bộ số lệch nhau ở bốn trường. Lệch không tự động là SAI — bộ hiện tại cho 83 % trên bộ khó — nhưng
 * "đúng theo tài liệu" và "đúng theo phép đo" là hai mệnh đề khác nhau, và kế hoạch B2 yêu cầu **A/B
 * trên cả hai trục (M, H) TRƯỚC khi đổi mặc định**. Module này là cần gạt cho phép đo đó:
 *
 *   · `AI_SAMPLING_PROFILE` vắng / lạ ⇒ `"hien-tai"` ⇒ trả NGUYÊN hồ sơ bên gọi đang dùng (hành vi cũ
 *     y nguyên — không một con số nào đổi khi chưa có kết quả A/B);
 *   · `AI_SAMPLING_PROFILE=chinh-hang` ⇒ hồ sơ chính hãng theo việc LƯỢT NÀY có nghĩ THẬT hay không.
 *
 * ⚠ "Nghĩ thật" = lớp lượt được nghĩ (`loaiLuot.luotDuocNghi`) **và** model biết nghĩ
 *   (`tranTokenSinhMa.modelNenCoiLaBietNghi`). Bên gọi tính bit đó — module này không đoán model.
 *
 * ⚠ `minP: 0` phải là số 0 TƯỜNG MINH, không phải `undefined`: vắng ⇒ client không gửi ⇒ server dùng
 *   0,05 ⇒ hồ sơ "chính hãng" âm thầm không phải chính hãng. Lưới canh riêng điểm này.
 */

/** Bộ tham số sampling MỘT lượt gửi xuống engine (tên theo `GgufGenerateOptions`). */
export interface HoSoSampling {
  temperature: number;
  topP: number;
  /** Vắng ⇒ không gửi ⇒ server mặc định (20). */
  topK?: number;
  /** Vắng ⇒ không gửi ⇒ server mặc định (0,05). */
  minP?: number;
  /** Vắng ⇒ không gửi ⇒ server mặc định (0). */
  presencePenalty?: number;
  repeatPenalty: number;
}

/** Tên cần gạt A/B. Chỉ hai giá trị — thêm hồ sơ thứ ba khi phép đo đòi, không trước. */
export type TenHoSo = "hien-tai" | "chinh-hang";

/** Chính hãng, chế độ NGHĨ (coding) — model card Qwen3.6-35B-A3B, đọc 2026-09-22. */
export const HO_SO_CHINH_HANG_NGHI: HoSoSampling = {
  temperature: 0.6,
  topP: 0.95,
  topK: 20,
  minP: 0,
  presencePenalty: 0,
  repeatPenalty: 1.0,
};

/** Chính hãng, chế độ KHÔNG nghĩ — cùng nguồn. `presence 1,5` là con số đáng nghi nhất cho lượt chép mã. */
export const HO_SO_CHINH_HANG_KHONG_NGHI: HoSoSampling = {
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  minP: 0,
  presencePenalty: 1.5,
  repeatPenalty: 1.0,
};

/**
 * Đọc tên hồ sơ từ env (mặc định `AI_SAMPLING_PROFILE`) — mọi giá trị không phải `chinh-hang`
 * (kể cả rỗng, sai chính tả, hoa/thường lẫn) đều về `hien-tai`: cần gạt SAI ⇒ hành vi cũ, không phải hồ sơ lạ.
 */
export function docTenHoSo(raw: string | undefined = process.env.AI_SAMPLING_PROFILE): TenHoSo {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "chinh-hang" ? "chinh-hang" : "hien-tai";
}

/**
 * Chọn hồ sơ cho một lượt.
 * @param hienTai      hồ sơ bên gọi ĐANG dùng (trả nguyên khi cần gạt ở `hien-tai`)
 * @param luotNghiThat lớp lượt được nghĩ VÀ model biết nghĩ
 * @param ten          cần gạt; vắng ⇒ đọc env tại thời điểm gọi (test đổi env rồi gọi lại là thấy ngay)
 */
export function hoSoSamplingCho(hienTai: HoSoSampling, luotNghiThat: boolean, ten: TenHoSo = docTenHoSo()): HoSoSampling {
  if (ten !== "chinh-hang") return hienTai;
  return luotNghiThat ? HO_SO_CHINH_HANG_NGHI : HO_SO_CHINH_HANG_KHONG_NGHI;
}
