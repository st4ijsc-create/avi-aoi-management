/**
 * ★★ Luồng AI Đợt 8.4 — NODE `ai.sinh-ma`: sinh mã theo mô tả, với ST (IEC 61131-3) có VÒNG BIÊN DỊCH-SỬA. Spec §3.7, §4.5.
 *
 * Tham số: `vaiTro` (mặc định `code.plc` cho `st`, `code.software` cho `khac`) · `moTa` (biểu thức theo item — yêu cầu) ·
 * `ngonNgu` (`st` | `khac`) · `kiemBienDich` (bool, mặc định true với `st`; `khac` không có bộ kiểm) · `soVongSua` (0..3,
 * mặc định 2) · `phuongNgu` (gợi ý phương ngữ, mặc định CODESYS).
 *
 * Vòng: sinh ⇒ biên dịch RuSTy trong Docker (`lib/bienDichST.ts`, CHỈ biên dịch, không liên kết, không chạy) ⇒ lỗi có cấu
 * trúc (tệp:dòng:cột mã thông điệp) + mã trước gửi lại model ⇒ lặp, tối đa 1 + `soVongSua` lần biên dịch.
 * Ra item `{ ...item, ma, ngonNgu, bienDich: { ok, chanDoan, soVong } | null }` — hết vòng mà vẫn lỗi ⇒ `ok:false` (không ném:
 * người duyệt phía sau thấy chẩn đoán); lỗi HẠ TẦNG (ảnh thiếu, docker vắng) ⇒ lỗi node rõ ràng.
 *
 * Hạng `thuan` (chỉ tạo văn bản), `idempotent`. ⚠ KHÔNG BAO GIỜ tải mã xuống thiết bị: tệp này không nhập bất kỳ đường
 * OT/kỹ thuật nào — tải xuống PLC đi qua đường kỹ thuật hiện có có duyệt người (L-7), không qua Luồng.
 */
import type { ItemLuong } from "../../../../shared/flow/bieuThuc";
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type NguCanhChay } from "../dangKyNut";
import { bienDichST, type ChanDoanST } from "../lib/bienDichST";
import { HE_THONG_CHUNG, LoiNutAi, boc, goiAiHienHanh } from "./ai";

export const TRAN_VONG_SUA = 3;

/** Lấy khối mã từ trả lời của model: khối rào ``` dài nhất (bỏ nhãn ngôn ngữ); không rào ⇒ cả chữ (đã bỏ <think>). */
export function trichKhoiMa(chu: string): string {
  const sach = chu.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const khoi = [...sach.matchAll(/```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[2]);
  if (khoi.length) return khoi.sort((a, b) => b.length - a.length)[0].trim();
  return sach;
}

/** Chẩn đoán ⇒ chữ gửi lại model (chỉ lỗi, ≤ 20 dòng). */
export function chanDoanChoModel(ds: ChanDoanST[]): string {
  return ds
    .filter((d) => d.mucDo === "error")
    .slice(0, 20)
    .map((d) => `${d.tep ?? "?"}:${d.dong ?? "?"}:${d.cot ?? "?"} ${d.ma ? `error[${d.ma}]` : "error"}: ${d.thongDiep}`)
    .join("\n");
}

const danhSo = (ma: string) => ma.split("\n").map((d, i) => `${String(i + 1).padStart(3, " ")}| ${d}`).join("\n");

const HE_THONG_ST =
  "Bạn là kỹ sư PLC viết Structured Text theo IEC 61131-3. Chỉ trả về MỘT khối mã ```st … ``` (không giải thích). " +
  "Không định nghĩa lại TON/TOF/TP (đã có sẵn). Không dùng thư viện riêng của hãng. Không viết lệnh tải xuống thiết bị.";

dangKyNut({
  type: "ai.sinh-ma",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu: NguCanhChay) {
    const vao = ngu.inputs.main ?? [];
    const ra: ItemLuong[] = [];
    for (const item of vao) {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const ngonNgu = t.ngonNgu === "khac" ? "khac" : "st";
      const moTa = String(t.moTa ?? "").trim();
      if (!moTa) throw new LoiNutAi("ai.sinh-ma cần 'moTa' (yêu cầu) không rỗng");
      const kiem = ngonNgu === "st" && t.kiemBienDich !== false;
      const nSua = Math.min(TRAN_VONG_SUA, Math.max(0, Math.round(Number(t.soVongSua ?? 2)) || 0));
      const vaiTro = String(t.vaiTro ?? (ngonNgu === "st" ? "code.plc" : "code.software"));
      const phuongNgu = String(t.phuongNgu ?? "CODESYS (IEC 61131-3)").slice(0, 80);
      const heThong = `${HE_THONG_CHUNG}\n\n${ngonNgu === "st" ? `${HE_THONG_ST} Phương ngữ: ${phuongNgu}.` : "Chỉ trả về MỘT khối mã trong rào ``` (không giải thích)."}`;
      const goc = `Viết mã theo yêu cầu dưới đây.\n\n${boc(moTa)}`;
      let nguoiDung = goc;
      let ma = "";
      let bienDich: { ok: boolean; chanDoan: ChanDoanST[]; soVong: number } | null = null;
      for (let vong = 1; vong <= (kiem ? 1 + nSua : 1); vong++) {
        const chu = await goiAiHienHanh({ vaiTro, heThong, nguoiDung, nghi: false, maxTokens: 4000, loai: "sinh-ma", ngu });
        ma = trichKhoiMa(chu);
        if (!kiem) break;
        const kq = await bienDichST(ma);
        bienDich = { ok: kq.ok, chanDoan: kq.chanDoan, soVong: vong };
        if (kq.ok) break;
        nguoiDung =
          `${goc}\n\nBản trước (đánh số dòng) KHÔNG biên dịch được:\n${boc(danhSo(ma))}\n\n` +
          `Lỗi của trình biên dịch RuSTy (tệp:dòng:cột):\n${boc(chanDoanChoModel(kq.chanDoan) || "(không rõ)")}\n\n` +
          "Sửa đúng các lỗi trên và trả lại TOÀN BỘ mã đã sửa trong MỘT khối ```st```.";
      }
      ra.push({ json: { ...item.json, ma, ngonNgu, bienDich } });
    }
    return { main: ra };
  },
});
