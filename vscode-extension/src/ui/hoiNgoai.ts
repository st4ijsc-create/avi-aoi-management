/**
 * ★★★ ĐỢT 10.4b-E — MỘT lượt HỎI bằng model NGOÀI (Trợ lý = L1). Tách khỏi `bangChat.ts` để đo được bằng phụ thuộc tiêm (không `vscode`).
 *
 * Luồng: lấy/tạo hội thoại máy chủ → gửi thân TỐI GIẢN (`loi/modelNgoai.ts#dungThanNgoai`) → nếu máy chủ trả 428 `CAN_XAC_NHAN_VAN_HANH`
 * ở lượt đầu của (hội thoại, model) thì hỏi người dùng MỘT lần rồi gửi lại với `xacNhanVanHanh:true` → đọc SSE: `meta.ngoai` (nguồn),
 * `token`, `done.vet`, `error.code`. Máy chủ TỰ lưu lượt (`done.daLuu`) — extension không ghi hộ lần nữa.
 * Mọi lỗi KHÔNG phải lỗi model ngoài (401, mạng…) được ném lên để nhánh lỗi chung của `bangChat.hoi` xử lý như cũ.
 */
import { LoiHttp } from "../loi/loiHttp";
import { canXacNhanVanHanh, docLoiTruocSse, docVet, dungThanNgoai, lamSachVanBanNgoai, thongDiepLoiNgoai, type VetNgoaiRut } from "../loi/modelNgoai";
import type { LuotChat } from "../loi/yeuCau";

export interface PhuThuocHoiNgoai {
  cauHoi: string;
  lichSu: readonly LuotChat[];
  ngonNgu: string;
  chonModel: string;
  signal: AbortSignal;
  /** Id hội thoại phía MÁY CHỦ gắn với hội thoại cục bộ hiện tại (tạo nếu chưa có). */
  layIdHoiThoai: () => Promise<number>;
  daDongY: () => boolean;
  ghiDongY: () => void;
  /** Hộp thoại xác nhận gửi dữ liệu vận hành ra ngoài; `true` = đồng ý. */
  hoiDongY: () => Promise<boolean>;
  moDong: (dv: { than: unknown; nhan: (sk: Record<string, unknown>) => void; tinHieu: AbortSignal }) => Promise<{ hong: string[] }>;
  gui: (m: Record<string, unknown>) => void;
}

export type KetQuaHoiNgoai =
  | { loai: "xong"; traLoi: string; ngoai: { nhaCungCap: string; model: string } | null; vet: VetNgoaiRut | null; canhBao: string | null }
  | { loai: "tu-choi-dong-y" }
  | { loai: "loi"; thongDiep: string };

export async function chayHoiNgoai(d: PhuThuocHoiNgoai): Promise<KetQuaHoiNgoai> {
  const id = await d.layIdHoiThoai();
  for (let lan = 0; lan < 2; lan++) {
    let traLoi = "";
    let ngoai: { nhaCungCap: string; model: string } | null = null;
    let vet: VetNgoaiRut | null = null;
    let daNhanDone = false;
    let loiSse: string | null = null;
    let hongSo = 0;
    try {
      const { hong } = await d.moDong({
        than: dungThanNgoai({ cauHoi: d.cauHoi, lichSu: d.lichSu, ngonNgu: d.ngonNgu, chonModel: d.chonModel, conversationId: id, xacNhanVanHanh: d.daDongY() }),
        tinHieu: d.signal,
        nhan: (sk) => {
          if (sk.type === "meta" && sk.ngoai && typeof sk.ngoai === "object") {
            const o = sk.ngoai as Record<string, unknown>;
            if (typeof o.nhaCungCap === "string" && typeof o.model === "string") {
              ngoai = { nhaCungCap: o.nhaCungCap.slice(0, 32), model: o.model.slice(0, 96) };
              d.gui({ loai: "nguon_ngoai", nhaCungCap: ngoai.nhaCungCap, model: ngoai.model });
            }
          } else if (sk.type === "token" && typeof sk.token === "string") {
            const sach = lamSachVanBanNgoai(sk.token);
            traLoi += sach;
            d.gui({ loai: "token", chu: sach });
          } else if (sk.type === "done") {
            daNhanDone = true;
            vet = docVet(sk.vet);
          } else if (sk.type === "error") {
            loiSse = thongDiepLoiNgoai(typeof sk.code === "string" ? sk.code : "KHONG_RO", typeof sk.tranVuot === "string" ? sk.tranVuot : undefined);
          }
        },
      });
      hongSo = hong.length;
    } catch (e) {
      if (e instanceof LoiHttp) {
        const l = docLoiTruocSse(e.status, e.thanLoi);
        if (canXacNhanVanHanh(l) && lan === 0) {
          if (!(await d.hoiDongY())) return { loai: "tu-choi-dong-y" };
          d.ghiDongY();
          continue;
        }
        if (l && l.code.startsWith("NGOAI_")) return { loai: "loi", thongDiep: thongDiepLoiNgoai(l.code, l.tranVuot) };
        if (l && l.code === "CAN_XAC_NHAN_VAN_HANH") return { loai: "loi", thongDiep: "Máy chủ vẫn đòi xác nhận dữ liệu vận hành dù bạn đã đồng ý — thử lại sau." };
      }
      throw e;
    }
    if (loiSse) return { loai: "loi", thongDiep: loiSse };
    const ghiChu: string[] = [];
    if (!daNhanDone) ghiChu.push("Câu trả lời có thể đã bị CẮT NGANG — luồng kết thúc mà không có tín hiệu hoàn tất.");
    if (hongSo > 0) ghiChu.push(`${hongSo} khung dữ liệu lỗi không đọc được, đã bỏ qua.`);
    return { loai: "xong", traLoi, ngoai, vet, canhBao: ghiChu.length ? ghiChu.join(" ") : null };
  }
  return { loai: "loi", thongDiep: "Không xác nhận được việc gửi dữ liệu — hủy lượt hỏi." };
}
