/**
 * ★★★ ĐỢT 4B — "HOÀN TÁC LƯỢT CHẠY": đưa mọi tệp một lượt agent đã chạm về trạng thái GỐC (checkpoint trong bộ nhớ
 * extension), qua ĐÚNG điểm ghi `apBanVa` (đủ hàng rào + sổ kiểm toán — hoàn tác cũng là một lượt ghi có vết).
 *
 * An toàn: đo trạng thái hiện tại của MỌI đường trước; một đường bị sửa tiếp sau AI (băm ≠ băm AI để lại) ⇒ XUNG ĐỘT
 * ⇒ cả lượt hoàn tác bị TỪ CHỐI, không đường nào bị đụng (`lapKeHoachHoanTac`).
 */
import { bamNoiDung } from "../loi/bamTep";
import { lapKeHoachHoanTac, type SoCheckpoint } from "../loi/checkpoint";
import type { DauVaoApBanVa, KetQuaApBanVa } from "./apBanVa";

export interface PhuThuocHoanTac {
  apBanVa: (dv: DauVaoApBanVa) => Promise<KetQuaApBanVa>;
  /** Phần chung của đầu vào điểm ghi (workspace, máy chủ, cookie, mức quyền). */
  dauVaoChung: () => Promise<Pick<DauVaoApBanVa, "thuMucWorkspace" | "nhanWorkspace" | "serverUrl" | "cookie" | "tokenGateway" | "mucQuyen">>;
  /** Băm nội dung hiện tại; `null` = không có tệp; `undefined` = không đo được. */
  docBam: (duongTuyetDoi: string) => Promise<string | null | undefined>;
}

export interface KetQuaHoanTac {
  ok: boolean;
  thongDiep: string;
  chiTiet: string[];
}

export async function hoanTacLuotChay(so: SoCheckpoint, pt: PhuThuocHoanTac): Promise<KetQuaHoanTac> {
  const ds = so.danhSach();
  if (ds.length === 0) return { ok: false, thongDiep: "Lượt chạy này chưa ghi tệp nào — không có gì để hoàn tác.", chiTiet: [] };
  const hienTai = new Map<string, string | null>();
  for (const m of ds) {
    const b = await pt.docBam(m.duongTuyetDoi);
    if (b !== undefined) hienTai.set(m.duongTuyetDoi, b);
  }
  const kh = lapKeHoachHoanTac(ds, hienTai, bamNoiDung);
  if (kh.xungDot.length > 0) {
    return {
      ok: false,
      thongDiep:
        `KHÔNG hoàn tác — ${kh.xungDot.length} tệp đã đổi SAU lượt ghi của AI (xung đột). Không tệp nào bị đụng; ` +
        `hãy xem lại các tệp dưới đây rồi hoàn tác bằng tay (Ctrl+Z / git).`,
      chiTiet: kh.xungDot.map((x) => `${x.duongTuongDoi}: ${x.lyDo}`),
    };
  }
  if (kh.buoc.length === 0) return { ok: true, thongDiep: "Mọi tệp đã ở trạng thái gốc — không cần hoàn tác.", chiTiet: [] };
  const chung = await pt.dauVaoChung();
  const chiTiet: string[] = [];
  let hong = 0;
  for (const b of kh.buoc) {
    const kq = await pt.apBanVa({
      ...chung,
      duongTuyetDoi: b.duongTuyetDoi,
      duongTuongDoi: b.duongTuongDoi,
      bamGoc: b.loai === "tao" ? bamNoiDung("") : b.bamHienTai,
      thaoTac: b.loai === "thay" ? { loai: "thay", noiDungMoi: b.noiDung } : b.loai === "tao" ? { loai: "tao", noiDungMoi: b.noiDung } : { loai: "xoa" },
    });
    if (!kq.ok) hong++;
    chiTiet.push(`${kq.ok ? "✓" : "✗"} ${b.duongTuongDoi}: ${kq.thongDiep}`);
  }
  return {
    ok: hong === 0,
    thongDiep: hong === 0 ? `Đã hoàn tác ${kh.buoc.length} thay đổi của lượt chạy.` : `Hoàn tác KHÔNG trọn vẹn: ${hong}/${kh.buoc.length} bước hỏng — xem chi tiết.`,
    chiTiet,
  };
}
