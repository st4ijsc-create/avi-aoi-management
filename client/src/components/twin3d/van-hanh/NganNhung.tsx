/**
 * NganNhung.tsx — **XEM CHI TIẾT TẠI CHỖ** trên `/twin` (Đợt 10 mục 5, §11e.5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ YÊU CẦU NGUYÊN VĂN CỦA CHỦ SỞ HỮU
 * ════════════════════════════════════════════════════════════════════════════
 * *"Các phần khi xem chi tiết của máy/Line không sử dụng redirect chuyển trang
 * để xem rất bất tiện, cần sử dụng dialog hoặc modal hiển thị thông tin/hiển
 * thị trên panel đó luôn và có phím back cũng được để ng dùng không cần rời màn
 * hình 3D digital Twin"*
 *
 * Bốn thứ câu đó đòi, và chỗ mỗi thứ được cài:
 *   1. KHÔNG redirect         → `NganXuLy.tsx` gọi `onMoTaiCho`, không `onDieuHuong`
 *   2. dialog / modal / panel → `Sheet` (Radix Dialog) — modal thật, có overlay
 *   3. **phím back**          → nút `← Quay lại 3D` ở đầu ngăn (+ `Esc` và nút X
 *                               do Radix cấp sẵn — xem "VÌ SAO SHEET" bên dưới)
 *   4. không rời màn 3D       → URL vẫn là `/twin`; chỉ thêm `?xem=…`
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NHÚNG THÂN MÀN CŨ — KHÔNG DỰNG LẠI (§11b/§11c.7, G12)
 * ════════════════════════════════════════════════════════════════════════════
 * Ba đích đều là **màn KHÔNG ĐƯỢC XOÁ**. Ngăn này render **chính thân của
 * chúng**:
 *   `MachineCockpitBody`   — `MachineCockpit.tsx` (đã có sẵn từ doc 59 P1)
 *   `RobotCockpitBody`     — `RobotCockpit.tsx` (tách ở đợt này)
 *   `StationAnalysisBody`  — `StationAnalysis.tsx` (tách ở đợt này)
 *
 * ⇒ KHÔNG có phép tính thứ hai, KHÔNG có bản sao tính năng. Sửa cockpit một
 *   chỗ thì cả `/robot/:id` lẫn ngăn trong Twin đổi cùng lúc — đúng thứ G12
 *   đòi. Nếu ta chép sáu tính năng sang Twin, hai bản sẽ lệch ngay lần sửa đầu,
 *   và bản ở Twin sẽ là bản không ai nhớ để sửa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO `Sheet` (Radix Dialog) CHỨ KHÔNG PHẢI MỘT `<div absolute>`
 * ════════════════════════════════════════════════════════════════════════════
 * Bản đầu của tệp này là một `div` phủ, và nó phải TỰ cài lại bốn thứ mà Radix
 * đã có, mỗi thứ là một chỗ dễ sai:
 *   • `Esc` để đóng            — thiếu ⇒ bẫy bàn phím
 *   • focus trap               — thiếu ⇒ Tab đi xuyên qua ngăn xuống cảnh 3D
 *                                 phía sau, người dùng bàn phím "mất" con trỏ
 *   • trả focus về nút đã mở   — thiếu ⇒ đóng ngăn xong focus rơi về `<body>`
 *   • `aria-modal` + khoá cuộn nền
 * Radix cấp cả bốn, đã kiểm chứng. Tự viết lại chúng là G12 ở tầng hạ tầng.
 *
 * ⚠ `Sheet` **portal ra `document.body`** ⇒ ngăn KHÔNG bị kẹt trong cột phải
 *   `w-80` của `NganXuLy` (320 px — quá hẹp cho một cockpit). Đó cũng là lý do
 *   component này không cần tổ tiên `position: relative` nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO `lazy()` LÀ BẮT BUỘC, KHÔNG PHẢI TỐI ƯU
 * ════════════════════════════════════════════════════════════════════════════
 * `StationAnalysis.tsx` ~2.7k LOC (`App.tsx:236` đã code-split nó vì đúng lý do
 * đó), `RobotCockpit.tsx` ~900 LOC, `MachineCockpit.tsx` ~1.2k LOC — kéo theo
 * recharts, bộ xuất báo cáo, panel teach/jog. Import TĨNH ba thứ đó vào
 * `NganXuLy` sẽ nhét chúng vào **bundle của màn 3D**: mọi người mở `/twin` phải
 * tải cả ba dù không bao giờ bấm, trong khi §4 đo tải cảnh bằng ms.
 *
 * ⚠ `lazy()` phải khai ở **cấp module**, không trong thân component: khai trong
 *   thân sinh một kiểu component MỚI mỗi lần render ⇒ React tháo và dựng lại
 *   toàn bộ cây con mỗi lần cha render, mất sạch state của cockpit (tab đang
 *   mở, buffer teach/jog) mà **không lỗi nào nổ**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ LỐI THOÁT PHỤ — GIỮ, KHÔNG BỎ
 * ════════════════════════════════════════════════════════════════════════════
 * Nút "Mở màn đầy đủ" mở `href` gốc trong **tab mới**. Ba lý do giữ: (a) người
 * dùng muốn hai màn cạnh nhau; (b) vài thao tác hợp với cả trang hơn là ngăn;
 * (c) nó là đường thoát khi ngăn lỗi. Nó **không** phải mặc định — mặc định là
 * tại chỗ, đúng yêu cầu.
 */
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import {
  cauChoLyDoNgan,
  hrefGocCuaNgan,
  khoaTieuDeNhung,
  nhanDuPhongNhung,
  type LyDoNgan,
  type NganNhungMo,
} from "./nhungTaiCho";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* THÂN NHÚNG — nạp lười, khai ở CẤP MODULE (xem docblock)                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const ThanMay = lazy(() =>
  import("@/pages/MachineCockpit").then((m) => ({ default: m.MachineCockpitBody })),
);
const ThanRobot = lazy(() =>
  import("@/pages/RobotCockpit").then((m) => ({ default: m.RobotCockpitBody })),
);
const ThanTram = lazy(() =>
  import("@/pages/StationAnalysis").then((m) => ({ default: m.StationAnalysisBody })),
);

