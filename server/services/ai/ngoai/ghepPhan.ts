/**
 * ★ Đợt 10.4b L0a (kế hoạch v2.1 §2 D2, rà kiem-dinh M1/M2) — BỘ DỰNG yêu cầu AI NGOÀI: đường DUY NHẤT tạo `tinNhan` cho `goiAiNgoai`.
 *
 * Người gọi không đưa chuỗi thô và không tự khai mức: họ đưa danh sách PHẦN đã gắn LOẠI; mức của từng loại do BẢNG `MUC_THEO_LOAI` ở đây
 * quyết định (máy chủ), mức của cả yêu cầu = MAX trên TOÀN BỘ danh sách (lượt 1 đọc dữ liệu vận hành ⇒ mọi lượt sau còn chứa nó ⇒ vẫn
 * `van-hanh`). Kết quả mang DẤU (WeakMap theo danh tính mảng, không giả được bằng một mảng chép): cổng từ chối `tinNhan` không có dấu
 * (`NGOAI_KHONG_QUA_BO_GHEP`) và lấy MAX giữa mức nguồn khai và mức bộ dựng tính — người gọi không hạ được mức.
 *
 * Bảng phân loại (kế hoạch §2 D2, do-model xác nhận từng dòng):
 *   • `huong-dan-tinh` — system / persona / hướng dẫn HẰNG do máy chủ viết ⇒ `ky-thuat`;
 *   • `cau-go-van-hanh` — câu người gõ ở chat / KB / bong bóng / trợ lý extension (trợ lý VẬN HÀNH) ⇒ `van-hanh`;
 *   • `cau-go-lap-trinh` — câu người gõ ở màn lập trình ⇒ `ky-thuat`;
 *   • `ma-repo` — mã / tài liệu mã đọc qua tool (đã qua `shared/aiNgoaiDenyList`) ⇒ `ky-thuat`;
 *   • `truy-hoi-kb` — theo `loaiKho`: `vendor` / `studio` / `api` ⇒ `ky-thuat`; khác / VẮNG ⇒ `van-hanh`;
 *   • `lich-su-client` — lịch sử hội thoại do CLIENT gửi ⇒ `van-hanh` (N2: nới khi máy chủ tự ghi nhật ký lượt);
 *   • `ket-qua-tool-van-hanh` — kết quả planner / tool vận hành ⇒ `van-hanh`;
 *   • `ghi-chu-du-an` — ghi chú dự án / `remember` / bài học / few-shot ⇒ `van-hanh`;
 *   • `nguon-kiem-dinh` — câu hỏi / câu trả lời đem kiểm định: mức do MÁY CHỦ suy từ bản lưu (`nguonKiemDinh`) hoặc động cơ luồng ⇒ phần
 *     mang `muc` (`ky-thuat` | `van-hanh` | `luong`);
 *   • `dau-ra-model` — đầu ra của model trong CÙNG chuỗi yêu cầu (thử lại) ⇒ không thêm mức (bắt nguồn từ các phần trước);
 *   • `du-lieu-luong` — nội dung node luồng (biểu thức đã đánh giá, item) ⇒ mức do động cơ luồng (`nguonMuc.loai = "luong"`);
 *   • `tin-v1-client` — tin nhắn `/v1` (token cá nhân, extension: câu người gõ + lịch sử + ngữ cảnh do CLIENT ghép, không chứng minh được là
 *     kỹ thuật) ⇒ `van-hanh` (L0a-b, rà kiem-dinh — trước đây ky-thuat = hiện trạng 10.3);
 *   • `ngu-canh-client` — `context.nguCanh` do client gửi (trang / thực thể / máy đang chọn) ⇒ BỊ BỎ, không bao giờ gửi đi.
 * Đính kèm (ảnh / tệp) KHÔNG có loại — cấm khi model ngoài (cổng `NGOAI_CAM_DINH_KEM`).
 */
import type { MucDuLieu } from "./phanLoai";
import type { TinNhanNgoai } from "./nhaCungCap/kieu";

export type LoaiPhan =
  | "huong-dan-tinh"
  | "cau-go-van-hanh"
  | "cau-go-lap-trinh"
  | "ma-repo"
  | "truy-hoi-kb"
  | "lich-su-client"
  | "ket-qua-tool-van-hanh"
  | "ghi-chu-du-an"
  | "nguon-kiem-dinh"
  | "dau-ra-model"
  | "du-lieu-luong"
  | "tin-v1-client"
  | "ngu-canh-client";

