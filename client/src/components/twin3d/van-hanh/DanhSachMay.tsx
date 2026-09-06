/**
 * DanhSachMay.tsx — danh sách máy ở panel trái. **§9.9 — BẮT BUỘC, KHÔNG PHẢI
 * TUỲ CHỌN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO NÓ TỒN TẠI: CANVAS 3D VÔ HÌNH VỚI TRÌNH ĐỌC MÀN HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Một `<canvas>` WebGL không có cây DOM bên trong — trình đọc màn hình thấy MỘT
 * ô trống, và bàn phím không có gì để Tab vào. Nếu chọn máy chỉ làm được bằng
 * cách click lên canvas thì người dùng bàn phím và người khiếm thị **mất hoàn
 * toàn** đường xử lý công việc, không phải mất một tính năng phụ.
 *
 * ⇒ Danh sách này là DOM THẬT: mỗi máy một `<button>`, Tab tới được, Enter chọn
 *   được, focus ring rõ. Selection ở đây và selection trên 3D là **CÙNG MỘT
 *   state** ở `TwinVanHanh` — đồng bộ hai chiều, không phải hai bản sao.
 *
 * ★ Và vì `NganXuLy` mở theo selection, đường
 *      **Tab → Enter → (ngăn mở) → Tab → Enter trên nút Xác nhận**
 *   là một đường ack alarm KHÔNG đi qua WebGL một bước nào. Đó chính là phép đo
 *   §9.9 mà cổng ra số 5 yêu cầu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-3 — DANH SÁCH PHẢI NÓI CÙNG MỘT CÂU VỚI CẢNH 3D
 * ════════════════════════════════════════════════════════════════════════════
 * `trangThaiTheoMay` truyền vào ĐÃ qua `trangThaiHienThi()`, nên một máy khai
 * `running` với dữ liệu hai tháng tuổi hiện là "Không rõ" ở ĐÂY y như trên cảnh.
 * Nếu danh sách đọc `operationStatus` thô, hai bề mặt sẽ nói hai câu khác nhau
 * về cùng một máy — và bảng chữ luôn được tin hơn một ô màu.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { hienSo, nhanDoTuoi, type MayVanHanh } from "./trungThucDuLieu";

export interface DanhSachMayProps {
  may: readonly MayVanHanh[];
  /** Trạng thái ĐÃ xét tuổi — cùng nguồn với cảnh 3D. */
  trangThaiTheoMay: ReadonlyMap<number, string>;
  machineIdChon: number | null;
  onChonMay: (machineId: number) => void;
  bayGio: number;
  dangTai: boolean;
}

export function DanhSachMay({
  may,
  trangThaiTheoMay,
  machineIdChon,
  onChonMay,
  bayGio,
  dangTai,
}: DanhSachMayProps) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState("");

  const hienThi = useMemo(() => {
    const q = loc.trim().toLowerCase();
    const ds = q
      ? may.filter((m) => m.ma.toLowerCase().includes(q) || m.ten.toLowerCase().includes(q))
      : [...may];
    /**
     * Sắp: BẤT THƯỜNG trước, rồi "không rõ", rồi theo mã.
     * Máy cần chú ý phải ở đầu danh sách — người dùng bàn phím Tab từ trên
     * xuống, nên thứ tự này quyết định họ gặp việc gấp sau mấy lần Tab.
     */
    return ds.sort((a, b) => {
      const ta = trangThaiTheoMay.get(a.id) ?? "khong_ro";
      const tb = trangThaiTheoMay.get(b.id) ?? "khong_ro";
      const wa = mauChoTrangThai(ta).laBatThuong ? 0 : ta === "khong_ro" ? 1 : 2;
      const wb = mauChoTrangThai(tb).laBatThuong ? 0 : tb === "khong_ro" ? 1 : 2;
      if (wa !== wb) return wa - wb;
      return a.ma.localeCompare(b.ma);
    });
  }, [may, loc, trangThaiTheoMay]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="danh-sach-may">
      <div className="shrink-0 p-2">
        <Input
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          placeholder={t("twin3d.cay.loc", "Lọc theo tên hoặc mã…")}
          className="h-7 text-xs"
          data-testid="o-loc-may"
          aria-label={t("twin3d.cay.loc", "Lọc theo tên hoặc mã…")}
        />
      </div>

      {/*
        `role="listbox"` + `aria-activedescendant` là khuôn ARIA đúng cho một
        danh sách CHỌN ĐƯỢC (khác `list`, vốn chỉ để đọc).
      */}
      <ul
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        role="listbox"
        aria-label={t("twin3d.vanHanh.danhSachMay", "Danh sách máy")}
        data-so-may={hienThi.length}
      >
        {dangTai ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">—</li>
        ) : hienThi.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground" data-testid="danh-sach-rong">
            {t("twin3d.cay.khongKhop", "Không có mục nào khớp")}
          </li>
        ) : (
          hienThi.map((m) => {
            const tt = trangThaiTheoMay.get(m.id) ?? "khong_ro";
            const kieu = mauChoTrangThai(tt);
            const mau = giaiMauCanh(kieu.token) ?? "#94a3b8";
            const tuoi = nhanDoTuoi(m.thoiDiemDuLieu, bayGio);
            const daChon = m.id === machineIdChon;
            return (
              <li key={m.id} role="option" aria-selected={daChon}>
                <button
                  type="button"
                  data-testid={`may-hang-${m.id}`}
                  data-trang-thai={tt}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${
                    daChon ? "bg-accent font-medium" : "hover:bg-accent/60"
                  }`}
                  onClick={() => onChonMay(m.id)}
                >
                  {/*
                    Chấm màu + HOẠ TIẾT — mã hoá dư thừa (§10.3 luật 2). Chỉ màu
                    là không đủ: mù màu đỏ-lục là ~8 % nam giới.
                  */}
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: mau,
                      opacity: kieu.doMo,
                      // Gạch chéo cho `khong_ro` — vòng ngoài rỗng thay vì đặc.
                      boxShadow: kieu.hoaTiet === "gach_cheo" ? `inset 0 0 0 1px ${mau}` : undefined,
                      backgroundImage:
                        kieu.hoaTiet === "gach_cheo"
                          ? `repeating-linear-gradient(45deg, transparent 0 1px, ${mau} 1px 2px)`
                          : undefined,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{m.ma}</span>
                  {/* Chữ trạng thái — chiều thứ ba của mã hoá dư thừa. */}
                  <span className="shrink-0 text-[10px] text-muted-foreground">{t(kieu.khoaNhan)}</span>
                  {/*
                    ★ NT-3.5 — máy chưa từng báo cáo hiện `—`, KHÔNG hiện `0s`.
                    "0 giây trước" nghĩa là vừa cập nhật — đúng ngược sự thật.
                  */}
                  <span
                    className={`w-10 shrink-0 text-right text-[10px] ${tuoi.do ? "text-destructive" : "text-muted-foreground"}`}
                    data-testid={`tuoi-${m.id}`}
                  >
                    {tuoi.giay === null ? "—" : `${hienSo(tuoi.giay)}s`}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export default DanhSachMay;
