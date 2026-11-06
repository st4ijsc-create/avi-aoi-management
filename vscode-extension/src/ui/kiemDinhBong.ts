/**
 * ★★★ ĐỢT 10.4b-E (0.6.0) — MỘT lượt "Kiểm định bằng AI ngoài" từ bong bóng trợ lý. Tách khỏi `bangChat.ts` để đo bằng phụ thuộc tiêm
 * (không `vscode`). Hợp đồng: `docs/superpowers/plans/2026-11-03-ext-e-060-model-ngoai-hop-dong.md` §2 E1.
 *
 * Luồng: bản ghi CỦA HOST (không có ⇒ bỏ qua im lặng) → danh mục model `duocDungO ∋ kiem-dinh` (rỗng ⇒ báo) → người dùng chọn (QuickPick
 * host) → `aiKiemDinh.xemTruoc` (lỗi / sai hình dạng ⇒ dừng, KHÔNG modal) → `duocPhep: false` ⇒ báo lý do, KHÔNG modal → modal HOST (model,
 * mức, chi phí, số byte + cờ "đã cắt", trích đã che) → đồng ý mới `aiKiemDinh.chay` → kết quả đọc phòng thủ, hiển thị KHÔNG TIN CẬY.
 * Kết quả không bao giờ đi tới bất kỳ đường thực thi nào (không đề xuất ghi, không lệnh, không khối mã đăng ký nút).
 */
import {
  docKetQuaKiemDinh,
  docXemTruoc,
  nguonChoBanGhi,
  noiDungModalKiemDinh,
  type BanGhiBong,
  type KetQuaKiemDinhBong,
  type ModelKiemDinh,
} from "../loi/kiemDinhBong";
import { thongDiepLoiNgoai } from "../loi/modelNgoai";

export type KetQuaTrpcKiemDinh = { ok: true; du: unknown } | { ok: false; status: number; ma: string | null };

export interface PhuThuocKiemDinhBong {
  /** Bản ghi host tra theo mã bong bóng do CHÍNH host cấp; `undefined` ⇒ mã giả / đã hết hạn. */
  banGhi: BanGhiBong | undefined;
  layDanhMuc: () => Promise<ModelKiemDinh[]>;
  chonModel: (ds: ModelKiemDinh[]) => Promise<ModelKiemDinh | undefined>;
  goi: (ten: "aiKiemDinh.xemTruoc" | "aiKiemDinh.chay", dauVao: unknown) => Promise<KetQuaTrpcKiemDinh>;
  hoiDongY: (nd: { thongDiep: string; chiTiet: string }) => Promise<boolean>;
  baoTrangThai: (chu: string) => void;
}

export type KetCucKiemDinhBong =
  | { loai: "bo-qua" }
  | { loai: "huy"; chu: string }
  | { loai: "loi"; chu: string; het401?: true }
  | { loai: "xong"; kq: KetQuaKiemDinhBong };

const LOI_KIEM_DINH: Record<string, string> = {
  NGOAI_QUA_LON: "Câu trả lời quá dài để gửi kiểm định (trần 16 KB).",
  NGOAI_DANG_CHAY: "Đang có một lượt kiểm định cho câu trả lời này với model này — đợi lượt đó xong.",
  NGOAI_SAI_SCHEMA: "AI ngoài trả kết quả sai định dạng (đã thử lại một lần) — không có kết quả để hiển thị.",
};

/** Lỗi tRPC → câu thân thiện (chữ thuần). Mã `NGOAI_*` theo bảng; mã lạ ⇒ câu chung kèm mã/HTTP (không bịa nguyên nhân). */
export function thongDiepLoiKiemDinh(l: { status: number; ma: string | null }, tranVuot?: string | null): string {
  if (l.ma) return LOI_KIEM_DINH[l.ma] ?? thongDiepLoiNgoai(l.ma, tranVuot ?? undefined);
  if (l.status === 404) return "Không kiểm định được câu trả lời này (không tìm thấy, hoặc tài khoản chưa thuộc đúng một nhà máy / kiểm định ngoài chưa bật).";
  if (l.status === 403) return "Tài khoản không có quyền dùng AI ngoài để kiểm định.";
  if (l.status === 0) return "Không nối được máy chủ Thợ Cả.";
  return `Kiểm định thất bại (HTTP ${l.status}).`;
}

export async function chayKiemDinhBong(d: PhuThuocKiemDinhBong): Promise<KetCucKiemDinhBong> {
  const b = d.banGhi;
  if (!b || !b.traLoi.trim()) return { loai: "bo-qua" };
  const ds = await d.layDanhMuc();
  if (ds.length === 0) return { loai: "huy", chu: "Chưa có model ngoài nào được bật cho kiểm định." };
  const model = await d.chonModel(ds);
  if (!model || !ds.some((m) => m.ma === model.ma)) return { loai: "huy", chu: "Đã hủy kiểm định." };
  const nguon = nguonChoBanGhi(b);
  const dauVao = { chonModel: model.ma, nguon: nguon.nguon };
  const r1 = await d.goi("aiKiemDinh.xemTruoc", dauVao);
  if (!r1.ok) return r1.status === 401 ? { loai: "loi", chu: "Phiên đăng nhập hết hạn — chạy lệnh 'Thợ Cả: Đăng nhập'.", het401: true } : { loai: "loi", chu: thongDiepLoiKiemDinh(r1) };
  const xt = docXemTruoc(r1.du);
  if (!xt) return { loai: "loi", chu: "Máy chủ trả bản xem trước không đọc được — không gửi." };
  if (!xt.duocPhep) return { loai: "loi", chu: thongDiepLoiKiemDinh({ status: 0, ma: xt.lyDo ?? "NGOAI_KHONG_RO" }, xt.tranVuot) };
  if (!(await d.hoiDongY(noiDungModalKiemDinh({ model, xt, nguon })))) return { loai: "huy", chu: "Đã hủy: bạn không đồng ý gửi kiểm định." };
  d.baoTrangThai(`Đang kiểm định bằng ${model.nhan}…`);
  const r2 = await d.goi("aiKiemDinh.chay", dauVao);
  if (!r2.ok) return r2.status === 401 ? { loai: "loi", chu: "Phiên đăng nhập hết hạn — chạy lệnh 'Thợ Cả: Đăng nhập'.", het401: true } : { loai: "loi", chu: thongDiepLoiKiemDinh(r2) };
  const kq = docKetQuaKiemDinh(r2.du);
  if (!kq) return { loai: "loi", chu: "Máy chủ trả kết quả kiểm định không đọc được." };
  return { loai: "xong", kq };
}
