/**
 * ★★ Đợt 9.1 — CHẠY THỬ MỘT NODE trong Flow Studio (bản nháp trên canvas, chưa lưu, dữ liệu mẫu do người dùng cấp).
 *
 * KHÔNG ghi gì vào lượt chạy thật: tệp này không import `dongCo` / CSDL / giải mã bí mật (census trong
 * `chayThuNut.test.ts` đọc nguồn). Hai tập, mỗi loại node đã đăng ký PHẢI thuộc đúng một (census ∀ sổ đăng ký):
 *
 *   CHAY       gọi hàm `chay` thật vì nó không đi ra ngoài: node lõi, node AI (qua Cổng AI), `ot.doc-tag` (CHỈ ĐỌC),
 *              `ot.de-xuat-*` (`kiemVaDeXuat` thuần: trả "yêu cầu chờ duyệt" MÔ PHỎNG — việc ghi hàng chờ là của động cơ,
 *              không có ở đây).
 *   XEM_TRUOC  KHÔNG chạy; chỉ đánh giá biểu thức tham số trên item đầu để người dùng thấy node SẼ gửi gì (HTTP, mã,
 *              sinh mã, agent, duyệt người, luồng con, kích hoạt). `credentialRef` chỉ được lặp lại dạng id.
 * Loại chưa phân loại ⇒ xem trước (fail-safe).
 */
import { danhGiaThamSo, type ItemLuong } from "../../../shared/flow/bieuThuc";
import type { NodeInstance } from "../../../shared/flow/model";
import { layNut, nguCanhItem, type BoKiemPhamVi, type KetQuaChay, type NguCanhChay, type VetModel } from "./dangKyNut";
import { LoiNgoaiPhamVi } from "./idTaiNguyen";
export { LoiNgoaiPhamVi };
export type { BoKiemPhamVi };

export const NUT_CHAY_THAT: ReadonlySet<string> = new Set([
  "kich-hoat.thu-cong",
  "du-lieu.dat",
  "logic.neu",
  "logic.gop",
  "ai.llm",
  "ai.trich-xuat",
  "ai.phan-loai",
  "ai.tom-tat",
  "ot.doc-tag",
  "ot.de-xuat-lenh",
]);

/**
 * ★★★ Đợt 9 (IDOR, dieu-phoi 2026-10-21) — node CHAY mà THAM CHIẾU TÀI NGUYÊN bằng id: tham số nào mang id, và loại tài
 * nguyên nào. MỌI id lấy ra (đánh giá biểu thức trên TỪNG item) phải qua `BoKiemPhamVi` TRƯỚC khi node chạy. Thiếu bộ kiểm ⇒
 * node rơi XEM_TRUOC (đóng theo mặc định). Census: node hạng `doc`/`ot` trong CHAY bắt buộc có mặt ở đây.
 */
export const THAM_CHIEU_TAI_NGUYEN: Readonly<Record<string, readonly { tham: string; loai: "may" }[]>> = {
  "ot.doc-tag": [{ tham: "may", loai: "may" }],
  "ot.de-xuat-lenh": [{ tham: "may", loai: "may" }],
};

/** CHAY nhưng KHÔNG tham chiếu tài nguyên theo id (dữ liệu chỉ đến từ item mẫu + biểu thức) — khai tường minh, census đối chiếu. */
export const NUT_KHONG_THAM_CHIEU: ReadonlySet<string> = new Set(["kich-hoat.thu-cong", "du-lieu.dat", "logic.neu", "logic.gop", "ai.llm", "ai.trich-xuat", "ai.phan-loai", "ai.tom-tat"]);



export const NUT_XEM_TRUOC: ReadonlySet<string> = new Set([
  "kich-hoat.lich",
  "kich-hoat.webhook",
  "kich-hoat.mcp",
  "nguoi.duyet",
  "tich-hop.http-doc",
  "tich-hop.http-gui",
  "du-lieu.ma",
  "ai.sinh-ma",
  "ai.agent",
  "luong.goi-con",
  // FOE workflow: không có cột tenant (phạm vi suy từ máy của các bước) và chưa có bộ kiểm ⇒ chỉ xem trước.
  "ot.de-xuat-luong",
]);

export const TRAN_ITEM_CHAY_THU = 100;
export const TRAN_MS_CHAY_THU = 120_000;

export interface YeuCauChayThu {
  nut: NodeInstance;
  /** Item mẫu theo cổng vào (`main`, hoặc `a`/`b` cho `logic.gop`). */
  inputs: Record<string, ItemLuong[]>;
  /** Đầu ra giả định của các node trước, để `$node("id")` dùng được. */
  dauRaNutTruoc?: Record<string, ItemLuong[]>;
}

