/**
 * ★★★ 2026-08-24 — PANEL **PROBLEMS**: biến địa điểm lỗi (từ parser `shared/aiCodingLoiViTri.ts`)
 * thành danh sách **bấm-để-nhảy** tệp/dòng cho `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THUẦN HIỂN THỊ — 0 MUTATION, 0 tRPC (đọc kỹ trước khi thêm "một tí" logic)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thành phần này KHÔNG đọc tệp, KHÔNG gọi server, KHÔNG giữ một mảnh trạng thái sống nào của không
 * gian làm việc. Nó nhận một mảng `DiaDiemLoi` đã phân tích sẵn và một callback `onMoTep`. Bấm một
 * mục CHỈ gọi `onMoTep(tep, dong)`; trang mới là nơi `setSelectedPath` + `setDongMucTieu`, và Trình
 * xem vẫn nạp nội dung qua tRPC CŨ (đọc theo đường tệp trong hộp cát) — panel này KHÔNG mở một đường
 * đọc tệp mới. Giữ đúng ranh giới ấy là điều kiện để lưới đơn vị đo được nó bằng `renderToStaticMarkup`
 * (0 phụ thuộc runtime, 0 cửa mạng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ HAI HÌNH DẠNG MỤC — và vì sao `tep === null` CỐ Ý không bấm được
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Parser (v1) chỉ suy ra đường tệp CHẮC CHẮN cho tsc/vitest (đường tương đối gốc repo). Với stack
 * `dotnet`/`node` in đường TUYỆT ĐỐI của máy build, nó cố ý trả `tep:null` — ghép đường tuyệt đối vào
 * cây workspace là rủi ro **mở nhầm tệp**. Panel tôn trọng đúng lằn ranh đó:
 *   • `tep !== null` ⇒ một `<button data-loi-nut>` bấm được — bấm gọi `onMoTep(tep, dong)`.
 *   • `tep === null` ⇒ một `<div data-loi-tin>` KHÔNG bấm được — chỉ hiện `thongDiep` + câu
 *     `unresolvedLocation` ("… — xem Terminal."). Người đọc vẫn thấy "có lỗi chỗ kia" nhưng panel
 *     KHÔNG dựng một liên kết dối. (Nâng đường-tuyệt-đối→tương-đối để dành v2.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO NHÃN NHẢY LÀ MỘT HÀM THUẦN (`nhanNhayTep`) TÁCH RIÊNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Điều kiện `dong !== null` quyết định nhãn "Mở {{tep}} tại dòng {{dong}}" hay "Mở {{tep}}". Nếu điều
 * kiện ấy nằm chìm trong JSX thì lưới chỉ soi được nó qua HTML tĩnh; tách thành hàm thuần cho lưới hỏi
 * THẲNG "dòng=null ra chữ gì" bằng một khẳng định `toBe` — cùng khuôn `thoiGianTuongDoi` của
 * `BoChonPhien`. Component DÙNG chính hàm này (không chép điều kiện lần hai) để nhãn hiển thị và nhãn
 * đo được không bao giờ trôi khỏi nhau.
 *
 * ⚠ Callback KHÔNG rẽ nhánh theo `dong`: `onMoTep(tep, dong)` khi `dong === null` chính là
 *   `onMoTep(tep, null)` — MỘT lời gọi cho cả hai. Chỉ NHÃN rẽ nhánh; đừng đẻ hai đường callback.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowUpRight, FileWarning } from "lucide-react";
import type { DiaDiemLoi } from "@shared/aiCodingLoiViTri";
import { cn } from "@/lib/utils";

/**
 * Hình dạng `t` mà hàm thuần dưới đây cần — khai hẹp để lưới truyền một `t` giả tra thẳng `vi.json`
 * mà không kéo theo kiểu generic của i18next (cùng khuôn `HamDich` của `BoChonPhien`).
 */
type HamDich = (khoa: string, macDinh: string, tham?: Record<string, unknown>) => string;

/**
 * Nhãn truy cập (aria-label/title) của MỘT mục bấm-được. Có dòng ⇒ "Mở {{tep}} tại dòng {{dong}}";
 * chưa biết dòng ⇒ "Mở {{tep}}". THUẦN + nhận `t` tường minh để đo được bằng lưới đơn vị.
 */
export function nhanNhayTep(tep: string, dong: number | null, t: HamDich): string {
  return dong !== null
    ? t("repoWs.problems.jumpFileLine", "Mở {{tep}} tại dòng {{dong}}", { tep, dong })
    : t("repoWs.problems.jumpFileOnly", "Mở {{tep}}", { tep });
}

interface BangProblemsProps {
  /** Địa điểm lỗi đã phân tích, theo THỨ TỰ xuất hiện (parser không khử trùng lặp ở v1). */
  diaDiem: readonly DiaDiemLoi[];
  /** Tệp ĐANG mở ở Trình xem — mục nào trùng đường được tô nổi (thuần thẩm mỹ). */
  tepDangChon: string | null;
  /** Bấm một mục bấm-được ⇒ gọi đúng một lần; trang tự dựng lại trạng thái xem. */
  onMoTep: (tep: string, dong: number | null) => void;
}

export function BangProblems({ diaDiem, tepDangChon, onMoTep }: BangProblemsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div data-bang-problems className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t("repoWs.problems.title", "Vấn đề")}</span>
        <span data-so-dem className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {t("repoWs.problems.count", "{{n}} vấn đề", { n: diaDiem.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
        {diaDiem.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("repoWs.problems.empty", "Không có lỗi nào từ lần chạy gần nhất")}
          </p>
        ) : (
          diaDiem.map((d, i) => {
            const tep = d.tep;

            // ── tep===null ⇒ dòng thông tin, KHÔNG phải nút (v1 đường tuyệt đối không mở nhầm tệp) ──
            if (tep === null) {
              return (
                <div
                  key={i}
                  data-loi-tin
                  className="rounded-md px-1.5 py-1 text-[11px] leading-snug text-muted-foreground"
                >
                  <span className="block truncate" title={d.thongDiep}>
                    {d.thongDiep}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/80">
                    <FileWarning className="h-3 w-3 shrink-0" />
                    {t("repoWs.problems.unresolvedLocation", "Không xác định được vị trí — xem Terminal.")}
                  </span>
                </div>
              );
            }

            // ── tep!==null ⇒ NÚT bấm-được. Nhãn rẽ theo dòng; callback thì KHÔNG (một lời gọi) ──
            const nhan = nhanNhayTep(tep, d.dong, t);
            const dangMo = tepDangChon === tep;
            const viTri = d.dong !== null ? `${tep}:${d.dong}` : tep;
            return (
              <button
                key={i}
                type="button"
                data-loi-nut
                onClick={() => onMoTep(tep, d.dong)}
                aria-current={dangMo ? "true" : undefined}
                aria-label={nhan}
                title={nhan}
                className={cn(
                  "flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted",
                  dangMo && "bg-muted",
                )}
              >
                <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] leading-snug">{d.thongDiep}</span>
                  <span
                    data-vi-tri
                    className={cn(
                      "block truncate text-[10px] tabular-nums",
                      dangMo ? "font-semibold text-primary" : "text-muted-foreground",
                    )}
                  >
                    {viTri}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
