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
  /**
   * ★★★ §11.5 (Đợt 8) — SỐ WIP đang chờ. `null` = **CHƯA ĐO ĐƯỢC**, không phải 0.
   *
   * Đây là nửa 2D của lớp phủ WIP 3D. Thiếu cột này thì `OngWip` tô một cột đỏ
   * cao ngất mà người đọc chỉ biết "trạm này nóng", không biết "nóng bao nhiêu"
   * — đúng giới hạn thị giác mà §11.5 sinh ra để bù. `undefined` ⇒ không có
   * dữ liệu WIP nào cả (phạm vi không phải Line) ⇒ cột WIP KHÔNG hiện.
   */
  soWip?: number | null;
  /** Trạm này là nút thắt? Phải khớp TUYỆT ĐỐI với cờ `nghen` của cột 3D (G12). */
  nghen?: boolean;
  /** Hạng theo WIP, 1 = nhiều nhất. `null` = chưa đo được. */
  hang?: number | null;
}

export interface DaiLineProps {
  tram: readonly TramTrenDai[];
  onChonTram: (stationId: number) => void;
  stationIdChon?: number | null;
  /**
   * ★★★ §11 #36 — nhịp chuyền THẬT (ms/chiếc). `null` = chưa đo được ⇒ hiện `—`.
   *
   * Cùng con số điều khiển tốc độ mũi tên 3D. In nó ra ĐÂY là điều kiện §11.5
   * áp cho lớp phủ chuyển-động: một mũi tên chạy nhanh hơn nói được "chuyền
   * nhanh hơn", không nói được "12,4 giây một chiếc".
   */
  nhipChuyenMs?: number | null;
}

/** Nhịp ms → chuỗi giây một chữ số thập phân. `null` ⇒ `—` (NT-3: không bịa số). */
export function nhanNhip(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DaiLine({
  tram,
  onChonTram,
  stationIdChon = null,
  nhipChuyenMs = null,
}: DaiLineProps) {
  const { t } = useTranslation();

  // Sắp theo `orderIndex` — đây là chiều DÒNG CHẢY, không phải thứ tự DB trả về.
  const daSap = [...tram].sort((a, b) => a.thuTu - b.thuTu || a.ma.localeCompare(b.ma));

  /**
   * ★ Có lớp WIP hay không quyết định bằng "có khoá `soWip` không", KHÔNG bằng
   *   "có giá trị khác null không". Một chuyền mà MỌI trạm đều `null` (truy vấn
   *   403) vẫn phải hiện cột WIP với `—` — ẩn cột đi là khai rằng WIP không phải
   *   thứ màn này theo dõi, trong khi sự thật là ta không được phép thấy nó.
   */
  const coWip = daSap.some((s) => s.soWip !== undefined);
  const daDoWip = daSap.map((s) => s.soWip).filter((n): n is number => n != null);
  const tongWip = daDoWip.length === 0 ? null : daDoWip.reduce((a, b) => a + b, 0);

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
        {/*
          ★★★ §11 #36 — NHỊP CHUYỀN BẰNG SỐ, cạnh mũi tên động của 3D.
          Mũi tên nói "nhanh hơn"; con số này nói "nhanh hơn bao nhiêu".
        */}
        <span className="text-[10px] text-muted-foreground" data-testid="dai-line-nhip">
          {t("twin3d.vanHanh.nhipChuyen", "Nhịp")}: <b>{nhanNhip(nhipChuyenMs)}</b>
        </span>
        {/* Tổng WIP — chỉ hiện khi CÓ phép đo; `—` khi chưa đo được (NT-3). */}
        {coWip ? (
          <span className="text-[10px] text-muted-foreground" data-testid="dai-line-tong-wip">
            {t("twin3d.vanHanh.tongWip", "WIP")}: <b>{tongWip == null ? "—" : hienSo(tongWip)}</b>
          </span>
        ) : null}
      </div>

      {/*
        ★★★ ĐỢT 35 (Pareto #4) — Ô TRẠM MỘT DÒNG Ở MỌI BỀ RỘNG; THIẾU CHỖ THÌ CUỘN NGANG, KHÔNG GÃY CHỮ.
          Đo 1280×720 (`.qa-dot35/truoc/e3-line-2-1280x720.json`): 12 ô cần 948 px, `ol` có 944 ⇒ các `li`
          bị ép co, và vì chữ "1 machines" ĐƯỢC PHÉP xuống dòng, 11/12 ô gãy thành 2 dòng (cao 70 thay vì
          55) — chỉ ô CONVEYOR có mã dài đủ rộng. `min-w-16` KHÔNG phải nguyên nhân (QA Đợt 32 đoán sai):
          `min-width` chỉ chặn co dưới 64 px, còn ô đang rộng hơn thế mà vẫn gãy.
          ⇒ `whitespace-nowrap` trên ô: min-content của ô = hàng rộng nhất, `li` không co được nữa và `ol`
          cuộn ngang đúng như nó khai (`overflow-x-auto`). Thanh cuộn `scrollbar-width: thin` để dải
          không cao thêm 17 px. Cuộn ngang là câu thật ("chuyền dài hơn màn"); gãy chữ là câu sai.
      */}
      <ol
        className="flex items-stretch gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]"
        aria-label={t("twin3d.vanHanh.daiLine", "Dải chuyền")}
      >
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
                title={`${s.ma} — ${s.ten} — ${t(kieu.khoaNhan)}${
                  coWip ? ` — WIP ${s.soWip == null ? "—" : s.soWip}${s.nghen ? " ★" : ""}` : ""
                }`}
                className={`shrink-0 whitespace-nowrap rounded border px-1 py-1 text-left focus-visible:outline focus-visible:outline-2 ${
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
                {/*
                  ★★★ §11.5 — CỘT WIP: nửa 2D của `OngWip`.

                  `data-nghen` phải khớp TUYỆT ĐỐI với cờ `nghen` của cột 3D —
                  cả hai đến từ cùng `laNghen()` trong `wipTram.ts`, và test
                  §11.5 ghim sự khớp đó. Hai bản cài đặt rời sẽ lệch (G12).
                */}
                {coWip ? (
                  <span
                    className="flex items-center gap-1"
                    data-testid={`o-tram-wip-${s.id}`}
                    data-nghen={s.nghen ? "1" : "0"}
                  >
                    <span
                      className={`text-[10px] font-semibold tabular-nums ${
                        s.nghen ? "text-[color:var(--warning,#f59e0b)]" : "text-foreground"
                      }`}
                    >
                      {s.soWip == null ? "—" : hienSo(s.soWip)}
                    </span>
                    <span className="text-[9px] uppercase text-muted-foreground">
                      {t("twin3d.vanHanh.wipNgan", "WIP")}
                    </span>
                    {/*
                      Hạng — trả lời "hơn bao nhiêu" bằng THỨ TỰ khi con số tuyệt
                      đối chưa đủ ngữ cảnh. Ẩn khi chưa đo được (xếp hạng một
                      trạm mình không biết gì là bịa).
                    */}
                    {s.hang != null ? (
                      <span className="text-[9px] text-muted-foreground">#{hienSo(s.hang)}</span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default DaiLine;
