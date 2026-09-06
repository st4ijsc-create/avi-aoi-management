/**
 * DaiLine.tsx — DẢI LINE 2D dưới canvas (§10C.3 mục 3).
 *
 * Một dải thu nhỏ toàn Line: các ô trạm nối nhau theo `orderIndex`, mỗi ô mang
 * màu trạng thái + số máy. **Đồng bộ hai chiều với 3D** — click ô là camera bay
 * tới trạm, và trạm đang chọn trên 3D sáng lên ở đây.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO DẢI NÀY LÀ BẮT BUỘC, KHÔNG PHẢI TRANG TRÍ
 * ════════════════════════════════════════════════════════════════════════════
 * §11.5 đặt luật: *mọi lớp phủ màu trên 3D phải có bản 2D song song*. Lý do là
 * một giới hạn thật của thị giác, không phải sở thích: **màu không cho phép so
 * sánh chính xác**. Nhìn 12 ô màu, người ta đọc được "trạm 5 nóng hơn trạm 4",
 * nhưng KHÔNG đọc được "nóng hơn bao nhiêu" — và câu hỏi vận hành thật luôn là
 * câu thứ hai. Dải này đặt SỐ cạnh màu để trả lời được cả hai.
 *
 * Nó cũng là bề mặt DOM thứ hai (sau `DanhSachMay`) cho phạm vi Line, nên người
 * dùng bàn phím điều hướng được dọc chuyền mà không chạm canvas.
 */

import { useTranslation } from "react-i18next";

import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { hienSo } from "./trungThucDuLieu";

export interface TramTrenDai {
  id: number;
  ma: string;
  ten: string;
  /** `stations.orderIndex` — thứ tự dòng chảy. */
  thuTu: number;
  soMay: number;
  /** Trạng thái ĐÃ xét tuổi (NT-3), lấy từ máy đại diện của trạm. */
  trangThai: string;
}

export interface DaiLineProps {
  tram: readonly TramTrenDai[];
  onChonTram: (stationId: number) => void;
  stationIdChon?: number | null;
}

export function DaiLine({ tram, onChonTram, stationIdChon = null }: DaiLineProps) {
  const { t } = useTranslation();

  // Sắp theo `orderIndex` — đây là chiều DÒNG CHẢY, không phải thứ tự DB trả về.
  const daSap = [...tram].sort((a, b) => a.thuTu - b.thuTu || a.ma.localeCompare(b.ma));

  if (daSap.length === 0) return null;

  return (
    <div className="shrink-0 border-t bg-card px-3 py-1.5" data-testid="dai-line">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("twin3d.vanHanh.daiLine", "Dải chuyền")}
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {t("twin3d.vanHanh.soTram", "{{n}} trạm", { n: hienSo(daSap.length) })}
        </span>
      </div>

      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1" aria-label={t("twin3d.vanHanh.daiLine", "Dải chuyền")}>
        {daSap.map((s, i) => {
          const kieu = mauChoTrangThai(s.trangThai);
          const mau = giaiMauCanh(kieu.token) ?? "#94a3b8";
          const daChon = s.id === stationIdChon;
          return (
            <li key={s.id} className="flex items-center">
              {/* Mũi tên nối — hướng dòng chảy, đọc được kể cả khi 3D tắt. */}
              {i > 0 ? (
                <span aria-hidden="true" className="px-0.5 text-[10px] text-muted-foreground">
                  →
                </span>
              ) : null}
              <button
                type="button"
                data-testid={`o-tram-${s.id}`}
                data-trang-thai={s.trangThai}
                title={`${s.ma} — ${s.ten} — ${t(kieu.khoaNhan)}`}
                className={`min-w-16 rounded border px-1.5 py-1 text-left focus-visible:outline focus-visible:outline-2 ${
                  daChon ? "ring-2 ring-primary" : "hover:bg-accent/60"
                }`}
                style={{ borderColor: mau }}
                onClick={() => onChonTram(s.id)}
              >
                <span className="block truncate text-[10px] font-medium">{s.ma}</span>
                {/*
                  ★ SỐ cạnh MÀU — chính là điểm của §11.5. Một thanh màu đơn
                  thuần không trả lời được "hơn bao nhiêu".
                */}
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: mau, opacity: kieu.doMo }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {t("twin3d.vanHanh.soMayNgan", "{{n}} máy", { n: hienSo(s.soMay) })}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default DaiLine;
