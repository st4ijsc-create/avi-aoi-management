/**
 * ★★★ 2026-08-24 · BẢNG TERMINAL (chỉ-đọc) + Ô CHẠY-NHANH cho `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH TỆP RIÊNG — cùng bài học `TheDuyetDiff`/`BoChonPhien`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nằm trong `pages/AICodingWorkspace.tsx` thì không render được ngoài trang: trang kéo theo `trpc`,
 * `DashboardLayout`, `Streamdown`… nên mọi lưới về bảng này buộc phải QUÉT VĂN BẢN mã nguồn — và
 * lưới quét văn bản chỉ trả lời *"mã có hình dạng ấy không"*, mù với ĐƯỜNG THOÁT thật (F1/F14,
 * nhóm C). Tách ra ⇒ `renderToStaticMarkup` dựng CÂY THẬT, và `bangTerminal.unit.test.ts` hỏi được
 * câu đúng: *lượt nào RA HTML, thứ tự nào, huy hiệu nào, nút chạy-nhanh nào*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THUẦN HIỂN THỊ + MỘT CALLBACK — 0 MUTATION, và đó là một bất biến an toàn, không phải khẩu vị
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bảng này KHÔNG gọi tRPC/mutation nào. `luotLenh` là dữ liệu TRANG ĐÃ TÍNH (mỗi lượt `run_command`
 * đã chạy qua cửa duyệt HITL rồi mới thành một dòng ở đây); `diaDiemLoi` do trang parse MỘT lần
 * (`shared/aiCodingLoiViTri`) để panel Problems dùng lại — bảng chỉ HIỂN THỊ.
 *
 * Ô chạy-nhanh cũng KHÔNG có đường chạy thẳng: bấm ⇒ `onChayNhanh(g)` ở TRANG ⇒ trang gọi
 * `handleSend(t(g.khoa, g.macDinh))` → model → `run_command` → propose → **cùng thẻ duyệt HITL** như
 * mọi lệnh khác. Ở đây chỉ là một callback; không một byte nào rời máy, không một lệnh nào chạy, mà
 * không đi qua nút Duyệt. Vì thế thành phần này an toàn để render tuỳ ý trong lưới.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỌC `canChayLenh` NẰM TRONG THÀNH PHẦN (đột biến `bangTerminal.unit.test.ts §5` canh)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chỉ mục gợi ý có `canChayLenh === true` mới thành nút chạy-nhanh. Trang có thể lọc trước khi
 * truyền, nhưng thành phần LỌC LẠI để phép canh sống ngay cả khi ai đó gỡ lớp lọc ở trang: bỏ điều
 * kiện `=== true` (render mọi mục) ⇒ nút của một mục `canChayLenh:false` lọt ra ⇒ lưới ĐỎ. Danh
 * sách trắng lệnh là một hàng rào — hai chỗ giữ nó, một sự thật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ CHIỀU CAO — mỗi khối ĐẦU RA tự chặn (`max-h-40 overflow-y-auto`), bài học `khungVuaManHinh`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lượt `run_command` có thể in HÀNG NGHÌN dòng (build C#, vitest verbose). Nếu khối đầu ra phình
 * vô hạn, nó đẩy ô nhập của trang RƠI XUỐNG DƯỚI NẾP GẤP — đúng lớp lỗi chiều-dọc mà `TheDuyetDiff`
 * (khối "phải đọc" `sticky top-0`) và `khungVuaManHinh` (trang không được tự cuộn) đã trả giá. Trang
 * bọc thêm một nếp gấp cuộn bên ngoài, nhưng THÀNH PHẦN cũng phải TỰ chặn: mỗi khối đầu ra cao tối
 * đa `max-h-40` rồi cuộn NỘI BỘ, không lượt nào một mình đẩy được cả bảng.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Loader2, Play, Terminal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GoiYDuAn } from "@/lib/goiYDuAn";
import type { DiaDiemLoi } from "@shared/aiCodingLoiViTri";
// ★★★ 2026-08-29 · ĐUÔI SỐNG — gập `\r`/ANSI (ngữ nghĩa terminal) + nhãn giây, THUẦN (lưới riêng).
import { gopVachVe, nhanGiayTroi, type LuotSong } from "@/lib/dauRaSong";

/**
 * ★★★ HỢP ĐỒNG — chốt cứng, Wave nối-dây phụ thuộc. Đừng đổi tên / hình dạng trường.
 * Một lượt lệnh kiểm chứng ĐÃ CHẠY (qua cửa duyệt HITL hoặc một lượt vòng tự động).
 */