export interface KetQuaChayThu {
  che: "chay" | "xem-truoc";
  ok: boolean;
  ms: number;
  output?: KetQuaChay;
  /** Node xin CHỜ (duyệt người / đề xuất OT mô phỏng): không ghi hàng chờ, chỉ báo nội dung. */
  cho?: { kind: string; items: ItemLuong[]; hetHanMs?: number; payload?: Record<string, unknown> };
  loi?: string;
  thamSoDaDanhGia?: unknown;
  credentialRef?: string;
  /** Đợt 9 — model thực dự định chạy của từng lần gọi AI trong node (chỉ node ai.*). */
  model?: VetModel[];
}

const thongDiep = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 2000);

function cat<T>(ds: readonly T[] | undefined): T[] {
  return (ds ?? []).slice(0, TRAN_ITEM_CHAY_THU);
}

export async function chayThuNut(y: YeuCauChayThu, boKiem?: BoKiemPhamVi): Promise<KetQuaChayThu> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const { nut } = y;
  const loai = layNut(nut.type);
  if (!loai) return { che: "xem-truoc", ok: false, ms: ms(), loi: `loại node '${nut.type}' chưa đăng ký` };

  const inputs: Record<string, ItemLuong[]> = {};
  for (const [cong, ds] of Object.entries(y.inputs ?? {})) inputs[cong] = cat(ds);
  const nodes: Record<string, ItemLuong[]> = {};
  for (const [id, ds] of Object.entries(y.dauRaNutTruoc ?? {})) nodes[id] = cat(ds);

  const ngu: NguCanhChay = {
    runId: "chay-thu", flowId: "chay-thu", nodeId: nut.id, lan: 1, idempotencyKey: `chay-thu:${nut.id}:1`,
    inputs, nodes, env: {}, kiemPhamVi: boKiem, run: { id: "chay-thu", flowId: "chay-thu", batDau: new Date().toISOString() },
  };

  const thamChieu = THAM_CHIEU_TAI_NGUYEN[nut.type];
  // Đóng theo mặc định: node tham chiếu tài nguyên mà KHÔNG có bộ kiểm phạm vi ⇒ không chạy, chỉ xem trước.
  if (!NUT_CHAY_THAT.has(nut.type) || nut.credentialRef || (thamChieu && !boKiem)) {
    // Xem trước: đánh giá biểu thức trên item đầu của cổng đầu tiên có dữ liệu.
    const vao = inputs.main ?? Object.values(inputs).find((d) => d.length) ?? [];
    try {
      const item: ItemLuong = vao[0] ?? { json: {} };
      const thamSo = danhGiaThamSo(nut.parameters ?? {}, nguCanhItem(ngu, item, vao));
      return { che: "xem-truoc", ok: true, ms: ms(), thamSoDaDanhGia: thamSo, ...(nut.credentialRef ? { credentialRef: nut.credentialRef } : {}) };
    } catch (e) {
      return { che: "xem-truoc", ok: false, ms: ms(), loi: thongDiep(e) };
    }
  }

  const vet: VetModel[] = [];
  ngu.ghiModel = (v) => void vet.push(v);
  const kemModel = <T extends object>(r: T): T & { model?: VetModel[] } => (vet.length ? { ...r, model: vet } : r);

  if (nut.disabled) return { che: "chay", ok: true, ms: ms(), output: { main: inputs.main ?? [] } };

  let dongHo: ReturnType<typeof setTimeout> | undefined;
  try {
    const kq = await Promise.race([
      loai.chay(nut.parameters ?? {}, ngu),
      new Promise<never>((_, tu) => {
        dongHo = setTimeout(() => tu(new Error(`quá ${TRAN_MS_CHAY_THU / 1000} giây — dừng chờ`)), TRAN_MS_CHAY_THU);
      }),
    ]);
    if (kq && typeof kq === "object" && "__cho" in kq) {
      const { kind, items, hetHanMs, payload } = (kq as { __cho: { kind: string; items: ItemLuong[]; hetHanMs?: number; payload?: Record<string, unknown> } }).__cho;
      return kemModel({ che: "chay", ok: true, ms: ms(), cho: { kind, items, hetHanMs, payload } });
    }
    return kemModel({ che: "chay", ok: true, ms: ms(), output: kq as KetQuaChay });
  } catch (e) {
    // Phạm vi do NODE kiểm (cùng giá trị node dùng) — ngoài phạm vi phải đi tới router thành NOT_FOUND, không thành "lỗi node".
    if (e instanceof LoiNgoaiPhamVi) throw e;
    return kemModel({ che: "chay", ok: false, ms: ms(), loi: thongDiep(e) });
  } finally {
    if (dongHo) clearTimeout(dongHo);
  }
}
