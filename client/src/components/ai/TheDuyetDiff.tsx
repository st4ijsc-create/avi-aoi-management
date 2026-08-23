/**
 * ★★★ 2026-08-23 · THẺ DUYỆT `apply_diff` — **CỬA DUYỆT CỦA HỆ**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH KHỎI `pages/AICodingWorkspace.tsx`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây là bề mặt mà **mọi lượt AI ghi tệp** phải đi qua — bất biến của dự án. Nằm trong trang, nó
 * không render được ngoài trang: trang kéo theo `trpc`, `DashboardLayout`, `Streamdown`… nên mọi
 * lưới về nó buộc phải **quét VĂN BẢN mã nguồn**. Bài học repo (F1/F14, nhóm C): *lưới quét trên
 * VĂN BẢN thì mù với ĐƯỜNG THOÁT thật* — nó trả lời "mã có hình dạng ấy không", không trả lời
 * "mã làm việc ấy không". Tách ra ⇒ `renderToStaticMarkup` dựng CÂY THẬT, và lưới hỏi được câu
 * đúng: *cảnh báo có nằm TRƯỚC hàng nút trong thứ tự tài liệu không*, *hàng nút có đối xứng không*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LUẬT KHÔNG ĐƯỢC PHÁ — và nó là HỆ QUẢ HÌNH HỌC, không phải lời dặn
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   ***Nút thực hiện hành động KHÔNG HOÀN TÁC ĐƯỢC không bao giờ được hiển thị đầy đủ trong khi
 *      đường thoát an toàn bị cắt. Hai nút cùng nhìn thấy được, hoặc cùng không.***
 *
 * Nghiệm thu live 2026-08-23 (Playwright, 1600×1000) đo được lượt phản bội luật ấy:
 *   • "Duyệt & ghi" hiện **336,8/336,8 px = 100%**
 *   • "Hủy"        hiện **41,2/338,8 px = 12,2%**
 *   • đồng hồ hết hạn hiện **0/64,8 px = 0%** (`left = 1776,8` trong một màn rộng 1600)
 *   • khung hội thoại: `clientWidth 400` · `scrollWidth 736` · **không có thanh cuộn ngang nào**
 * Tức ở đúng khoảnh khắc ghi đè mã nguồn, nút phá huỷ hiện trọn còn đường thoát bị giấu 88%.
 *
 * Ba chốt giữ luật, theo thứ tự sức mạnh:
 *   1. `ScrollArea vuaKhung` ở khung hội thoại — nội dung **không kéo khung rộng ra được** nữa.
 *   2. `[data-hang-nut]` là `grid grid-cols-2` — HAI Ô BẰNG NHAU TUYỆT ĐỐI, cùng một dòng. Không
 *      còn cấu hình nào để một nút hiện 100% còn nút kia hiện 12%.
 *   3. Mọi khối trong thẻ có `min-w-0` + tự xuống dòng; nội dung thật sự rộng (dòng diff) tự cuộn
 *      TRONG hộp của nó (`HunkDiffView`), không tràn ra ngoài.
 * ⚠ Một thanh cuộn ngang **không** thay được ba chốt trên: một thẻ duyệt phải *cuộn ngang mới bấm
 *   được Hủy* vẫn là thẻ duyệt hỏng — người ta không cuộn, họ bấm cái đang thấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 3 (2026-08-23) — DUYỆT THEO KHỐI **THẬT**, không còn "xem trước theo khối"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước lượt này, nút "Nhận khối"/"Hoàn tác" chỉ đổi cái được XEM ở khung giữa; bấm Duyệt vẫn ghi
 * **toàn bộ** `modified` đã chốt lúc propose — thẻ tự khai điều đó trong một dòng chữ nhỏ. Nay tập
 * khối đang chọn LÀ thứ được ghi, và bốn ràng buộc giữ cho điều đó không mở một lỗ mới:
 *   1. **Chỉ SỐ THỨ TỰ khối rời trình duyệt** (`onConfirm(chonKhoi?: number[])`). Byte nội dung
 *      không bao giờ đi trên dây — server dựng lại `keHoachKhoiDuyet(argsJson)` từ CSDL rồi tự
 *      chiếu (`aiCopilotActions.confirmAction`); id lạ/trùng/ngoài khoảng bị từ chối CÓ MÃ.
 *   2. **Chọn đủ mọi khối ⇒ `undefined`** ⇒ trang không gửi trường nào ⇒ đường cũ nguyên byte
 *      (tương thích ngược cho CLI/MCP/autonomy — họ không gửi trường này bao giờ).
 *   3. **Mặc định TẤT CẢ khối được chọn** — vẫn MỘT cú bấm cho ca thường gặp (chống "mệt mỏi phê
 *      duyệt"); bỏ chọn là hành động chủ động, và con số {{chon}}/{{tong}} đứng NGAY TRÊN NÚT.
 *   4. **0 khối ⇒ nút tự khoá + một câu nói thẳng** — nhưng server mới là hàng rào
 *      (`NO_HUNKS_SELECTED`); nút chỉ là phép lịch sự.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clock, FileDiff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HunkDiffView } from "@/components/diff/HunkDiffView";
import { useTtlCountdown, type ActionState } from "@/components/ConfirmActionCard";
import { chiSoGuiLenServer, keHoachKhoiDuyet, projectHunks } from "@/lib/diffHunks";
import { cn } from "@/lib/utils";

/** Ba ô `apply_diff` gửi lên; `original`/`modified` là toàn văn hai phía để dựng diff. */
export interface DiffArgs { path: string; original: string; modified: string }

