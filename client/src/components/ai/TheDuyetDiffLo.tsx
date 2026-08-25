/**
 * ★★★ 2026-08-24 · THẺ DUYỆT **LÔ** (`apply_diff_batch`) — N TỆP, MỖI TỆP MỘT TAB, MỖI TAB MỘT DIFF THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ TỆP NÀY — lỗ THẬT đang vá
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff_batch` đã là write-tool sống trên server (doc 79): một thẻ duyệt, N hành động, N băm
 * neo RIÊNG, ghi từng phần có báo cáo. Nhưng CLIENT chưa đặc-cách nó — khi model đề xuất sửa NHIỀU
 * tệp, thẻ rơi vào `ConfirmActionCard` chung, hiện danh sách before/after **phẳng, nội dung bị CẮT
 * ở 2.000 ký tự + che bí mật** (`trich`), **KHÔNG phải diff**. Người duyệt được mời bấm "ghi N tệp"
 * mà không nhìn thấy N thay đổi thật. Component này thay bằng: mỗi tệp một TAB, mỗi tab một
 * `HunkDiffView` **chỉ-đọc** (diff thật, dòng-theo-dòng), cảnh báo theo-tệp gắn đúng tab của nó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LUẬT HÌNH HỌC KẾ THỪA TỪ `TheDuyetDiff` — nút ghi và đường thoát CÙNG THẤY, hoặc CÙNG KHÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu live 2026-08-23 (Playwright) từng đo nút "Hủy" của thẻ một-tệp chỉ hiện **9,2–12,2%**
 * bề rộng trong khi nút ghi hiện 100% — vì `flex`+`flex-1` chia phần theo bề rộng CHA đã phình. Thẻ
 * lô thừa hưởng **nguyên** ba chốt của bài học ấy, và chúng là HỆ QUẢ HÌNH HỌC chứ không phải lời dặn:
 *   1. Thẻ `min-w-0 max-w-full` — VỪA KHUNG, không tràn rồi trông cậy thanh cuộn ngang.
 *   2. `[data-hang-nut]` là `grid grid-cols-2` — HAI Ô BẰNG NHAU TUYỆT ĐỐI; không còn cấu hình nào
 *      để một nút hiện 100% còn nút kia 12%. ⚠ KHÔNG đổi về `flex`/`flex-1`, KHÔNG cho riêng một ô
 *      `min-w-*`/`col-span-*` (cả ba đều phá đối xứng).
 *   3. Dòng diff (nội dung thật-sự-rộng) tự cuộn TRONG hộp của `HunkDiffView` (`min-w-0` + overflow
 *      nội bộ), nên nó KHÔNG kéo thẻ rộng ra.
 * Khối "phải đọc" (đồng hồ TTL + cảnh báo CHUNG + tab strip điều hướng) được **ghim trên**
 * (`sticky top-0`) theo đúng bài học trục DỌC: hội thoại tự cuộn xuống đáy ⇒ nếu không ghim thì thứ
 * lọt vào mắt là hàng nút còn cảnh báo trôi lên trên nếp gấp.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LÔ **KHÔNG** HỖ TRỢ CHỌN-KHỐI-LẺ — cố ý, không dở dang. Nên `onConfirm: () => void`, KHÔNG tham số
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff` (một tệp) cho người duyệt chọn từng khối (`selectedHunkIds`). Lô thì KHÔNG: server tự
 * chặn `HUNK_IDS_INVALID` nếu một confirm của tool này kèm `selectedHunkIds` (xem docblock
 * `applyDiffBatch.ts`). Chọn-khối-theo-tệp cần MỖI TỆP MỘT KẾ HOẠCH KHỐI riêng + một hình dạng dây
 * `{fileIndex, hunkIndex}` + một UI phân trang — là một đợt RIÊNG. Vì thế mọi `HunkDiffView` ở đây
 * bật `readOnly` (ẩn nút Nhận/Hoàn tác khối, checkbox EOL, băng stale — KHÔNG một byte nào ghi được
 * qua chế độ ấy), và `onConfirm` **không mang tham số**. Đây là HỢP ĐỒNG mà Wave nối-dây phụ thuộc:
 * thêm tham số cho `onConfirm` hay dựng UI checkbox chọn khối = mở đúng lỗ "chỉ số trỏ nhầm tệp".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THUẦN HIỂN THỊ — như `TheDuyetDiff`/`BoChonPhien`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `onConfirm`/`onCancel` chỉ là callback; component KHÔNG gọi `confirmM`/tRPC/mutation nào. Trang
 * (Wave sau) trỏ chúng về `handleConfirm`/`handleCancel` — ĐÚNG MỘT điểm gọi `confirmM.mutateAsync`.
 * Tách khỏi trang để lưới `renderToStaticMarkup` dựng CÂY THẬT (bài học F1/F14: lưới quét VĂN BẢN mã
 * nguồn thì mù với đường thoát thật).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clock, FileStack, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HunkDiffView } from "@/components/diff/HunkDiffView";
import { useTtlCountdown, type ActionState } from "@/components/ConfirmActionCard";
import { keHoachKhoiDuyet, planStats } from "@/lib/diffHunks";
import { baseName } from "@/lib/repoPath";
import { cn } from "@/lib/utils";
import { tachCanhBaoKyThuat, type DiffArgs, type HanhDongCanDuyet } from "./TheDuyetDiff";

/**
 * ★ BÓC cảnh báo CHUNG khỏi cảnh báo THEO TỆP. Hàm THUẦN (không React) để lưới đo được một mình.
 *
 * `applyDiffBatch.ts · xemTruoc` sinh MỘT mảng `warnings` phẳng gồm hai loại đặt liền nhau:
 *   • CHUNG — cả-lô: câu "N tệp, MỖI TỆP MỘT BĂM NEO RIÊNG…", và (khi có) câu không-git. KHÔNG có
 *     tiền tố `#`.
 *   • THEO TỆP — mỗi mục có tiền tố **`#{stt} {relPath} — …`** (stt 1-based, đúng vị trí trong lô).
 * Ta tách theo tiền tố `#{stt} ` (khớp `/^#(\d+)\s/`) và gắn từng cảnh báo theo-tệp vào TAB tương
 * ứng (panel `stt`). Cảnh báo chung ở khối ghim trên — in một lần, không loãng.
 * ⚠ Khuôn chuỗi này do server đặt; nếu `xemTruoc` đổi tiền tố thì đồng bộ tay ở đây VÀ trong lưới
 *   (`theDuyetDiffLo.unit.test.ts` hardcode cùng khuôn — giống `theDuyetDiff.unit.test.ts`).
 */