/* ═══════════════════════════════════════════════════════════════════════════ */

export interface NganNhungProps {
  /** Ngăn đang mở; `null` ⇒ không render gì (ngăn đóng). */
  ngan: NganNhungMo | null;
  /** Nhãn phụ dưới tiêu đề — mã/tên vật thể, để người dùng biết đang xem CÁI GÌ. */
  nhanPhu?: string;
  /** Đóng ngăn — tầng trên xoá `?xem=` khỏi URL. */
  onDong: () => void;
  /**
   * ★★★ ĐỢT 24 VIỆC 3 (L-5) — VÌ SAO ngăn này mở được, hoặc không.
   *
   * Bỏ trống ⇒ `"mo"` (hành vi cũ y nguyên), nên mọi chỗ gọi chưa nối KHÔNG
   * đổi hành vi. Khác `"mo"` ⇒ ngăn vẫn MỞ nhưng thân đổi thành **một câu nói
   * rõ lý do**, thay vì một cockpit rỗng tự 403 bên trong.
   *
   * ⚠ Vì sao vẫn mở Sheet thay vì render `null`: `?xem=` CÓ trong URL, nên
   *   người dùng ĐANG CHỜ một ngăn. Trả `null` là quay lại đúng sự im lặng mà
   *   L-5 mô tả — màn không mở gì và không nói gì.
   */
  lyDo?: LyDoNgan;
}

/**
 * Ngăn chi tiết tại chỗ.
 *
 * ★ §9.9 — MỌI THỨ Ở ĐÂY LÀM ĐƯỢC TỪ BÀN PHÍM: ngăn là DOM thật (không phải
 *   lớp phủ WebGL), nút quay lại là `<button>` thật và là phần tử ĐẦU TIÊN
 *   trong thứ tự đọc, nên Tab một lần từ lúc mở là chạm nó.
 */
