/**
 * ★★★ 2026-08-23 · LÔ 3 — **NHÃN TIN CẬY CHO KHỐI MÃ TRONG VĂN XUÔI MODEL** (tầng 1 + tầng 2).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TẦNG 1 — NHÃN NGUỒN GỐC, luôn đúng, luôn hiện
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mọi khối mã fence trong văn xuôi model là **mã do model viết** — nó có thể là trích dẫn đúng,
 * trích dẫn sai, hay một đề xuất; KHÔNG thể phân biệt ba thứ ấy từ phía client (nguyên lý bất di
 * dịch của lô — xem `@/lib/soKhoiMa`). Nên nhãn tầng 1 chỉ nói NGUỒN GỐC:
 *   • khối ≥ `NGUONG_DONG_BANG_NHAN` dòng → BĂNG NHÃN chữ phía trên;
 *   • khối nhỏ hơn → chỉ viền nhạt khác biệt + tooltip cùng câu (đỡ nhiễu — một băng chữ trên mỗi
 *     khối `x + 1` hai dòng làm người ta thôi đọc nhãn thật).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TẦNG 2 — CHIP ĐỐI CHIẾU TẤT ĐỊNH, chắc mới nói (`soKhoiVoiTep`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   `khac` → chip cảnh báo "≠ tệp trên đĩa…" · `khop` → chip trầm "khớp tệp trên đĩa" ·
 *   `khong-du-can-cu` → **im lặng tuyệt đối, không chip nào**.
 * Neo khối↔tệp: chỉ so khi nhãn fence khớp ĐUÔI tệp của thẻ đọc (`neoKhopNgonNgu`, bảng trắng nhỏ).
 *
 * ⚠⚠ GIỚI HẠN ĐÃ ĐO của neo (khai thẳng, không phải quên): client CHỈ giữ MỘT thẻ tool
 *   (`streamTool` của trang — bị ghi đè mỗi sự kiện, bị xoá đầu mỗi lượt gửi; transcript lưu phiên
 *   chỉ có `{role, content}`). Nên tầng 2 chỉ áp cho (a) văn bản ĐANG stream và (b) câu trả lời
 *   CÙNG LƯỢT với thẻ ấy (`viTriCauTraLoiCungLuot`); mọi câu cũ hơn không có neo ⇒ không chip.
 *   Thẻ TỔNG `{files:[…]}` của đường sinh-mã không mang nội dung ⇒ `bocTheDocTep` trả `null` ⇒
 *   cũng im lặng. KHÔNG đổi server/transcript để cõng thêm dữ liệu — đó là ranh giới của lô.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO GHI ĐÈ `pre` (không phải `code`) LÀ AN TOÀN — ĐO trên bundle, không đoán
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đọc `node_modules/streamdown/dist/chunk-*.js` (bản ^1.6.11 đang ghim): bảng component mặc định
 * khai `pre: ({children}) => children` — một PASS-THROUGH trần; toàn bộ phần nhìn của khối mã
 * (Shiki, nút CHÉP, mermaid) sống trong component `code`. `components` của người dùng được TRỘN ĐÈ
 * (`{...mặcĐịnh, ...củaTa}`) ⇒ ghi đè `pre` chỉ thay một pass-through, KHÔNG đụng tô cú pháp/nút
 * chép mà doc 81 · VIỆC 3 (2) đã mua. Ghi đè `code` mới là thứ phá chúng — ĐỪNG làm.
 * Inline code không nằm trong `<pre>` theo cấu tạo markdown ⇒ component này không bao giờ chạm nó.
 *
 * ⚠ Tách tệp riêng (cùng bài học `TheDuyetDiff`): trang kéo `trpc`/`DashboardLayout` nên lưới về
 *   NHÃN phải render được CÂY THẬT ngoài trang — `khoiMaCoNhan.unit.test.ts` làm đúng thế.
 */
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  NGUONG_DONG_BANG_NHAN,
  neoKhopNgonNgu,
  soKhoiVoiTep,
  type KetCucSoKhoi,
  type NeoDocTep,
} from "@/lib/soKhoiMa";

/** Hình dạng TỐI THIỂU của một nút hast mà Streamdown truyền qua `passNode` — chỉ các ô ta đọc. */
interface NutHast {
  type?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: NutHast[];
  value?: string;
}

/** Gom toàn bộ text con cháu của một nút hast (khối fence chỉ có một text con, nhưng không cược). */
function gomChu(nut: NutHast): string {
  if (nut.type === "text") return nut.value ?? "";
  let ra = "";
  for (const con of nut.children ?? []) ra += gomChu(con);
  return ra;
}

/**
 * ★ Bóc MÃ + NHÃN FENCE từ nút `pre` của hast: tìm phần tử `code` con đầu tiên, đọc
 * `className: ["language-x"]` (remark để nhãn fence ở đó) và nối text con cháu. THUẦN, xuất ra để
 * lưới đo thẳng. `null` ⇔ `pre` không chứa `code` (không phải khối fence) ⇒ caller pass-through.
 */
