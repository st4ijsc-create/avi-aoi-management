/**
 * ★★★ Luồng AI — NODE `ai.tra-tri-thuc`: tra kho tri thức SẴN CÓ (tài liệu hãng ∪ Training Studio ∪ api-ref .NET) và GHI NGUỒN TRÍCH (lô Luồng-2, 2026-10-25).
 * Dùng lại `timTaiLieuMacDinh` (cùng bộ truy hồi với `search_docs` / `tra_tai_lieu`) — KHÔNG viết bộ tìm thứ hai, KHÔNG gọi LLM sinh chữ ⇒ không bịa:
 * dưới ngưỡng ⇒ `soDoan = 0`, `triThuc = ""`.
 * Hạng `doc`, idempotent. Vai tra cứu = VAI CỦA CHỦ LƯỢT lúc chạy (cổng `canAccessStudioCorpus` của kho Studio, fail-closed); không có chủ hợp lệ ⇒ TỪ CHỐI.
 * Kho không chứa dữ liệu nhà máy (tài liệu hãng / đã duyệt) ⇒ không có trục nhà máy để lọc; dữ liệu trả về là DỮ LIỆU KHÔNG TIN CẬY (node AI phía sau bọc khối dữ liệu).
 * Tham số: `cauHoi` (biểu thức, ≤ 500 ký tự) · `kho` (all | vendor | studio | api, mặc định all) · `k` (1..8, mặc định 5) · `truongRa` (mặc định `triThuc`).
 * Ra: `<truongRa>` = chữ các đoạn (mỗi đoạn kèm tiêu đề nguồn) · `trich: [{ nguon, loai, diem }]` · `soDoan`.
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import type { TimTaiLieu } from "../../ai/agent/timTaiLieuAgent";

export class LoiTraTriThuc extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

const KHO_CHO_PHEP = new Set(["all", "vendor", "studio", "api"]);
const TRAN_CAU_HOI = 500;

let timTaiLieu: TimTaiLieu | null = null;
/** Chỉ lưới: thay bộ truy hồi. */
export function __datTimTaiLieuTriThucChoTest(f: TimTaiLieu | null): void {
  timTaiLieu = f;
}

dangKyNut({
  type: "ai.tra-tri-thuc",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "doc",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vaiTro = ngu.kiemPhamVi?.phamVi?.userRole;
    if (typeof vaiTro !== "string" || !vaiTro) throw new LoiTraTriThuc("Không xác định được chủ luồng (bị khoá / mất quyền / chưa có chủ lượt) — từ chối tra tri thức.", "CHU_LUOT_KHONG_XAC_DINH");
    const vao = ngu.inputs.main ?? [{ json: {} }];
    const ra = [];
    for (const item of vao) {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const cauHoi = String(t.cauHoi ?? "").trim().slice(0, TRAN_CAU_HOI);
      if (!cauHoi) throw new LoiTraTriThuc("cauHoi là bắt buộc", "THAM_SO_SAI");
      const kho = String(t.kho ?? "all");
      if (!KHO_CHO_PHEP.has(kho)) throw new LoiTraTriThuc("kho phải là all | vendor | studio | api", "THAM_SO_SAI");
      const k = t.k === undefined || t.k === null || t.k === "" ? 5 : Number(t.k);
      if (!Number.isInteger(k) || k < 1 || k > 8) throw new LoiTraTriThuc("k phải là số nguyên 1..8", "THAM_SO_SAI");
      const tim = timTaiLieu ?? (await import("../../ai/agent/timTaiLieuAgent")).timTaiLieuMacDinh;
      const kq = await tim({ query: cauHoi, corpus: kho as "all" | "vendor" | "studio" | "api", vaiTro, k });
      const doan = kq.doan.slice(0, k);
      ra.push({
        json: {
          ...item.json,
          [String(t.truongRa ?? "triThuc")]: doan.map((d) => `# ${d.nguon}\n${d.noiDung}`).join("\n\n"),
          trich: doan.map((d) => ({ nguon: d.nguon, loai: d.loai, diem: Math.round(d.diem * 100) / 100 })),
          soDoan: doan.length,
        },
      });
    }
    return { main: ra };
  },
});
