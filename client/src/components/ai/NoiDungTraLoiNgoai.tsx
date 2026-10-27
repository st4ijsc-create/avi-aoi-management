/**
 * Đợt 10.4b (L0b) — BỘ RENDER DUY NHẤT cho câu trả lời của model NGOÀI (và lịch sử đã lưu mang dấu nguồn ngoài). Đầu ra AI ngoài là DỮ LIỆU KHÔNG TIN CẬY.
 * Kế hoạch §D6 (kiem-dinh M6): `react-markdown` KHÔNG kèm plugin nào (không `rehype-raw` ⇒ HTML thô thành CHỮ; không math/KaTeX/mermaid ⇒ `\href`, `\includegraphics`,
 * sơ đồ chỉ là chữ), và GHI ĐÈ:
 *   • liên kết ⇒ KHÔNG bấm được: hiển thị chữ + (tên miền) — không `<a>`, không `href`, không tự mở;
 *   • ảnh ⇒ TẮT HOÀN TOÀN (placeholder chữ): ảnh markdown là kênh rò dữ liệu qua URL / theo dõi;
 *   • khối mã ⇒ chỉ nút "Chép" (đặt clipboard) kèm cảnh báo — KHÔNG "Áp dụng/chạy".
 * Census (`NoiDungTraLoiNgoai.census.unit.test.ts`): tệp này không được dùng `rehype-raw`/`dangerouslySetInnerHTML`/plugin; mọi bề mặt hiển thị trả lời ngoài import bộ này.
 */
import { useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** Tên miền của một URL http(s); khác ⇒ null (không hiển thị gì từ giao thức lạ). */
export function tenMienCuaLienKet(href: unknown): string | null {
  // CHỈ URL tuyệt đối có giao thức http(s) — `//host`, đường dẫn tương đối, `javascript:`/`data:`/… ⇒ null (không hiển thị gì từ chúng)
  if (typeof href !== "string" || !/^https?:\/\//i.test(href.trim())) return null;
  try {
    const u = new URL(href.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

function chuCuaNut(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | undefined;
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(chuCuaNut).join("");
}

function KhoiMa({ children, node }: { children?: ReactNode; node?: unknown }) {
  const { t } = useTranslation();
  const [daChep, setDaChep] = useState(false);
  const chu = chuCuaNut(node);
  const chep = async () => {
    try {
      await navigator.clipboard.writeText(chu);
      setDaChep(true);
    } catch {
      toast.error(t("kiemDinhNgoai.chepLoi", "Không chép được — hãy bôi đen và chép tay."));
    }
  };
  return (
    <div data-ngoai-khoi-ma className="my-2">
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">{children}</pre>
      <div className="mt-0.5 flex items-center gap-2">
        <button type="button" data-ngoai-chep className="rounded border px-1.5 py-0.5 text-[11px]" onClick={() => void chep()}>
          {daChep ? t("kiemDinhNgoai.daChepNut", "Đã chép") : t("kiemDinhNgoai.chep", "Chép")}
        </button>
        <span className="text-[10px] text-amber-700">{t("noiDungNgoai.canhBaoMa", "Do AI ngoài viết — kiểm tra trước khi chạy/dán vào terminal hoặc tệp.")}</span>
      </div>
    </div>
  );
}

export function NoiDungTraLoiNgoai({ noiDung }: { noiDung: string }) {
  const { t } = useTranslation();
  return (
    <div data-testid="noi-dung-tra-loi-ngoai" className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed">
      <Markdown
        // không biến đổi URL thành gì khác; KHÔNG bao giờ gán vào href/src (bộ `a`/`img` bên dưới chỉ lấy tên miền để HIỂN THỊ)
        urlTransform={(u) => u}
        components={{
          a: ({ children, href }) => {
            const mien = tenMienCuaLienKet(href);
            return (
              <span data-ngoai-lien-ket className="underline decoration-dotted">
                {children}
                {mien ? <span className="ml-1 text-muted-foreground">({mien})</span> : <span className="ml-1 text-muted-foreground">({t("noiDungNgoai.lienKetChan", "liên kết bị chặn")})</span>}
              </span>
            );
          },
          img: ({ alt }) => (
            <span data-ngoai-anh className="text-muted-foreground">
              [{t("noiDungNgoai.anhChan", "ảnh bị chặn")}
              {alt ? `: ${alt}` : ""}]
            </span>
          ),
          pre: ({ children, node }) => <KhoiMa node={node}>{children}</KhoiMa>,
        }}
      >
        {noiDung}
      </Markdown>
    </div>
  );
}