export function layMaVaNhanFence(node: unknown): { ma: string; nhanFence: string | null } | null {
  const nut = node as NutHast | null | undefined;
  if (!nut || !Array.isArray(nut.children)) return null;
  const code = nut.children.find((c) => c.tagName === "code");
  if (!code) return null;
  const lop = code.properties?.className;
  const cacLop: unknown[] = Array.isArray(lop) ? lop : typeof lop === "string" ? lop.split(/\s+/) : [];
  let nhanFence: string | null = null;
  for (const l of cacLop) {
    const m = typeof l === "string" ? /^language-(.+)$/.exec(l) : null;
    if (m) {
      nhanFence = m[1]!;
      break;
    }
  }
  return { ma: gomChu(code), nhanFence };
}

interface PropsKhoiMa {
  node?: unknown;
  children?: ReactNode;
  /** Neo đối chiếu tầng 2 — `null` ⇒ chỉ tầng 1 (không so, không chip). */
  neo?: NeoDocTep | null;
  /** Mốc-NHẬN thẻ đọc, đã định dạng (`dinhDangLucNhan`) — display-only, xem docblock ở đó. */
  luc?: string | null;
}

/**
 * Khối mã trong văn xuôi model, có nhãn. Dùng làm component `pre` cho `<Streamdown>` qua
 * `taoBoKhoiMaCoNhan` (Streamdown chỉ truyền props chuẩn + `node`; `neo`/`luc` đi qua bao đóng).
 */
export function KhoiMaCoNhan({ node, children, neo = null, luc = null }: PropsKhoiMa): ReactElement {
  const { t } = useTranslation();
  const boc = layMaVaNhanFence(node);
  if (!boc) return <>{children}</>;

  const soDong = boc.ma.replace(/\n$/, "").split("\n").length;
  const coBang = soDong >= NGUONG_DONG_BANG_NHAN;
  const cauNguonGoc = t("repoWs.khoi.modelSinh", "Mã do model viết — có thể khác tệp trên đĩa");

  // ── Tầng 2: chỉ so khi có neo VÀ nhãn fence khớp đuôi tệp; mọi ngả khác ⇒ im lặng. ──
  let ketCuc: KetCucSoKhoi | null = null;
  if (neo && neoKhopNgonNgu(boc.nhanFence, neo.duongDan)) {
    ketCuc = soKhoiVoiTep(boc.ma, neo);
  }
  const chip =
    ketCuc === "khac" ? (
      <span
        data-chip-khoi-ma="khac"
        className="rounded border border-amber-500/60 bg-amber-500/10 px-1 py-0.5 font-medium text-amber-700 dark:text-amber-500"
      >
        {t("repoWs.khoi.khacDia", "≠ tệp trên đĩa (đọc {{luc}}) — nếu model nói đây là mã HIỆN TẠI thì đừng tin", {
          luc: luc ?? "?",
        })}
      </span>
    ) : ketCuc === "khop" ? (
      <span data-chip-khoi-ma="khop" className="rounded border border-border bg-muted/60 px-1 py-0.5 text-muted-foreground">
        {t("repoWs.khoi.khopDia", "khớp tệp trên đĩa ({{luc}})", { luc: luc ?? "?" })}
      </span>
    ) : null; // `khong-du-can-cu` (và không-neo) ⇒ IM LẶNG TUYỆT ĐỐI — không chip nào.

  return (
    <div
      data-khoi-ma-model
      className={cn("min-w-0", !coBang && "border-l-2 border-dashed border-muted-foreground/40 pl-1")}
      // Khối nhỏ không băng ⇒ tooltip mang ĐÚNG câu nguồn gốc (cùng một câu, một khoá dịch).
      title={coBang ? undefined : cauNguonGoc}
    >
      {(coBang || chip !== null) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pb-0.5 text-[10px] leading-tight">
          {coBang && (
            <span data-nhan-model-sinh className="text-muted-foreground">
              {cauNguonGoc}
            </span>
          )}
          {chip}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * ★ Bộ component cho prop `components` của `<Streamdown>` — chỉ ghi đè `pre` (xem khối ⚠ đầu tệp).
 * Trang memo hoá kết quả theo `[neo, luc]`; một object mới mỗi render là vô hại về đúng/sai nhưng
 * phá memo từng-block của Streamdown ở chế độ streaming.
 */
export function taoBoKhoiMaCoNhan(
  neo: NeoDocTep | null,
  luc: string | null,
): { pre: (props: { node?: unknown; children?: ReactNode }) => ReactElement } {
  return {
    pre: (props) => <KhoiMaCoNhan node={props.node} neo={neo} luc={luc}>{props.children}</KhoiMaCoNhan>,
  };
}