export interface LuotLenh {
  /** Lệnh đã chạy, nguyên văn (danh sách trắng của dự án — server là hàng rào). */
  lenh: string;
  /** Đầu ra THÔ (stdout+stderr đã gộp), có thể mang `\r\n` của Windows. */
  dauRa: string;
  /** Mã thoát tiến trình; `null` khi lệnh chưa/không kết thúc bằng mã (vd hết giờ). */
  exitCode: number | null;
  /** true ⇔ lệnh bị cắt vì quá hạn (`CMD_TIMEOUT`) — KHÔNG dùng chung nhánh với "chưa chạy". */
  timedOut: boolean;
  /** Thời lượng chạy (ms); `null` khi trang không đo được. */
  durationMs: number | null;
  /**
   * Kết luận ĐẾM-CA (`docKetQuaTest` của `shared/aiCodingLoop`): `null` ⇔ lệnh không phải một lượt
   * test đọc được số ca (vd `grep`), hoặc số ca mâu thuẫn với mã thoát ⇒ không nói gì.
   */
  ketQua: { xanh: boolean; soDo: number | null; soXanh: number | null } | null;
  /** Mốc-NHẬN đã định dạng (`dinhDangLucNhan` ở trang) — display-only, bảng chỉ hiển thị. */
  luc: string;
  /** Ai khởi phát lượt này: người bấm Duyệt (`duyet`) hay vòng tự-ghi (`vong_tu_dong`). */
  nguon: "duyet" | "vong_tu_dong";
  /** Địa điểm lỗi trang parse MỘT lần (`shared/aiCodingLoiViTri`) — panel Problems dùng lại. */
  diaDiemLoi: DiaDiemLoi[];
}

interface BangTerminalProps {
  /** Lịch sử lượt lệnh theo THỨ TỰ LƯU (cũ→mới); bảng hiển thị MỚI-NHẤT-TRƯỚC. */
  luotLenh: readonly LuotLenh[];
  /** Gợi ý của dự án đang chọn; bảng chỉ lấy mục `canChayLenh` làm nút chạy-nhanh (xem docblock). */
  goiYNhanh: readonly GoiYDuAn[];
  /** true ⇔ đang stream một lượt — khoá nút chạy-nhanh để không xếp chồng hai lượt gửi. */
  dangGui: boolean;
  /** Bấm một nút chạy-nhanh ⇒ trang tự dựng câu hỏi và đưa qua cùng cửa duyệt HITL. */
  onChayNhanh: (g: GoiYDuAn) => void;
  /**
   * ★★★ 2026-08-29 · ĐUÔI SỐNG — lượt `run_command` ĐANG CHẠY (trang poll `repoWorkspace.dauRaSong`
   * ~800ms). `null`/vắng ⇔ không gì đang chạy ⇒ bảng y HỆT trước (tương thích ngược từng byte —
   * mọi ca lưới cũ không truyền prop này phải xanh nguyên). Khối sống THUẦN HIỂN THỊ như cả bảng:
   * dữ liệu server đã che + đã cap; ở đây chỉ gập `\r` (ngữ nghĩa terminal) và vẽ.
   */
  luotSong?: LuotSong | null;
}