/** `null` = không tự thêm mức (kế thừa / do nơi khác quyết) · `"bo"` = phần bị bỏ, không gửi · `"theo-phan"` = đọc từ phần. */
export const MUC_THEO_LOAI: Readonly<Record<LoaiPhan, MucDuLieu | null | "bo" | "theo-kho" | "theo-phan">> = Object.freeze({
  "huong-dan-tinh": "ky-thuat",
  "cau-go-van-hanh": "van-hanh",
  "cau-go-lap-trinh": "ky-thuat",
  "ma-repo": "ky-thuat",
  "truy-hoi-kb": "theo-kho",
  "lich-su-client": "van-hanh",
  "ket-qua-tool-van-hanh": "van-hanh",
  "ghi-chu-du-an": "van-hanh",
  "nguon-kiem-dinh": "theo-phan",
  "dau-ra-model": null,
  "du-lieu-luong": null,
  "tin-v1-client": "van-hanh",
  "ngu-canh-client": "bo",
});

/** Loại kho truy hồi là tài liệu KỸ THUẬT chung (không mang dữ liệu nhà máy). Mọi giá trị khác hoặc vắng ⇒ `van-hanh`. */
export const LOAI_KHO_KY_THUAT: ReadonlySet<string> = new Set(["vendor", "studio", "api"]);

export type PhanGhep =
  | { loai: Exclude<LoaiPhan, "truy-hoi-kb" | "nguon-kiem-dinh">; noiDung: string }
  | { loai: "truy-hoi-kb"; noiDung: string; loaiKho: string | null | undefined }
  | { loai: "nguon-kiem-dinh"; noiDung: string; muc: MucDuLieu | "luong" };

export interface TinGhep {
  vaiTro: TinNhanNgoai["vaiTro"];
  phan: readonly PhanGhep[];
  tenTool?: string;
  /** Chuỗi nối các phần trong MỘT tin (mặc định hai dòng trống). */
  noi?: string;
}

export interface YeuCauDaGhep {
  readonly tinNhan: readonly TinNhanNgoai[];
  /** Mức của từng phần có mức (đầu vào `nguonMuc.phanDaGhep` của bề mặt). */
  readonly phanDaGhep: readonly MucDuLieu[];
  /** MAX trên toàn bộ phần (không phần nào có mức ⇒ `ky-thuat`). */
  readonly muc: MucDuLieu;
  /** Số phần bị BỎ (`ngu-canh-client`) — để người gọi khai. */
  readonly soPhanBo: number;
}

const DAU = new WeakMap<object, MucDuLieu>();

function mucCuaPhan(p: PhanGhep): MucDuLieu | null | "bo" {
  const m = MUC_THEO_LOAI[p.loai];
  if (m === "theo-kho") return LOAI_KHO_KY_THUAT.has(String((p as { loaiKho?: unknown }).loaiKho ?? "").toLowerCase()) ? "ky-thuat" : "van-hanh";
  if (m === "theo-phan") {
    const mp = (p as { muc?: unknown }).muc;
    return mp === "ky-thuat" ? "ky-thuat" : mp === "luong" ? null : "van-hanh"; // giá trị lạ ⇒ van-hanh (đóng cứng)
  }
  if (m === undefined) return "van-hanh"; // loại lạ lúc chạy (JS / ép kiểu) ⇒ đóng cứng
  return m;
}

/** Dựng yêu cầu. Tin rỗng sau khi bỏ phần ⇒ bỏ cả tin. Chỉ `vaiTro` / `noiDung` / `tenTool` đi ra (không chép trường thừa). */
export function ghepPhan(ds: readonly TinGhep[]): YeuCauDaGhep {
  const tinNhan: TinNhanNgoai[] = [];
  const phanDaGhep: MucDuLieu[] = [];
  let soPhanBo = 0;
  for (const t of ds) {
    const giu: string[] = [];
    for (const p of t.phan) {
      const m = mucCuaPhan(p);
      if (m === "bo") {
        soPhanBo++;
        continue;
      }
      if (m) phanDaGhep.push(m);
      giu.push(String(p.noiDung ?? ""));
    }
    if (giu.length === 0) continue;
    const vaiTro = t.vaiTro;
    tinNhan.push(Object.freeze({ vaiTro, noiDung: giu.join(t.noi ?? "\n\n"), ...(t.tenTool !== undefined ? { tenTool: String(t.tenTool) } : {}) }));
  }
  const muc: MucDuLieu = phanDaGhep.includes("van-hanh") ? "van-hanh" : "ky-thuat";
  const ra = Object.freeze(tinNhan);
  DAU.set(ra, muc);
  return Object.freeze({ tinNhan: ra, phanDaGhep: Object.freeze(phanDaGhep), muc, soPhanBo });
}

/** Mức bộ dựng đã tính cho ĐÚNG mảng này (theo danh tính) — `undefined` nếu mảng không do `ghepPhan` tạo. */
export function mucCuaGhep(tinNhan: unknown): MucDuLieu | undefined {
  return tinNhan !== null && typeof tinNhan === "object" ? DAU.get(tinNhan) : undefined;
}
