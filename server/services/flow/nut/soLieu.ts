/**
 * ★★★ Luồng AI — NODE `du-lieu.so-lieu`: đọc số liệu nhà máy từ DANH MỤC truy vấn có tên (lô Luồng-1, 2026-10-25).
 * Hạng `doc`, idempotent. Chỉ danh mục (`soLieu/danhMuc.ts`) — không SQL tự do; tham số số nguyên bị chặn khoảng.
 * PHẠM VI: của CHỦ LƯỢT tính LÚC CHẠY (`ngu.kiemPhamVi.phamVi`, dựng từ người dùng HIỆN TẠI). Chủ bị khoá / mất vai ghi / xoá ⇒ động cơ không dựng
 * được bộ kiểm ⇒ node TỪ CHỐI (không chạy với quyền cũ). Luồng gắn nhà máy ⇒ dữ liệu ⊆ nhà máy đó. Phạm vi rỗng ⇒ NÉM.
 * Tham số: `truyVan` (CHUỖI CỐ ĐỊNH trong danh mục, không biểu thức) · `gio` (1..168) · `gioiHan` (1..20) · `truongRa` (mặc định `soLieu`).
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { aiFlowEvents } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import { nhaMayCuaLuong } from "../phamViLuong";
import { LoiSoLieu, chaySoLieu, chuanHoaThamSo } from "../soLieu/danhMuc";

/** Loại sự kiện nhật ký lượt ghi tập máy mà các node số liệu đã đọc. */
export const KIND_MAY_DOC = "so-lieu.may-doc";

dangKyNut({
  type: "du-lieu.so-lieu",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "doc",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const { truyVan, ...conLai } = thamSo;
    if (typeof truyVan !== "string" || truyVan.includes("{{")) throw new LoiSoLieu("truyVan phải là chuỗi cố định trong danh mục (không phải biểu thức)", "THAM_SO_SAI");
    const pv = ngu.kiemPhamVi?.phamVi;
    if (!pv) throw new LoiSoLieu("Không xác định được chủ luồng (bị khoá / mất quyền / chưa có chủ lượt) — từ chối đọc số liệu nhà máy.", "CHU_LUOT_KHONG_XAC_DINH");
    const nhaMay = ngu.flowId === "chay-thu" ? null : await nhaMayCuaLuong(ngu.flowId);
    if (nhaMay === undefined) throw new LoiSoLieu("Không tìm thấy luồng để xác định nhà máy.", "CHU_LUOT_KHONG_XAC_DINH");
    const vao = ngu.inputs.main ?? [{ json: {} }];
    const ra = [];
    const mayDoc = new Set<number>();
    for (const item of vao) {
      const t = danhGiaThamSo(conLai, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const tham = chuanHoaThamSo(t);
      const kq = await chaySoLieu(truyVan, tham, pv, nhaMay);
      for (const m of kq.may) mayDoc.add(m);
      ra.push({
        json: { ...item.json, [String(t.truongRa ?? "soLieu")]: { truyVan, khoangGio: tham.gio, soMay: kq.soMay, tong: kq.tong, dong: kq.dong } },
      });
    }
    // ★ Ghi TẬP MÁY đã đọc vào nhật ký lượt (bền, ngoài tầm sửa của tác giả luồng): `tich-hop.thong-bao` đối chiếu phạm vi MÁY của người nhận với tập này.
    if (mayDoc.size > 0) {
      const db = await getDb();
      if (!db) throw new LoiSoLieu("Không ghi được tập máy đã đọc — từ chối.", "CHU_LUOT_KHONG_XAC_DINH");
      await db.insert(aiFlowEvents).values({ runId: ngu.runId, kind: KIND_MAY_DOC, payload: { nodeId: ngu.nodeId, may: [...mayDoc] } });
    }
    return { main: ra };
  },
});