/**
 * Chỉ NHỮNG Ô THẺ NÀY ĐỌC của một `KbPendingAction`. Khai hẹp là cố ý: thẻ duyệt không được
 * mọc thêm đường phụ thuộc vào `useKbChatStream` (một vòng nhập ngược trang → thành phần).
 */
export interface HanhDongCanDuyet {
  expiresAt: string;
  preview?: { warnings?: string[] } | null;
}

export function TheDuyetDiff({
  action, args, state, busy, preview, onPreview, onConfirm, onCancel,
}: {
  action: HanhDongCanDuyet;
  args: DiffArgs;
  state: ActionState;
  busy: boolean;
  /** Buffer đang xem trước ở khung giữa — thẻ tự giữ nó = phép chiếu của tập khối đang chọn. */
  preview: string;
  onPreview: (text: string) => void;
  /**
   * ★★★ ĐỢT 3 (2026-08-23) — `chonKhoi` là **CHỈ SỐ các khối sẽ được ghi** (0-based, theo
   * `keHoachKhoiDuyet`), `undefined` ⇔ chọn đủ mọi khối ⇒ trang KHÔNG gửi trường nào ⇒ server đi
   * nguyên đường cũ. KHÔNG BAO GIỜ truyền byte nội dung qua đây — server tự chiếu lại từ
   * `argsJson` đã chốt trong CSDL (nguyên tắc *"args from DB, not the request"*).
   */
  onConfirm: (chonKhoi?: number[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ttl = useTtlCountdown(action.expiresAt, state === "pending");
  const canhBao = action.preview?.warnings ?? [];

  /**
   * ★★★ ĐỢT 3 — KẾ HOẠCH KHỐI **CHUẨN** (`keHoachKhoiDuyet`): đúng hàm server sẽ gọi lại trên
   * `argsJson` lúc confirm, nên chỉ số khối ở đây và ở server trỏ vào CÙNG một khối. Cũng chính
   * kế hoạch này được đưa xuống `HunkDiffView` (qua `khoaEol` — cùng luật EOL), nên cái người
   * duyệt NHÌN = cái server CHIẾU = cái sẽ VÀO ĐĨA.
   */
  const keHoach = useMemo(() => keHoachKhoiDuyet(args.original, args.modified), [args.original, args.modified]);
  const khoaKeHoach = `${keHoach.baseSignature}|${keHoach.modified.length}|${keHoach.hunks.length}`;

  /**
   * Tập khối SẼ ĐƯỢC GHI. Mặc định **TẤT CẢ** — ca thường gặp nhất (duyệt nguyên đề xuất) vẫn là
   * MỘT cú bấm như trước; bỏ chọn là hành động chủ động của người duyệt. (Khác mặc định RỖNG của
   * chế độ xem-trước cũ: ở đây tập chọn là câu trả lời cho "ghi gì", không phải "đang xem gì".)
   */
  const [chon, setChon] = useState<string[]>(() => keHoach.hunks.map((h) => h.id));
  useEffect(() => {
    setChon(keHoach.hunks.map((h) => h.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaKeHoach]);

  /** Phép chiếu của tập đang chọn — chính là byte sẽ vào đĩa; cũng là buffer xem trước khung giữa. */
  const daChieu = useMemo(() => projectHunks(keHoach, chon), [keHoach, chon]);
  const vanBanChieu = daChieu.ok ? daChieu.text : args.original;
  useEffect(() => {
    if (state === "pending") onPreview(vanBanChieu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vanBanChieu, state]);

  const tongKhoi = keHoach.hunks.length;
  const soChon = chon.length;
  /** `null` ⇔ chọn đủ ⇒ không gửi trường nào (đường cũ, từng byte). Xem `chiSoGuiLenServer`. */
  const chiSoGui = useMemo(() => chiSoGuiLenServer(keHoach, chon), [keHoach, chon]);
  const khongChonKhoi = tongKhoi > 0 && soChon === 0;

  return (
    // `min-w-0 max-w-full` — thẻ này phải **VỪA KHUNG**, không phải tràn rồi trông cậy thanh cuộn.
    <div
      data-the-duyet="apply_diff"
      className="min-w-0 max-w-full space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30"
    >
      {/*
        ★★★ 2026-08-23 · KHỐI "PHẢI ĐỌC" ĐƯỢC **GHIM TRÊN**, và đây là chốt thứ tư của luật.
        Ba chốt kia lo chiều NGANG. Chốt này lo chiều DỌC, vì phép đo ở 900×700 bày ra một cách
        phản bội luật mà chiều ngang không thấy: khung hội thoại khi ấy chỉ cao **~256 px** trong khi
        thẻ duyệt cao **~440 px**, và hội thoại TỰ CUỘN XUỐNG ĐÁY mỗi lượt ⇒ thứ lọt vào mắt người
        dùng là **hàng nút**, còn đồng hồ hết hạn và ba câu cảnh báo trôi lên trên nếp gấp. Tức vẫn
        đúng cái hình dạng cũ — *thấy nút bấm, không thấy điều phải đọc* — chỉ đổi trục.
        `sticky top-0`: chừng nào thẻ còn trong khung, đồng hồ + cảnh báo còn DÍNH ở mép trên. Người
        dùng không thể ở trong tư thế "ngón tay trên nút Duyệt" mà không có cảnh báo trước mắt.
        ⚠ `-mx-3 -mt-3 px-3 pt-3` để nền phủ hết bề ngang thẻ (thẻ có `p-3`); thiếu nó thì chữ bên
          dưới lộ ra hai bên mép khi cuộn qua. `z-10` để nó nằm trên khối diff.
      */}
      <div
        data-ghim-tren
        className="sticky top-0 z-10 -mx-3 -mt-3 space-y-2 rounded-t-md bg-amber-50 px-3 pb-2 pt-3 dark:bg-amber-950"
      >
      {/* `flex-wrap`: khi hẹp, đồng hồ XUỐNG DÒNG chứ không bị đẩy ra ngoài vùng nhìn. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
          <FileDiff className="size-4 shrink-0" />
          <span className="min-w-0 break-words">{t("repoWs.diff.cardTitle", "Đề xuất SỬA tệp — cần bạn duyệt")}</span>
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

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px]">
        <span className="font-medium text-foreground">{t("repoWs.diff.file", "Tệp")}:</span>
        <code className="min-w-0 break-all rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">{args.path}</code>
      </div>

      {/*
        ★★★ CẢNH BÁO ĐI TRƯỚC CÂU HỎI, KHÔNG PHẢI SAU CÂU TRẢ LỜI.
        `preview.warnings` do `server/services/aiLocalTools/writeHandlers/applyDiff.ts · xemTruoc`
        dựng, và ở một lượt `apply_diff` bình thường nó có **ba câu**: *"Tệp SẠCH … sẽ GHI ĐÈ"* ·
        *"Băm TRƯỚC … → SAU … Băm này được so LẠI ở lúc bạn xác nhận"* · *"N dòng → M dòng"*.
        Thẻ này TRƯỚC 2026-08-23 **không render mảng ấy** (chỉ `ConfirmActionCard` có) ⇒ ba câu đáng
        đọc nhất chỉ lộ ra trong `textSummary` **sau khi người dùng đã bấm Hủy** — tức sau khi quyết
        định đã xong. Một cảnh báo đến sau quyết định không phải là cảnh báo.
        ⚠ Đặt TRÊN `HunkDiffView`: một diff dài bao nhiêu cũng không đẩy được khối này xuống dưới
          nếp gấp. Đảo thứ tự = hoàn nguyên bản vá, kể cả khi khối vẫn còn trong cây.
      */}
      {state === "pending" && canhBao.length > 0 && (
        <div
          data-canh-bao
          className="min-w-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/30"
        >
          <div className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-red-700 dark:text-red-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            {t("repoWs.diff.warningsTitle", "Đọc trước khi duyệt")}
          </div>
          <ul className="space-y-0.5 text-[12px] text-red-700 dark:text-red-300">
            {canhBao.map((c, i) => (
              <li key={i} className="flex min-w-0 items-start gap-1.5">
                <span aria-hidden className="mt-px shrink-0">⚠</span>
                <span className="min-w-0 break-words leading-snug">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>

      {/*
        ★★★ ĐỢT 3 — DIFF ĐẦY ĐỦ, và nút Nhận/Hoàn tác từng khối nay là **LỰA CHỌN GHI THẬT**:
        bỏ chọn khối nào thì khối ấy KHÔNG vào đĩa (server tự chiếu lại từ đề xuất đã chốt, thẻ
        chỉ gửi CHỈ SỐ khối — xem docblock `onConfirm`). Khung giữa luôn hiển thị đúng phép chiếu
        của tập đang chọn, nên "cái đang xem" và "cái sẽ ghi" là MỘT.
        ⚠ `chonNgoai` + `khoaEol` bắt buộc đi cùng nhau ở đây: tập chọn phải sống ở thẻ (nơi bấm
          Duyệt), và luật EOL phải tất định để chỉ số hai đầu dây trỏ cùng một khối.
      */}
      <HunkDiffView
        base={args.original}
        suggested={args.modified}
        currentText={vanBanChieu}
        onApplyText={onPreview}
        chonNgoai={{ daChon: chon, onDoi: setChon }}
        khoaEol
      />

      {state === "pending" && khongChonKhoi && (
        <p data-khong-chon-khoi className="flex min-w-0 items-start gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-words">{t("repoWs.diff.zeroChon", "Chưa chọn khối nào — chọn ít nhất một khối để ghi, hoặc bấm Hủy. (Ghi 0 khối không phải một lượt ghi; server cũng sẽ từ chối.)")}</span>
        </p>
      )}

      <p className="flex min-w-0 items-start gap-1.5 rounded-md border border-amber-300/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground dark:border-amber-900/50">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <span className="min-w-0 break-words">
          {t("repoWs.diff.writesSelected", "Xác nhận sẽ ghi {{chon}}/{{tong}} khối ĐANG CHỌN xuống đĩa — khối bỏ chọn KHÔNG được ghi. Trình duyệt chỉ gửi SỐ THỨ TỰ khối; nội dung được server chiếu lại từ đề xuất đã chốt.", { chon: soChon, tong: tongKhoi })}
        </span>
      </p>

      {state === "pending" ? (
        /*
          ⚠⚠ HÀNG NÚT — xem khối LUẬT ở đầu tệp. `grid grid-cols-2` cho hai ô BẰNG NHAU TUYỆT ĐỐI.
          Trước bản vá đây là `flex` + `flex-1`: `flex-1` chia phần theo BỀ RỘNG CHA, mà bề rộng cha
          khi ấy là tấm bảng `display:table` **736 px** nằm trong một khung **400 px** ⇒ nút trái vừa
          đủ lọt (100%), nút phải rơi ra ngoài (12,2%).
          ⚠ KHÔNG đổi về `flex` + `flex-1`, và KHÔNG cho riêng một ô `min-w-*`/`col-span-*`: cả ba
            đều phá tính đối xứng — thứ duy nhất biến luật trên thành hệ quả hình học.
          ★ ĐỢT 3 — nhãn nút Duyệt mang **{{chon}}/{{tong}} khối** ngay tại chỗ bấm: người bấm phải
            biết mình sắp ghi cái gì mà KHÔNG cần cuộn. 0 khối ⇒ nút tự khoá (server vẫn tự chặn
            `NO_HUNKS_SELECTED` — nút chỉ là lịch sự, không phải hàng rào).
        */
        <div data-hang-nut className="grid grid-cols-2 items-center gap-2 pt-0.5">
          <Button className="h-10 w-full min-w-0 text-[13px] font-semibold" disabled={busy || ttl.expired || khongChonKhoi} onClick={() => onConfirm(chiSoGui ?? undefined)}>
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {tongKhoi > 0
              ? t("repoWs.diff.confirmChon", "Duyệt & ghi ({{chon}}/{{tong}} khối)", { chon: soChon, tong: tongKhoi })
              : t("repoWs.diff.confirm", "Duyệt & ghi")}
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

export default TheDuyetDiff;
