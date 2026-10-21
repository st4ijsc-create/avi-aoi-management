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
import { layNut, nguCanhItem, type KetQuaChay, type NguCanhChay } from "./dangKyNut";

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
  "ot.de-xuat-luong",
]);

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
}

const thongDiep = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 2000);

function cat<T>(ds: readonly T[] | undefined): T[] {
  return (ds ?? []).slice(0, TRAN_ITEM_CHAY_THU);
}

export async function chayThuNut(y: YeuCauChayThu): Promise<KetQuaChayThu> {
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
    inputs, nodes, env: {}, run: { id: "chay-thu", flowId: "chay-thu", batDau: new Date().toISOString() },
  };

  if (!NUT_CHAY_THAT.has(nut.type) || nut.credentialRef) {
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
      return { che: "chay", ok: true, ms: ms(), cho: { kind, items, hetHanMs, payload } };
    }
    return { che: "chay", ok: true, ms: ms(), output: kq as KetQuaChay };
  } catch (e) {
    return { che: "chay", ok: false, ms: ms(), loi: thongDiep(e) };
  } finally {
    if (dongHo) clearTimeout(dongHo);
  }
}