export function NganNhung({ ngan, nhanPhu, onDong, lyDo = "mo" }: NganNhungProps) {
  const { t } = useTranslation();

  if (ngan === null) return null;
  const biChan = lyDo !== "mo";

  const tieuDe = t(khoaTieuDeNhung(ngan.loai), nhanDuPhongNhung(ngan.loai));
  const hrefGoc = hrefGocCuaNgan(ngan);

  return (
    <Sheet
      open
      onOpenChange={(mo) => {
        // Radix gọi với `false` cho Esc, click overlay, và nút X — cả ba đều là
        // "quay lại 3D", nên cả ba đi qua đúng một đường đóng.
        if (!mo) onDong();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
        /*
          ★ Radix cảnh báo nếu `DialogContent` không có mô tả. Ở đây `SheetTitle`
            + nhãn phụ (mã · tên máy) ĐÃ nói đủ "đang xem cái gì"; một đoạn mô tả
            nữa chỉ lặp lại và làm trình đọc màn hình dài dòng hơn. `undefined`
            TƯỜNG MINH là cách Radix ghi nhận "đã cân nhắc và cố ý bỏ", khác với
            việc quên — nó tắt cảnh báo mà vẫn để lại dấu vết của quyết định.
        */
        aria-describedby={undefined}
        data-testid="ngan-nhung"
        data-loai={ngan.loai}
        data-id={String(ngan.id)}
      >
        {/* ── Đầu ngăn: NÚT QUAY LẠI là thứ đầu tiên trong thứ tự đọc ──── */}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 pr-12">
          <Button
            size="sm"
            variant="ghost"
            data-testid="nut-quay-lai-nhung"
            onClick={onDong}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("twin3d.vanHanh.nhung.quayLai", "Quay lại 3D")}
          </Button>

          <div className="min-w-0 flex-1">
            {/*
              `SheetTitle` bắt buộc với Radix Dialog — thiếu nó, Radix cảnh báo
              và trình đọc màn hình không có tên cho hộp thoại.
            */}
            <SheetTitle className="truncate text-sm" data-testid="tieu-de-nhung">
              {tieuDe}
            </SheetTitle>
            {nhanPhu ? (
              <p className="truncate text-xs text-muted-foreground">{nhanPhu}</p>
            ) : null}
          </div>

          {/*
            ★ LỐI THOÁT PHỤ — tab MỚI, không `setLocation`. Dùng `setLocation` ở
              đây sẽ rời `/twin` và làm mất đúng ngữ cảnh mà cả tính năng này
              sinh ra để giữ; `target="_blank"` cho người dùng cả hai màn.
            ⚠ `rel="noreferrer"` bắt buộc với `_blank`: thiếu nó, trang mới giữ
              `window.opener` và điều hướng được trang Twin đi chỗ khác.
          */}
          <Button size="sm" variant="ghost" asChild data-testid="nut-mo-man-day-du">
            <a href={hrefGoc} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t("twin3d.vanHanh.nhung.moDayDu", "Mở màn đầy đủ")}
            </a>
          </Button>
        </div>

        {/* ── Thân: chính nội dung của màn cũ, cuộn trong ngăn ──────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="than-nhung">
          {biChan ? (
            /*
              ★★★ ĐỢT 24 VIỆC 3 (L-5) — MỘT CÂU NÓI RÕ LÝ DO, KHÔNG PHẢI IM LẶNG.

              ⚠ `data-ly-do` mang MÃ MÁY ĐỌC ĐƯỢC, không phải câu đã dịch: nghiệm
                thu phải phân biệt được `ngoaiPhamVi` với `thieuQuyen` mà không
                phụ thuộc ngôn ngữ đang bật (một lưới đọc chữ tiếng Việt sẽ đỏ
                giả khi ai đó đổi `en`).
            */
            <div
              className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
              data-testid="ngan-nhung-bi-chan"
              data-ly-do={lyDo}
              role="status"
            >
              <AlertTriangle className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">
                {t(cauChoLyDoNgan(lyDo).khoa, cauChoLyDoNgan(lyDo).duPhong)}
              </p>
              {/*
                ★ Hành động ĐI KÈM câu: nói "ngoài phạm vi" rồi để người dùng tự
                  tìm đường ra là mới nói được một nửa. Nút này đóng ngăn (xoá
                  `?xem=`) và trả họ về cảnh 3D đang xem.
              */}
              <Button size="sm" variant="outline" onClick={onDong} data-testid="nut-dong-ngan-bi-chan">
                {t("twin3d.vanHanh.nhung.quayLai", "Quay lại 3D")}
              </Button>
            </div>
          ) : (
            <Suspense fallback={<DangNap />}>
              {ngan.loai === "machine" ? <ThanMay machineId={ngan.id} embedded /> : null}
              {ngan.loai === "robot" ? <ThanRobot robotId={ngan.id} embedded /> : null}
              {ngan.loai === "station" ? <ThanTram stationId={ngan.id} embedded /> : null}
            </Suspense>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Trạng thái nạp chunk — có `role="status"` để trình đọc màn hình biết. */
function DangNap() {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
      data-testid="nhung-dang-nap"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {t("twin3d.vanHanh.nhung.dangNap", "Đang tải nội dung…")}
    </div>
  );
}