export function BangTerminal({ luotLenh, goiYNhanh, dangGui, onChayNhanh, luotSong }: BangTerminalProps): React.JSX.Element {
  const { t } = useTranslation();

  /**
   * Tự cuộn ĐÁY khối sống — terminal xem từ đáy. Ref-callback INLINE cố ý (KHÔNG useCallback):
   * identity mới mỗi render ⇒ React gọi lại sau MỖI nhịp poll ⇒ đáy bám nội dung mới. Bọc
   * useCallback là khối chỉ cuộn đúng một lần lúc mount rồi đứng im — một đồng-hồ-không-kim.
   * Lưới `renderToStaticMarkup` không chạy ref nên phép đo tĩnh không bị ảnh hưởng.
   */
  const cuonDay = (el: HTMLPreElement | null) => {
    if (el) el.scrollTop = el.scrollHeight;
  };
  const dauRaSongGon = luotSong ? gopVachVe(luotSong.dauRa) : "";

  // MỚI-NHẤT-TRƯỚC: đảo BẢN SAO (`luotLenh` là readonly — `.reverse()` tại chỗ sẽ đột biến prop).
  const daoNguoc = [...luotLenh].reverse();

  // Danh sách trắng: CHỈ mục `canChayLenh === true`. Lọc ở đây là phép canh sống (xem docblock ⚠).
  const lenhChayNhanh = goiYNhanh.filter((g) => g.canChayLenh === true);

  return (
    <div data-bang-terminal className="flex min-h-0 min-w-0 flex-col gap-2 text-[13px]">
      {/* ── Thanh đầu: nhan đề + đếm lượt ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
          <Terminal className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{t("repoWs.terminal.title", "Kết quả lệnh")}</span>
        </div>
        {luotLenh.length > 0 && (
          <span
            data-dem-lenh
            className="ml-auto shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground"
          >
            {t("repoWs.terminal.count", "{{n}} lệnh", { n: luotLenh.length })}
          </span>
        )}
      </div>

      {/* ── Ô CHẠY-NHANH: chỉ lệnh trong danh sách trắng của dự án (canChayLenh) ───────────────── */}
      <div data-o-chay-nhanh className="shrink-0 rounded-md border border-dashed bg-muted/40 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-foreground">
          <Play className="size-3.5 shrink-0" />
          <span>{t("repoWs.terminal.quickRunLabel", "Chạy nhanh")}</span>
        </div>
        {lenhChayNhanh.length === 0 ? (
          <p data-chay-nhanh-rong className="text-[11px] leading-relaxed text-muted-foreground">
            {t("repoWs.terminal.quickRunNone", "Dự án này chưa có lệnh gợi ý.")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {lenhChayNhanh.map((g) => (
                <Button
                  key={g.khoa}
                  type="button"
                  variant="outline"
                  size="sm"
                  data-nut-chay-nhanh
                  data-khoa={g.khoa}
                  disabled={dangGui}
                  onClick={() => onChayNhanh(g)}
                  className="h-7 min-w-0 max-w-full text-[11px]"
                >
                  <Play className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{t(g.khoa, g.macDinh)}</span>
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              {t("repoWs.terminal.quickRunHint", "Chỉ lệnh trong danh sách trắng của dự án.")}
            </p>
          </>
        )}
      </div>

      {/* ── ★ ĐUÔI SỐNG — lượt ĐANG CHẠY, trên đầu lịch sử (mẫu VSCode: xem build ngay lúc chạy) ── */}
      {luotSong && (
        <div
          data-luot-song
          className="shrink-0 rounded-md border border-sky-300 bg-sky-50/50 p-2 dark:border-sky-900 dark:bg-sky-950/20"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">
              <span className="select-none text-muted-foreground">{"$ "}</span>
              {luotSong.lenh}
            </code>
            {luotSong.dangChay ? (
              <span
                data-song-dang-chay
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
              >
                <Loader2 className="size-3 animate-spin" />
                {t("repoWs.terminal.liveRunning", "đang chạy · {{giay}}", { giay: nhanGiayTroi(luotSong.msTroi) })}
              </span>
            ) : (
              <span data-song-da-xong className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {t("repoWs.terminal.liveDone", "vừa xong · {{giay}}", { giay: nhanGiayTroi(luotSong.msTroi) })}
              </span>
            )}
          </div>
          {luotSong.catDau && (
            <p data-song-cat-dau className="mt-1 text-[10px] text-muted-foreground">
              {t("repoWs.terminal.liveTrimmed", "… đã cắt phần đầu — đây là đuôi mới nhất.")}
            </p>
          )}
          {/* Đuôi tự cuộn ĐÁY (ref inline — xem `cuonDay`); rỗng vẫn giữ khối để thấy "đã bắt đầu". */}
          <pre
            data-song-dau-ra
            ref={cuonDay}
            className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/80 p-1.5 font-mono text-[11px] leading-snug text-foreground"
          >
            {dauRaSongGon === "" ? t("repoWs.terminal.liveWaiting", "(chưa có đầu ra — tiến trình vừa khởi động)") : dauRaSongGon}
          </pre>
        </div>
      )}

      {/* ── LỊCH SỬ LƯỢT LỆNH (mới-nhất-trước) — vùng cuộn của bảng ───────────────────────────── */}
      {daoNguoc.length === 0 ? (
        <p data-terminal-rong className="min-h-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
          {t("repoWs.terminal.empty", "Chưa có lệnh nào chạy. Duyệt một lệnh kiểm chứng để thấy đầu ra ở đây.")}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {daoNguoc.map((lt, i) => (
            // key: dùng chỉ số ĐẢO để ổn định theo lượt gốc (danh sách chỉ mọc thêm ở cuối).
            <div
              key={daoNguoc.length - 1 - i}
              data-luot
              className="min-w-0 rounded-md border bg-background/60 p-2"
            >
              {/* Dòng lệnh + meta (mốc · nguồn · huy hiệu) */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">
                  <span className="select-none text-muted-foreground">{"$ "}</span>
                  {lt.lenh}
                </code>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{lt.luc}</span>
                {lt.nguon === "vong_tu_dong" && (
                  <span
                    data-tu-vong
                    className="shrink-0 rounded-full border border-sky-300 bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
                  >
                    {t("repoWs.terminal.fromLoop", "từ vòng tự động")}
                  </span>
                )}
                {lt.ketQua && (
                  <span
                    data-huy-hieu={lt.ketQua.xanh ? "xanh" : "do"}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      lt.ketQua.xanh
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
                    )}
                  >
                    {lt.ketQua.xanh ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                    {lt.ketQua.soDo !== null && lt.ketQua.soXanh !== null && (
                      <span>{lt.ketQua.soXanh}/{lt.ketQua.soDo + lt.ketQua.soXanh}</span>
                    )}
                  </span>
                )}
              </div>

              {/* ĐẦU RA — mono, giữ khoảng trắng, TỰ CHẶN chiều cao (xem docblock ⚠ khungVuaManHinh). */}
              {lt.dauRa !== "" && (
                <pre
                  data-dau-ra
                  className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-1.5 font-mono text-[11px] leading-snug text-muted-foreground"
                >
                  {lt.dauRa}
                </pre>
              )}

              {/* Mã thoát · quá hạn · thời lượng */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                {lt.exitCode !== null && (
                  <span data-ma-thoat>{t("repoWs.terminal.exitCode", "Mã thoát: {{code}}", { code: lt.exitCode })}</span>
                )}
                {lt.timedOut && (
                  <span data-qua-han className="font-medium text-amber-700 dark:text-amber-400">
                    {t("repoWs.terminal.timedOut", "Quá hạn")}
                  </span>
                )}
                {lt.durationMs !== null && (
                  <span data-thoi-luong className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    {t("repoWs.terminal.durationMs", "{{ms}} ms", { ms: lt.durationMs })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default BangTerminal;
