/**
 * ★ Đợt 10.4 (B5, T1c) — NODE `ai.kiem-dinh-ngoai`: AI NGOÀI kiểm định câu trả lời / mã của bước trước (thường là AI cục bộ) theo tiêu chí.
 *   • `chonModel` BẮT BUỘC, chuỗi CỐ ĐỊNH `ngoai:<ncc>:<model>` (kiểm cả lúc lưu — `kiemThamSoNut`) — không có "auto" / model cục bộ.
 *   • Mỗi item: `kiemDinhNgoai` (hàm dùng chung với nút kiểm định) — cổng AI ngoài (che, trần, sổ, mức dữ liệu theo LƯỢT, duyệt phiên bản),
 *     KHÔNG công cụ, kiểm định dạng bằng `parseKetQuaKiemDinh` (shared), sai ⇒ thử lại một lần ⇒ vẫn sai ⇒ node lỗi.
 *   • Đầu ra: `{ ...item.json, [truongRa]: KetQuaKiemDinh, [truongRa + "Vet"]: vet }` — DỮ LIỆU KHÔNG TIN CẬY (chuỗi trong đó đọc lại bằng
 *     `{{ }}` là chuỗi literal; vào `ai.agent` sau luôn nằm trong khối không tin cậy).
 *   • Hạng `ngoai-ghi` (gọi ra ngoài, trả phí), `lapLai: atMostOnce` (không tự lặp lời gọi trả phí khi chạy lại sau sập).
 *   • Trần item / lượt-node: `TRAN_ITEM_KIEM_DINH` — vượt ⇒ lỗi rõ (không cắt âm thầm).
 */
import { danhGiaThamSo, type ItemLuong } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay, type VetModel } from "../dangKyNut";
import { CHON_MODEL_RE } from "../../ai/chonModel/kieu";
import { LoiNutAi, giaiChonModelNut, goiCongNgoaiHienHanh, nguNgoaiTuLuot } from "./ai";

export const LOAI_KIEM_DINH_NGOAI = "ai.kiem-dinh-ngoai";
export const TRAN_ITEM_KIEM_DINH = 20;
const RE_TRUONG_RA = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

/** `chonModel` hợp lệ cho node này: chuỗi cố định nhánh `ngoai:` của `CHON_MODEL_RE`. */
export function laChonModelNgoai(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("ngoai:") && CHON_MODEL_RE.test(v);
}

const chuoi = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v, null, 2));

dangKyNut({
  type: LOAI_KIEM_DINH_NGOAI,
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "ngoai-ghi",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    // `chonModel` đọc NGUYÊN VĂN (không qua biểu thức) — model ngoài chỉ được chọn cố định lúc soạn + duyệt phiên bản.
    if (!laChonModelNgoai(thamSo.chonModel)) throw new LoiNutAi("ai.kiem-dinh-ngoai cần chonModel cố định dạng 'ngoai:<nhà cung cấp>:<model>'");
    const chon = await giaiChonModelNut(thamSo.chonModel, ngu);
    if (!chon?.ngoai) throw new LoiNutAi("ai.kiem-dinh-ngoai: model ngoài không có trong danh mục của nhà máy chủ luồng");
    const truongRa = thamSo.truongRa === undefined ? "kiemDinh" : thamSo.truongRa;
    if (typeof truongRa !== "string" || !RE_TRUONG_RA.test(truongRa)) throw new LoiNutAi("truongRa phải là tên trường (chữ, số, _; ≤ 48 ký tự)");
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_KIEM_DINH) {
      throw new LoiNutAi(`ai.kiem-dinh-ngoai nhận ${vao.length} item — tối đa ${TRAN_ITEM_KIEM_DINH} mỗi lượt (mỗi item là một lời gọi AI ngoài TRẢ PHÍ; chia lô trước)`);
    }
    const vet: VetModel = { ...chon.vet, lyDo: [...chon.vet.lyDo] };
    try {
      ngu.ghiModel?.(vet);
    } catch {
      /* vết là thông tin phụ */
    }
    const { chonModel: _bo, ...thamSoBieuThuc } = thamSo;
    const { kiemDinhNgoai } = await import("../../ai/ngoai/kiemDinhNgoai");
    const ra: ItemLuong[] = [];
    let tokVao = 0;
    let tokRa = 0;
    for (const item of vao) {
      const t = danhGiaThamSo(thamSoBieuThuc, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const cauHoi = chuoi(t.cauHoi);
      const traLoi = chuoi(t.traLoi);
      if (!traLoi.trim()) throw new LoiNutAi("ai.kiem-dinh-ngoai: traLoi rỗng — không có gì để kiểm định");
      const maxTokens = Number.isFinite(Number(t.maxTokens)) && Number(t.maxTokens) >= 1 ? Math.floor(Number(t.maxTokens)) : undefined;
      let kq;
      try {
        kq = await kiemDinhNgoai(
          { dich: chon.ngoai, cauHoi, traLoi, ...(typeof t.tieuChi === "string" ? { tieuChi: t.tieuChi } : {}), ...(maxTokens ? { maxTokens } : {}), ngu: nguNgoaiTuLuot(ngu) },
          async (y) => ({ chiPhiUocUsd: null, callId: 0, khongTinCay: true as const, ...(await goiCongNgoaiHienHanh(y)) }),
        );
      } catch (e) {
        const ma = (e as { ma?: unknown })?.ma;
        throw new LoiNutAi(`AI ngoài (kiểm định): ${typeof ma === "string" ? ma : e instanceof Error ? e.message : String(e)}`);
      }
      tokVao += kq.vet.tokenVao ?? 0;
      tokRa += kq.vet.tokenRa ?? 0;
      ra.push({ json: { ...item.json, [truongRa]: kq.ketQua, [`${truongRa}Vet`]: kq.vet } });
    }
    vet.tokVao = tokVao;
    vet.tokRa = tokRa;
    return { main: ra };
  },
});