export function phanLoaiCanhBaoLo(warnings: string[]): {
  chung: string[];
  theoTep: Map<number, string[]>;
} {
  const chung: string[] = [];
  const theoTep = new Map<number, string[]>();
  for (const w of warnings) {
    const m = /^#(\d+)\s/.exec(w);
    if (m) {
      const stt = Number(m[1]);
      const arr = theoTep.get(stt) ?? [];
      arr.push(w);
      theoTep.set(stt, arr);
    } else {
      chung.push(w);
    }
  }
  return { chung, theoTep };
}

/**
 * ⚠ HỢP ĐỒNG (Wave nối-dây phụ thuộc — CHỐT CỨNG):
 *   • `action` — cùng KIỂU `HanhDongCanDuyet` mà `TheDuyetDiff` đọc (chỉ `expiresAt` + `preview.warnings`).
 *   • `files`  — `DiffArgs[]` (mỗi mục `{ path, original, modified }`), thứ tự = thứ tự `#{stt}` server.
 *   • `onConfirm: () => void` — **KHÔNG tham số**. Lô không chọn-khối-lẻ (xem docblock đầu tệp).
 */
export function TheDuyetDiffLo({
  action,
  files,
  state,
  busy,
  onConfirm,
  onCancel,
}: {
  action: HanhDongCanDuyet;
  files: DiffArgs[];
  state: ActionState;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ttl = useTtlCountdown(action.expiresAt, state === "pending");
  const { chung, theoTep } = useMemo(
    () => phanLoaiCanhBaoLo(action.preview?.warnings ?? []),
    [action.preview],
  );

  /**
   * Tab đang chọn — reset về 0 khi TẬP TỆP đổi (đề xuất mới). Khoá theo `files.map(path).join("|")`
   * đúng khuôn `khoaKeHoach` của `TheDuyetDiff` (một chuỗi tất định của danh sách, không phải tham
   * chiếu mảng — mảng mới cùng nội dung KHÔNG được coi là đổi).
   */
  const khoaTep = files.map((f) => f.path).join("|");
  const [tabDangChon, setTabDangChon] = useState(0);
  useEffect(() => {
    setTabDangChon(0);
  }, [khoaTep]);

  /**
   * Badge `+N/−M` cho nút tab. Dùng `keHoachKhoiDuyet` — **KHÔNG** `computeHunkPlan` trần — vì đó
   * đúng là kế hoạch mà `HunkDiffView` tự dựng theo mặc định (nó bật `matchEol` khi phát hiện lệch
   * EOL, và `keHoachKhoiDuyet` = `computeHunkPlan(o, m, { matchEol: detectEol(o) !== detectEol(m) })`).
   * ⇒ con số trên badge = con số của diff hiển thị bên dưới, TỪNG TRƯỜNG HỢP. Một badge `+1602/−1602`
   * đứng trên một diff `+1/−0` (ca lệch EOL của `computeHunkPlan` trần) chính là lớp lỗi "con số nói
   * dối" mà doc 79 ghi lại — tránh nó bằng cách dùng CÙNG một hàm hai đầu.
   */
  const badges = useMemo(
    () => files.map((f) => planStats(keHoachKhoiDuyet(f.original, f.modified))),
    [files],
  );

  return (
    // `min-w-0 max-w-full` — thẻ phải VỪA KHUNG (xem luật hình học ở đầu tệp).
    <div
      data-the-duyet-lo="apply_diff_batch"
      className="min-w-0 max-w-full space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30"
    >
      {/*
        KHỐI "PHẢI ĐỌC" GHIM TRÊN — đồng hồ + cảnh báo CHUNG + tab strip điều hướng. `sticky top-0`
        giữ chúng dính mép trên chừng nào thẻ còn trong khung; diff dài bao nhiêu cũng không đẩy
        chúng xuống dưới nếp gấp. `-mx-3 -mt-3 px-3 pt-3` để nền phủ hết bề ngang thẻ (thẻ có `p-3`).
      */}
      <div
        data-ghim-tren
        className="sticky top-0 z-10 -mx-3 -mt-3 space-y-2 rounded-t-md bg-amber-50 px-3 pb-2 pt-3 dark:bg-amber-950"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
            <FileStack className="size-4 shrink-0" />
            <span className="min-w-0 break-words">
              {t("repoWs.diff.batchCardTitle", "Đề xuất SỬA {{n}} tệp — cần bạn duyệt", { n: files.length })}
            </span>
          </div>
          {state === "pending" && (
            <span
              data-dong-ho-ttl
              className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <Clock className="size-3.5" />
              {ttl.expired ? "0:00" : ttl.label}
            </span>
          )}
        </div>

        {/*
          ★★★ CẢNH BÁO CHUNG ĐI TRƯỚC CÂU HỎI. Đây là cảnh báo cả-lô (mỗi tệp một băm neo, cả lô bị
          từ chối nếu một tệp đổi dưới chân). Cảnh báo THEO TỆP nằm ở panel của tab tương ứng.
        */}
        {state === "pending" && chung.length > 0 && (
          <div
            data-canh-bao-chung
            className="min-w-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/30"
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-red-700 dark:text-red-400">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t("repoWs.diff.warningsTitle", "Đọc trước khi duyệt")}
            </div>
            <ul className="space-y-0.5 text-[12px] text-red-700 dark:text-red-300">
              {chung.map((c, i) => (
                <li key={i} className="flex min-w-0 items-start gap-1.5">
                  <span aria-hidden className="mt-px shrink-0">⚠</span>
                  <span className="min-w-0 break-words leading-snug">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          TAB STRIP — mỗi tệp một nút: `baseName` + badge `+N/−M`. `flex-wrap` để khi hẹp (hoặc nhiều
          tệp) các nút XUỐNG DÒNG thay vì đẩy nhau ra ngoài vùng nhìn; mỗi nút `min-w-0` tự co.
        */}
        <div data-tab-strip role="tablist" className="flex min-w-0 flex-wrap gap-1">
          {files.map((f, i) => {
            const on = i === tabDangChon;
            const b = badges[i];
            return (
              <button
                key={f.path}
                type="button"
                role="tab"
                aria-selected={on}
                data-tab-nut={i}
                onClick={() => setTabDangChon(i)}
                className={cn(
                  "flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                  on
                    ? "border-amber-400 bg-amber-100 font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-200"
                    : "border-transparent bg-background/60 text-muted-foreground hover:bg-background",
                )}
              >
                <span className="min-w-0 truncate font-mono">{baseName(f.path)}</span>
                <span className="shrink-0 text-emerald-600 dark:text-emerald-400">+{b.added}</span>
                <span className="shrink-0 text-red-600 dark:text-red-400">−{b.removed}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        PANEL MỖI TỆP — render TẤT CẢ (ẩn cái không active bằng `hidden`), KHÔNG remount khi đổi tab.
        Trong panel: cảnh báo THEO TỆP (nếu có) đứng TRƯỚC diff, rồi `HunkDiffView readOnly` (diff
        thật, chỉ-đọc). ⚠ `readOnly` là bất biến của thẻ lô — nó ẩn mọi đường ghi/chọn-khối.
      */}
      {files.map((f, i) => {
        const stt = i + 1;
        const canhBaoTep = theoTep.get(stt) ?? [];
        // ★ 2026-08-25 — chẻ băm hex khỏi cảnh báo thường (cùng luật `TheDuyetDiff`): dòng
        //   `#N … băm …hex…` gập vào <details>, không phơi ở panel. Xem docblock `tachCanhBaoKyThuat`.
        const { thuong: tepThuong, kyThuat: tepKyThuat } = tachCanhBaoKyThuat(canhBaoTep);
        return (
          <div
            key={f.path}
            data-tab-panel={stt}
            role="tabpanel"
            hidden={i !== tabDangChon}
            className="min-w-0 space-y-2"
          >
            {state === "pending" && canhBaoTep.length > 0 && (
              <div
                data-canh-bao-tep={stt}
                className="min-w-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/30"
              >
                {tepThuong.length > 0 && (
                  <ul className="space-y-0.5 text-[12px] text-red-700 dark:text-red-300">
                    {tepThuong.map((c, k) => (
                      <li key={k} className="flex min-w-0 items-start gap-1.5">
                        <span aria-hidden className="mt-px shrink-0">⚠</span>
                        <span className="min-w-0 break-words leading-snug">{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {tepKyThuat.length > 0 && (
                  <details data-chi-tiet-ky-thuat className="mt-1 text-[11px] text-red-700/90 dark:text-red-300/90">
                    <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
                      {t("repoWs.diff.techDetails", "Chi tiết kỹ thuật (băm, TOCTOU)")}
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-1">
                      {tepKyThuat.map((c, k) => (
                        <li key={k} className="min-w-0 break-all font-mono leading-snug">{c}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <HunkDiffView base={f.original} suggested={f.modified} readOnly />
          </div>
        );
      })}

      {state === "pending" ? (
        /*
          ⚠⚠ HÀNG NÚT — `grid grid-cols-2` cho hai ô BẰNG NHAU TUYỆT ĐỐI (xem luật hình học đầu tệp).
          Nhãn nút ghi mang **số TỆP** ngay tại chỗ bấm. `onConfirm` KHÔNG tham số (lô không chọn khối).
        */
        <div data-hang-nut className="grid grid-cols-2 items-center gap-2 pt-0.5">
          <Button
            className="h-10 w-full min-w-0 text-[13px] font-semibold"
            disabled={busy || ttl.expired}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {t("repoWs.diff.batchConfirm", "Duyệt & ghi ({{n}} tệp)", { n: files.length })}
          </Button>
          <Button variant="outline" className="h-10 w-full min-w-0 text-[13px]" disabled={busy} onClick={onCancel}>
            {t("repoWs.diff.cancel", "Hủy")}
          </Button>
        </div>
      ) : (
        <div className={cn("text-[13px] font-medium", state === "executed" ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
          {state === "executed" && t("repoWs.diff.executed", "Đã ghi tệp.")}
          {state === "cancelled" && t("repoWs.diff.cancelled", "Đã hủy.")}
          {state === "denied" && t("repoWs.diff.denied", "Bị từ chối.")}
          {state === "expired" && t("repoWs.diff.expired", "Đã hết hạn.")}
        </div>
      )}
    </div>
  );
}

export default TheDuyetDiffLo;
